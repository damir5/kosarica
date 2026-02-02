package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	adaptersconfig "github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/jsonb"
	"github.com/kosarica/price-service/internal/pkg/cuid2"
	"github.com/kosarica/price-service/internal/taskqueue"
	"github.com/rs/zerolog/log"
)

// HandleDiscoverTask processes an ingestion_discover task from the queue.
// It discovers available files and spawns fetch_parse subtasks for each discovered file.
// After all fetch tasks complete, it spawns a store_prep task.
func HandleDiscoverTask(ctx context.Context, payload jsonb.TaskQueuePayload, tq *taskqueue.TaskQueue, taskID string) error {
	// Extract discover payload from generic payload
	var discoverPayload jsonb.DiscoverPayload
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}
	if err := json.Unmarshal(payloadBytes, &discoverPayload); err != nil {
		return fmt.Errorf("failed to unmarshal discover payload: %w", err)
	}

	chainSlug := discoverPayload.ChainSlug
	if chainSlug == "" {
		return fmt.Errorf("missing chainSlug in discover payload")
	}

	targetDate := discoverPayload.TargetDate
	if targetDate == "" {
		targetDate = time.Now().Format("2006-01-02")
	}

	runID := discoverPayload.RunID

	log.Info().
		Str("chain", chainSlug).
		Str("targetDate", targetDate).
		Str("runId", runID).
		Str("taskId", taskID).
		Msg("Processing discover task")

	// Check if this is a re-run after children completed
	task, err := tq.GetTask(ctx, taskID)
	if err != nil {
		log.Warn().Err(err).Str("taskId", taskID).Msg("Failed to get task record")
	} else if task.ExpectedChildren > 0 && task.CompletedChildren >= task.ExpectedChildren {
		log.Info().
			Str("taskId", taskID).
			Int("expectedChildren", task.ExpectedChildren).
			Int("completedChildren", task.CompletedChildren).
			Msg("All fetch_parse children completed, spawning store_prep task")

		storePrepRunID := runID
		if storePrepRunID == "" {
			// Recover runID from database
			storePrepRunID, err = recoverRunIDFromDatabase(ctx, chainSlug)
			if err != nil {
				return fmt.Errorf("failed to recover runID: %w", err)
			}
		}
		return spawnStorePrepTask(ctx, tq, taskID, chainSlug, storePrepRunID)
	}

	// Validate chain ID
	if !adaptersconfig.IsValidChainID(chainSlug) {
		return fmt.Errorf("invalid chain ID: %s", chainSlug)
	}

	// Initialize chain registry
	if err := registry.InitializeDefaultAdapters(); err != nil {
		return fmt.Errorf("failed to initialize chain registry: %w", err)
	}

	// Create or use existing run ID
	if runID == "" {
		runID = createIngestionRunForDiscover(ctx, chainSlug)
		if runID == "" {
			return fmt.Errorf("failed to create ingestion run")
		}
	}

	// Update run status to running
	queries := sqlcgen.New(database.Pool())
	if err := queries.UpdateIngestionRunToRunning(ctx, runID); err != nil {
		log.Warn().Err(err).Str("runId", runID).Msg("Failed to update run status to running")
	}

	// Get adapter and discover files
	adapter, err := registry.GetAdapter(adaptersconfig.ChainID(chainSlug))
	if err != nil {
		markDiscoverFailed(ctx, runID, fmt.Sprintf("Failed to get adapter: %v", err))
		return fmt.Errorf("failed to get adapter for %s: %w", chainSlug, err)
	}

	log.Info().Str("chain", chainSlug).Msg("Starting discovery")

	files, err := adapter.Discover(targetDate)
	if err != nil {
		markDiscoverFailed(ctx, runID, fmt.Sprintf("Discovery failed: %v", err))
		return fmt.Errorf("discovery failed: %w", err)
	}

	log.Info().
		Str("chain", chainSlug).
		Int("filesFound", len(files)).
		Msg("Discovery complete")

	// Update run with total files
	if err := queries.UpdateRunTotalFiles(ctx, sqlcgen.UpdateRunTotalFilesParams{
		TotalFiles: pgtype.Int4{Int32: int32(len(files)), Valid: true},
		ID:         runID,
	}); err != nil {
		log.Warn().Err(err).Str("runId", runID).Msg("Failed to update total files")
	}

	// If no files found, mark run as completed immediately
	if len(files) == 0 {
		log.Warn().Str("chain", chainSlug).Msg("No files discovered")
		if err := queries.UpdateRunCompleted(ctx, sqlcgen.UpdateRunCompletedParams{
			CompletedAt:      pgtype.Timestamp{Time: time.Now(), Valid: true},
			ProcessedFiles:   pgtype.Int4{Int32: 0, Valid: true},
			ProcessedEntries: pgtype.Int4{Int32: 0, Valid: true},
			ID:               runID,
		}); err != nil {
			log.Warn().Err(err).Str("runId", runID).Msg("Failed to mark run as completed")
		}
		return nil // No subtasks to spawn
	}

	// Build fetch_parse payloads for each file
	fetchParsePayloads := make([]interface{}, 0, len(files))
	for i, file := range files {
		fetchParsePayloads = append(fetchParsePayloads, jsonb.FetchParsePayload{
			Type:       string(taskqueue.TaskTypeIngestionFetchParse),
			ChainSlug:  chainSlug,
			RunID:      runID,
			FileURL:    file.URL,
			Filename:   file.Filename,
			FileType:   string(file.Type),
			FileIndex:  i,
			TotalFiles: len(files),
		})
	}

	// Schedule batch child tasks
	count, err := tq.ScheduleBatchChildTasks(
		ctx,
		taskID,
		string(taskqueue.TaskTypeIngestionFetchParse),
		fetchParsePayloads,
		0, // default priority
	)
	if err != nil {
		markDiscoverFailed(ctx, runID, fmt.Sprintf("Failed to schedule fetch_parse tasks: %v", err))
		return fmt.Errorf("failed to schedule fetch_parse tasks: %w", err)
	}

	log.Info().
		Str("runId", runID).
		Int("subtasksScheduled", count).
		Msg("Discover task complete, fetch_parse subtasks scheduled")

	return nil
}

