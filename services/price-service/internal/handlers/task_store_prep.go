package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/kosarica/price-service/config"
	adaptersconfig "github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/database"
	zipexpand "github.com/kosarica/price-service/internal/ingestion/zip"
	"github.com/kosarica/price-service/internal/jsonb"
	"github.com/kosarica/price-service/internal/storage"
	"github.com/kosarica/price-service/internal/taskqueue"
	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog/log"
)

// StorePrepPayload is the payload for ingestion_store_prep tasks
type StorePrepPayload struct {
	Type      string `json:"type"`
	ChainSlug string `json:"chainSlug"`
	RunID     string `json:"runId"`
}

// HandleStorePrepTask processes an ingestion_store_prep task.
// It loads archives for this run, parses them to extract unique stores,
// batch upserts stores to DB, then spawns the Load+Cluster task.
func HandleStorePrepTask(ctx context.Context, payload jsonb.TaskQueuePayload, tq *taskqueue.TaskQueue, taskID string) error {
	// Extract store_prep payload from generic payload
	var storePrepPayload StorePrepPayload
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}
	if err := json.Unmarshal(payloadBytes, &storePrepPayload); err != nil {
		return fmt.Errorf("failed to unmarshal store_prep payload: %w", err)
	}

	chainSlug := storePrepPayload.ChainSlug
	runID := storePrepPayload.RunID

	if chainSlug == "" || runID == "" {
		return fmt.Errorf("missing required fields in store_prep payload")
	}

	log.Info().
		Str("chain", chainSlug).
		Str("runId", runID).
		Str("taskId", taskID).
		Msg("Processing store_prep task")

	startTime := time.Now()

	// Initialize chain registry
	if err := registry.InitializeDefaultAdapters(); err != nil {
		return fmt.Errorf("failed to initialize chain registry: %w", err)
	}

	// Get adapter for parsing
	adapter, err := registry.GetAdapter(adaptersconfig.ChainID(chainSlug))
	if err != nil {
		return fmt.Errorf("failed to get adapter for %s: %w", chainSlug, err)
	}

	// Initialize storage backend
	storageBackend, err := storage.NewStorageBackend(&config.Get().Storage)
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}

	// Get all archives for this run
	archives, err := database.GetArchivesByRunId(ctx, runID)
	if err != nil {
		return fmt.Errorf("failed to get archives for run %s: %w", runID, err)
	}

	log.Info().
		Str("runId", runID).
		Int("archiveCount", len(archives)).
		Msg("Found archives for store prep")

	if len(archives) == 0 {
		log.Warn().Str("runId", runID).Msg("No archives found for run, spawning load+cluster anyway")
		return spawnLoadClusterTask(ctx, tq, taskID, chainSlug, runID)
	}

	// Extract unique store identifiers from all archives
	storeIdentifiers := make(map[string]struct{})
	archivesProcessed := 0
	totalRows := 0

	for _, archive := range archives {
		// Load archive content from storage
		content, err := storageBackend.Get(ctx, archive.ArchivePath)
		if err != nil {
			log.Warn().Err(err).
				Str("archiveId", archive.ID).
				Str("archivePath", archive.ArchivePath).
				Msg("Failed to load archive, skipping")
			continue
		}

		// Parse archive to extract store identifiers
		fileType := types.FileType(archive.OriginalFormat)
		var parseResult *types.ParseResult

		if fileType == types.FileTypeZIP {
			parseResult, err = parseZipContentForStores(ctx, adapter, content, archive.Filename)
		} else {
			parseResult, err = parseContentForStores(adapter, content, archive.Filename)
		}

		if err != nil {
			log.Warn().Err(err).
				Str("archiveId", archive.ID).
				Str("filename", archive.Filename).
				Msg("Failed to parse archive, skipping")
			continue
		}

		// Extract unique store identifiers
		for _, row := range parseResult.Rows {
			if row.StoreIdentifier != "" {
				storeIdentifiers[row.StoreIdentifier] = struct{}{}
			}
		}

		archivesProcessed++
		totalRows += parseResult.ValidRows
	}

	log.Info().
		Str("runId", runID).
		Int("archivesProcessed", archivesProcessed).
		Int("uniqueStores", len(storeIdentifiers)).
		Int("totalRowsParsed", totalRows).
		Dur("parseDuration", time.Since(startTime)).
		Msg("Finished extracting store identifiers")

	// Convert to slice
	storeIdentifiersList := make([]string, 0, len(storeIdentifiers))
	for id := range storeIdentifiers {
		storeIdentifiersList = append(storeIdentifiersList, id)
	}

	// Batch upsert stores (reusing existing logic from cluster task)
	if len(storeIdentifiersList) > 0 {
		storeStartTime := time.Now()
		storeIDMap, err := upsertStoresBatch(ctx, database.Pool(), chainSlug, storeIdentifiersList)
		if err != nil {
			return fmt.Errorf("failed to upsert stores: %w", err)
		}

		log.Info().
			Str("runId", runID).
			Int("storesUpserted", len(storeIDMap)).
			Dur("storeUpsertDuration", time.Since(storeStartTime)).
			Msg("Store prep complete")
	}

	// Spawn Load+Cluster task
	return spawnLoadClusterTask(ctx, tq, taskID, chainSlug, runID)
}

