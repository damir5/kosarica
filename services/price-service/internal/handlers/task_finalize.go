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

	// Get run statistics from database (archives and price tiers)
	processedFiles, processedEntries := calculateRunStatsFromDB(ctx, runID)

	// Check for failed tasks for this run
	var failedCount int
	err = database.Pool().QueryRow(ctx, `
		SELECT COUNT(*) FROM task_queue
		WHERE status = 'failed' AND payload::text LIKE '%' || $1 || '%'
	`, runID).Scan(&failedCount)
	if err != nil {
		log.Warn().Err(err).Str("runId", runID).Msg("Failed to check for failed tasks")
		failedCount = 0
	}

	if failedCount > 0 {
		log.Warn().Str("runId", runID).Int("failedTasks", failedCount).
			Msg("Run completed with failed tasks")
	}

	// Update run status to completed
	queries := sqlcgen.New(database.Pool())
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
func calculateRunStatsFromDB(ctx context.Context, runID string) (processedFiles, processedEntries int) {
	pool := database.Pool()

	// Count archives for this run
	var archiveCount int
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM archives WHERE run_id = $1
	`, runID).Scan(&archiveCount)
	if err != nil {
		log.Warn().Err(err).Str("runId", runID).Msg("Failed to count archives")
		archiveCount = 0
	}

	// Count price entries created (store_price_refs) for stores in this run
	// This is an approximation based on archives linked to the run
	var entryCount int
	err = pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM store_price_refs spr
		WHERE EXISTS (
			SELECT 1 FROM stores s
			WHERE s.id = spr.store_id
			AND s.updated_at >= (SELECT MIN(created_at) FROM archives WHERE run_id = $1)
		)
	`, runID).Scan(&entryCount)
	if err != nil {
		log.Warn().Err(err).Str("runId", runID).Msg("Failed to count price entries")
		entryCount = 0
	}

	return archiveCount, entryCount
}

// updatePriceTierStoreCounts updates the store_count field on price_tiers
func updatePriceTierStoreCounts(ctx context.Context, chainSlug string) error {
	pool := database.Pool()

	// Update store counts for all tiers in this chain
	_, err := pool.Exec(ctx, `
		UPDATE price_tiers pt
		SET store_count = (
			SELECT COUNT(DISTINCT spr.store_id)
			FROM store_price_refs spr
			WHERE spr.price_tier_id = pt.id
		)
		WHERE pt.chain_slug = $1
	`, chainSlug)

	if err != nil {
		return fmt.Errorf("failed to update store counts: %w", err)
	}

	log.Info().Str("chain", chainSlug).Msg("Updated price tier store counts")
	return nil
}
