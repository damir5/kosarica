package pipeline

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog/log"
)

// DiscoverPhase executes the discovery phase of the ingestion pipeline
// It discovers available files from the chain's data source
func DiscoverPhase(ctx context.Context, chainID string, runID string, targetDate string) ([]types.DiscoveredFile, error) {
	// Get adapter from registry
	adapter, err := registry.GetAdapter(config.ChainID(chainID))
	if err != nil {
		return nil, fmt.Errorf("failed to get adapter for %s: %w", chainID, err)
	}

	log.Info().
		Str("chain", chainID).
		Str("run_id", runID).
		Msg("Starting discovery")

	if targetDate != "" {
		log.Info().
			Str("target_date", targetDate).
			Msg("Discovery target date")
	}

	// Discover files
	files, err := adapter.Discover(targetDate)
	if err != nil {
		return nil, fmt.Errorf("discovery failed: %w", err)
	}

	log.Info().
		Str("chain", chainID).
		Int("files_found", len(files)).
		Msg("Discovery complete")

	// Initialize run stats and record total files
	if err := initializeRunStats(ctx, runID); err != nil {
		return nil, fmt.Errorf("failed to initialize run stats: %w", err)
	}

	if err := recordTotalFiles(ctx, runID, len(files)); err != nil {
		return nil, fmt.Errorf("failed to record total files: %w", err)
	}

	// If no files found, mark run as completed
	if len(files) == 0 {
		log.Warn().
			Str("chain", chainID).
			Msg("No files discovered")
		if err := markRunCompleted(ctx, runID, 0, 0); err != nil {
			return nil, fmt.Errorf("failed to mark run as completed: %w", err)
		}
	}

	return files, nil
}

// initializeRunStats initializes the ingestion run statistics using sqlc
func initializeRunStats(ctx context.Context, runID string) error {
	queries := sqlcgen.New(database.Pool())
	return queries.UpdateRunStartedAt(ctx, runID)
}

// recordTotalFiles records the total number of files to process using sqlc
func recordTotalFiles(ctx context.Context, runID string, totalFiles int) error {
	queries := sqlcgen.New(database.Pool())
	return queries.UpdateRunTotalFiles(ctx, sqlcgen.UpdateRunTotalFilesParams{
		TotalFiles: pgtype.Int4{Int32: int32(totalFiles), Valid: true},
		ID:         runID,
	})
}

// markRunCompleted marks an ingestion run as completed using sqlc
func markRunCompleted(ctx context.Context, runID string, processedFiles int, processedEntries int) error {
	queries := sqlcgen.New(database.Pool())
	now := time.Now()
	return queries.UpdateRunCompleted(ctx, sqlcgen.UpdateRunCompletedParams{
		CompletedAt:      pgtype.Timestamp{Time: now, Valid: true},
		ProcessedFiles:   pgtype.Int4{Int32: int32(processedFiles), Valid: true},
		ProcessedEntries: pgtype.Int4{Int32: int32(processedEntries), Valid: true},
		ID:               runID,
	})
}

// MarkRunInterrupted marks an ingestion run as interrupted (e.g., service restart)
func MarkRunInterrupted(ctx context.Context, runID string) error {
	queries := sqlcgen.New(database.Pool())
	now := time.Now()
	return queries.UpdateRunInterrupted(ctx, sqlcgen.UpdateRunInterruptedParams{
		CompletedAt: pgtype.Timestamp{Time: now, Valid: true},
		ID:          runID,
	})
}

// markRunFailed marks an ingestion run as failed using sqlc
func markRunFailed(ctx context.Context, runID string, errorMsg string) error {
	queries := sqlcgen.New(database.Pool())
	return queries.UpdateRunFailed(ctx, sqlcgen.UpdateRunFailedParams{
		Column1: errorMsg,
		ID:      runID,
	})
}

// incrementProcessedFiles increments the processed files count using sqlc
func incrementProcessedFiles(ctx context.Context, runID string) error {
	queries := sqlcgen.New(database.Pool())
	return queries.IncrementRunProcessedFiles(ctx, runID)
}

// incrementProcessedEntries increments the processed entries count using sqlc
func incrementProcessedEntries(ctx context.Context, runID string, count int) error {
	queries := sqlcgen.New(database.Pool())
	return queries.IncrementRunProcessedEntries(ctx, sqlcgen.IncrementRunProcessedEntriesParams{
		ProcessedEntries: pgtype.Int4{Int32: int32(count), Valid: true},
		ID:               runID,
	})
}

// checkAndUpdateRunCompletion checks if run is complete and updates status
func checkAndUpdateRunCompletion(ctx context.Context, runID string) (bool, error) {
	queries := sqlcgen.New(database.Pool())

	info, err := queries.GetRunProgressInfo(ctx, runID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, err
	}

	if info.Status == "completed" || info.Status == "failed" {
		return true, nil
	}

	totalFiles := int(info.TotalFiles)
	processedFiles := int(info.ProcessedFiles)

	// Check if all files processed
	if totalFiles > 0 && processedFiles >= totalFiles {
		if err := markRunCompleted(ctx, runID, processedFiles, 0); err != nil {
			return false, err
		}
		return true, nil
	}

	return false, nil
}
