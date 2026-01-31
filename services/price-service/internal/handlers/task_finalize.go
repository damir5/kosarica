package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/config"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/jsonb"
	"github.com/kosarica/price-service/internal/storage"
	"github.com/rs/zerolog/log"
)

// HandleFinalizeTask processes an ingestion_finalize task from the queue.
// It updates the run status, calculates statistics, and cleans up intermediate files.
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

	// Get run statistics from intermediate storage
	storageBackend, err := storage.NewStorageBackend(&config.Get().Storage)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to initialize storage for stats calculation")
	}

	var processedFiles, processedEntries int
	if storageBackend != nil {
		if intermediateStorage, ok := storageBackend.(storage.IntermediateStorage); ok {
			processedFiles, processedEntries = calculateRunStats(ctx, intermediateStorage, runID)
		}
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

	// Clean up intermediate files
	if storageBackend != nil {
		if intermediateStorage, ok := storageBackend.(storage.IntermediateStorage); ok {
			if err := intermediateStorage.DeleteIntermediateDir(ctx, runID); err != nil {
				log.Warn().Err(err).Str("runId", runID).Msg("Failed to delete intermediate files")
				// Don't fail the task for cleanup errors
			} else {
				log.Info().Str("runId", runID).Msg("Deleted intermediate files")
			}
		}
	}

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

// calculateRunStats calculates statistics from intermediate storage
func calculateRunStats(ctx context.Context, storage storage.IntermediateStorage, runID string) (processedFiles, processedEntries int) {
	files, err := storage.ListIntermediateFiles(ctx, runID)
	if err != nil {
		log.Warn().Err(err).Str("runId", runID).Msg("Failed to list intermediate files for stats")
		return 0, 0
	}

	storeCount := 0
	totalEntries := 0

	for _, file := range files {
		// Count store files
		if len(file) > 7 && file[:7] == "stores/" {
			storeCount++

			// Try to read store data for entry count
			var storeData jsonb.ParsedStoreData
			if err := storage.ReadIntermediateJSON(ctx, runID, file, &storeData); err == nil {
				totalEntries += len(storeData.Rows)
			}
		}
	}

	// Also try to read manifest for accurate file count
	var manifest jsonb.RunManifest
	if err := storage.ReadIntermediateJSON(ctx, runID, "manifest.json", &manifest); err == nil {
		processedFiles = len(manifest.Files)
	} else {
		// Fall back to store count as file count approximation
		processedFiles = storeCount
	}

	return processedFiles, totalEntries
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