// createIngestionRunForDiscover creates an ingestion run record for the discover phase
func createIngestionRunForDiscover(ctx context.Context, chainID string) string {
	queries := sqlcgen.New(database.Pool())

	runID := cuid2.GeneratePrefixedId("run", cuid2.PrefixedIdOptions{})
	now := time.Now()

	_, err := queries.CreateIngestionRun(ctx, sqlcgen.CreateIngestionRunParams{
		ID:        runID,
		ChainSlug: chainID,
		Source:    "worker",
		Status:    "pending",
		StartedAt: pgtype.Timestamp{Time: now, Valid: true},
		CreatedAt: pgtype.Timestamp{Time: now, Valid: true},
	})

	if err != nil {
		log.Error().Err(err).Msg("Failed to create ingestion run")
		return ""
	}

	return runID
}

// markDiscoverFailed marks an ingestion run as failed during discovery
func markDiscoverFailed(ctx context.Context, runID string, errorMsg string) {
	queries := sqlcgen.New(database.Pool())
	if err := queries.UpdateRunFailed(ctx, sqlcgen.UpdateRunFailedParams{
		Column1: errorMsg,
		ID:      runID,
	}); err != nil {
		log.Warn().Err(err).Str("runId", runID).Msg("Failed to mark run as failed")
	}
}

// spawnStorePrepTask schedules a store_prep task after all fetch_parse tasks complete
func spawnStorePrepTask(ctx context.Context, tq *taskqueue.TaskQueue, parentTaskID, chainSlug, runID string) error {
	storePrepPayload := StorePrepPayload{
		Type:      string(taskqueue.TaskTypeIngestionStorePrep),
		ChainSlug: chainSlug,
		RunID:     runID,
	}

	result := tq.ScheduleChildTask(ctx, taskqueue.ScheduleChildTaskInput{
		ParentTaskID: parentTaskID,
		TaskType:     string(taskqueue.TaskTypeIngestionStorePrep),
		Payload:      storePrepPayload,
		Priority:     0,
	})

	if result.Err != nil {
		return fmt.Errorf("failed to schedule store_prep task: %w", result.Err)
	}

	if err := tq.TransitionToWaiting(ctx, parentTaskID, 1); err != nil {
		log.Warn().Err(err).Str("taskId", parentTaskID).Msg("Failed to transition to waiting")
	}

	log.Info().Str("runId", runID).Str("storePrepTaskId", result.ID).Msg("Scheduled store_prep task")
	return nil
}

// recoverRunIDFromDatabase finds the most recent active run for a chain
func recoverRunIDFromDatabase(ctx context.Context, chainSlug string) (string, error) {
	queries := sqlcgen.New(database.Pool())
	runID, err := queries.RecoverRunIDFromDatabase(ctx, chainSlug)
	if err != nil {
		return "", fmt.Errorf("no active run found for chain %s: %w", chainSlug, err)
	}
	return runID, nil
}
