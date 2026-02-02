package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/jsonb"
	"github.com/rs/zerolog/log"
)

// HandleFinalizeTask processes an ingestion_finalize task from the queue.
// It updates the run status and calculates statistics from the database.
func HandleFinalizeTask(ctx context.Context, payload jsonb.TaskQueuePayload) error {
	// Extract finalize payload from generic payload
	var finalizePayload jsonb.FinalizePayload
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}
	if err := json.Unmarshal(payloadBytes, &finalizePayload); err != nil {
		return fmt.Errorf("failed to unmarshal finalize payload: %w", err)
	}

	chainSlug := finalizePayload.ChainSlug
	runID := finalizePayload.RunID

	if chainSlug == "" || runID == "" {
		return fmt.Errorf("missing required fields in finalize payload")
	}

	log.Info().
		Str("chain", chainSlug).
		Str("runId", runID).
		Msg("Processing finalize task")

	// Update run status to completed
	queries := sqlcgen.New(database.Pool())

	// Get run statistics from database (archives and price tiers)
	processedFiles, processedEntries := calculateRunStatsFromDB(ctx, queries, runID)

	// Check for failed tasks for this run
	failedCount, err := queries.CountFailedTasksByRunID(ctx, pgtype.Text{String: runID, Valid: true})
	if err != nil {
		log.Warn().Err(err).Str("runId", runID).Msg("Failed to check for failed tasks")
		failedCount = 0
	}

	if failedCount > 0 {
		log.Warn().Str("runId", runID).Int64("failedTasks", failedCount).
			Msg("Run completed with failed tasks")
	}
	now := time.Now()

	err = queries.UpdateRunCompleted(ctx, sqlcgen.UpdateRunCompletedParams{
		CompletedAt:      pgtype.Timestamp{Time: now, Valid: true},
		ProcessedFiles:   pgtype.Int4{Int32: int32(processedFiles), Valid: true},
		ProcessedEntries: pgtype.Int4{Int32: int32(processedEntries), Valid: true},
		ID:               runID,
	})
	if err != nil {
		log.Error().Err(err).Str("runId", runID).Msg("Failed to update run as completed")
		return fmt.Errorf("failed to update run status: %w", err)
	}

	log.Info().
		Str("runId", runID).
		Int("processedFiles", processedFiles).
		Int("processedEntries", processedEntries).
		Msg("Updated run status to completed")

	// Update price tier store counts
	if err := updatePriceTierStoreCounts(ctx, chainSlug); err != nil {
		log.Warn().Err(err).Str("chain", chainSlug).Msg("Failed to update price tier store counts")
		// Don't fail the task for this
	}

	log.Info().
		Str("chain", chainSlug).
		Str("runId", runID).
		Msg("Finalize task complete")

	return nil
}

// calculateRunStatsFromDB calculates statistics from database tables
func calculateRunStatsFromDB(ctx context.Context, queries *sqlcgen.Queries, runID string) (processedFiles, processedEntries int) {
	// Count archives for this run
	archiveCount, err := queries.CountArchivesByRunID(ctx, pgtype.Text{String: runID, Valid: true})
	if err != nil {
		log.Warn().Err(err).Str("runId", runID).Msg("Failed to count archives")
		archiveCount = 0
	}

	// Count price entries created (store_price_refs) for stores in this run
	// This is an approximation based on archives linked to the run
	entryCount, err := queries.CountStorePriceRefsByRunID(ctx, pgtype.Text{String: runID, Valid: true})
	if err != nil {
		log.Warn().Err(err).Str("runId", runID).Msg("Failed to count price entries")
		entryCount = 0
	}

	return int(archiveCount), int(entryCount)
}

// updatePriceTierStoreCounts updates the store_count field on price_tiers
func updatePriceTierStoreCounts(ctx context.Context, chainSlug string) error {
	queries := sqlcgen.New(database.Pool())
	if err := queries.UpdatePriceTierStoreCounts(ctx, chainSlug); err != nil {
		return fmt.Errorf("failed to update store counts: %w", err)
	}

	log.Info().Str("chain", chainSlug).Msg("Updated price tier store counts")
	return nil
}