// parseContentForStores parses content using the adapter
func parseContentForStores(adapter interface{}, content []byte, filename string) (*types.ParseResult, error) {
	type parser interface {
		Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error)
	}

	parseAdapter, ok := adapter.(parser)
	if !ok {
		return nil, fmt.Errorf("adapter does not implement Parse interface")
	}

	return parseAdapter.Parse(content, filename, nil)
}

// parseZipContentForStores expands and parses all CSV files from a ZIP archive
func parseZipContentForStores(ctx context.Context, adapter interface{}, content []byte, filename string) (*types.ParseResult, error) {
	// Expand ZIP using the zipexpand package
	expanded, err := zipexpand.ExpandInMemory(content, filename)
	if err != nil {
		return nil, fmt.Errorf("failed to expand ZIP: %w", err)
	}

	if len(expanded) == 0 {
		return nil, fmt.Errorf("no supported files extracted from %s", filename)
	}

	// Parse each expanded file
	type parser interface {
		Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error)
	}

	parseAdapter, ok := adapter.(parser)
	if !ok {
		return nil, fmt.Errorf("adapter does not implement Parse interface")
	}

	result := &types.ParseResult{
		Rows:     make([]types.NormalizedRow, 0),
		Errors:   make([]types.ParseError, 0),
		Warnings: make([]types.ParseWarning, 0),
	}

	for _, inner := range expanded {
		if inner.Type != types.FileTypeCSV {
			continue
		}

		innerResult, err := parseAdapter.Parse(inner.Content, inner.InnerFilename, nil)
		if err != nil {
			log.Warn().Err(err).Str("innerFile", inner.InnerFilename).Msg("Failed to parse inner file")
			continue
		}

		result.TotalRows += innerResult.TotalRows
		result.ValidRows += innerResult.ValidRows
		result.Rows = append(result.Rows, innerResult.Rows...)
		result.Errors = append(result.Errors, innerResult.Errors...)
		result.Warnings = append(result.Warnings, innerResult.Warnings...)
	}

	return result, nil
}

// spawnLoadClusterTask schedules a load+cluster task after store prep
func spawnLoadClusterTask(ctx context.Context, tq *taskqueue.TaskQueue, parentTaskID, chainSlug, runID string) error {
	clusterPayload := jsonb.ClusterPayload{
		Type:      string(taskqueue.TaskTypeIngestionCluster),
		ChainSlug: chainSlug,
		RunID:     runID,
	}

	result := tq.ScheduleChildTask(ctx, taskqueue.ScheduleChildTaskInput{
		ParentTaskID: parentTaskID,
		TaskType:     string(taskqueue.TaskTypeIngestionCluster),
		Payload:      clusterPayload,
		Priority:     0,
	})

	if result.Err != nil {
		return fmt.Errorf("failed to schedule load+cluster task: %w", result.Err)
	}

	// Transition this task to waiting for load+cluster to complete
	if err := tq.TransitionToWaiting(ctx, parentTaskID, 1); err != nil {
		log.Warn().Err(err).Str("taskId", parentTaskID).Msg("Failed to transition to waiting")
	}

	log.Info().
		Str("runId", runID).
		Str("clusterTaskId", result.ID).
		Msg("Scheduled load+cluster task")

	return nil
}
