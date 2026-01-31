package handlers

import (
	"context"
	"fmt"
	"runtime/debug"

	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/jsonb"
	"github.com/kosarica/price-service/internal/pipeline"
	"github.com/rs/zerolog/log"
)

// HandleIngestionTask processes an ingestion task from the queue
// This is registered with the worker pool to handle "ingestion" task types
func HandleIngestionTask(ctx context.Context, payload jsonb.TaskQueuePayload) error {
	// Extract payload fields
	chainSlug := payload.ChainSlug
	if chainSlug == "" {
		return fmt.Errorf("missing chainSlug in task payload")
	}

	if payload.RunID == nil {
		return fmt.Errorf("missing runId in task payload")
	}
	runID := *payload.RunID

	targetDate := ""
	if payload.TargetDate != nil {
		targetDate = *payload.TargetDate
	}

	log.Info().
		Str("runId", runID).
		Str("chain", chainSlug).
		Str("date", targetDate).
		Msg("Processing ingestion task")

	// Update status to running
	queries := sqlcgen.New(database.Pool())
	err := queries.UpdateIngestionRunToRunning(ctx, runID)
	if err != nil {
		log.Error().Err(err).Str("runId", runID).Msg("Failed to update run status to running")
		return fmt.Errorf("failed to update run status: %w", err)
	}

	// Execute actual ingestion with panic recovery
	result, runErr := executeIngestionWithRecovery(ctx, chainSlug, targetDate, runID)

	// Update final status based on result
	if runErr != nil {
		log.Error().Err(runErr).Str("runId", runID).Msg("Ingestion failed")
		pipeline.MarkRunFailed(ctx, runID, runErr.Error())
		return runErr // Return error to trigger retry
	}

	if !result.Success {
		log.Warn().Str("runId", runID).Int("errors", len(result.Errors)).Msg("Ingestion completed with errors")
		pipeline.MarkRunFailed(ctx, runID, fmt.Sprintf("Ingestion completed with %d errors", len(result.Errors)))
		return fmt.Errorf("ingestion completed with errors")
	}

	log.Info().
		Str("runId", runID).
		Int("files", result.FilesProcessed).
		Int("entries", result.EntriesPersisted).
		Msg("Ingestion completed successfully")

	pipeline.MarkRunCompleted(ctx, runID, result.FilesProcessed, result.EntriesPersisted)
	return nil
}

// executeIngestionWithRecovery runs the ingestion pipeline with panic recovery
func executeIngestionWithRecovery(ctx context.Context, chainSlug, targetDate, runID string) (result *pipeline.IngestionResult, err error) {
	defer func() {
		if r := recover(); r != nil {
			log.Error().
				Interface("panic", r).
				Str("runId", runID).
				Str("chain", chainSlug).
				Str("stack", string(debug.Stack())).
				Msg("Ingestion panicked")
			err = fmt.Errorf("panic during ingestion: %v", r)
		}
	}()

	result, err = pipeline.Run(ctx, chainSlug, targetDate, runID)
	if err != nil {
		return nil, err
	}

	return result, nil
}
