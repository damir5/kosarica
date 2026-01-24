package pipeline

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/types"
)

// DiscoverPhase executes the discovery phase of the ingestion pipeline
// It discovers available files from the chain's data source
func DiscoverPhase(ctx context.Context, chainID string, runID string, targetDate string) ([]types.DiscoveredFile, error) {
	// Get adapter from registry
	adapter, err := registry.GetAdapter(config.ChainID(chainID))
	if err != nil {
		return nil, fmt.Errorf("failed to get adapter for %s: %w", chainID, err)
	}

	fmt.Printf("[INFO] Starting discovery for chain %s (run %s)\n", chainID, runID)
	if targetDate != "" {
		fmt.Printf("[INFO] Target date: %s\n", targetDate)
	}

	// Discover files
	files, err := adapter.Discover(targetDate)
	if err != nil {
		return nil, fmt.Errorf("discovery failed: %w", err)
	}

	fmt.Printf("[INFO] Discovery complete: found %d files for chain %s\n", len(files), chainID)

	// Initialize run stats and record total files
	if err := initializeRunStats(ctx, runID); err != nil {
		return nil, fmt.Errorf("failed to initialize run stats: %w", err)
	}

	if err := recordTotalFiles(ctx, runID, len(files)); err != nil {
		return nil, fmt.Errorf("failed to record total files: %w", err)
	}

	// If no files found, mark run as completed
	if len(files) == 0 {
		fmt.Printf("[WARN] No files discovered for chain %s\n", chainID)
		if err := markRunCompleted(ctx, runID, 0, 0); err != nil {
			return nil, fmt.Errorf("failed to mark run as completed: %w", err)
		}
	}

	return files, nil
}

// initializeRunStats initializes the ingestion run statistics
func initializeRunStats(ctx context.Context, runID string) error {
	pool := database.Pool()
	_, err := pool.Exec(ctx, `
		UPDATE ingestion_runs
		SET started_at = NOW()
		WHERE id = $1
	`, runID)
	return err
}

// recordTotalFiles records the total number of files to process
func recordTotalFiles(ctx context.Context, runID string, totalFiles int) error {
	pool := database.Pool()
	_, err := pool.Exec(ctx, `
		UPDATE ingestion_runs
		SET total_files = $1
		WHERE id = $2
	`, totalFiles, runID)
	return err
}

// markRunCompleted marks an ingestion run as completed
func markRunCompleted(ctx context.Context, runID string, processedFiles int, processedEntries int) error {
	pool := database.Pool()
	now := time.Now()
	_, err := pool.Exec(ctx, `
		UPDATE ingestion_runs
		SET status = 'completed',
		    completed_at = $1,
		    processed_files = COALESCE($2, processed_files),
		    processed_entries = COALESCE($3, processed_entries)
		WHERE id = $4
	`, now, processedFiles, processedEntries, runID)
	return err
}

// MarkRunInterrupted marks an ingestion run as interrupted (e.g., service restart)
func MarkRunInterrupted(ctx context.Context, runID string) error {
	pool := database.Pool()
	now := time.Now()
	_, err := pool.Exec(ctx, `
		UPDATE ingestion_runs
		SET status = 'interrupted',
		    completed_at = $1,
		    metadata = jsonb_set(
		        COALESCE(metadata, '{}'::jsonb),
		        '{interrupted_reason}',
		        to_jsonb('Service restarted during processing')
		    )
		WHERE id = $2
	`, now, runID)
	if err != nil {
		return fmt.Errorf("failed to mark run as interrupted: %w", err)
	}
	return nil
}

// markRunFailed marks an ingestion run as failed
func markRunFailed(ctx context.Context, runID string, errorMsg string) error {
	pool := database.Pool()
	_, err := pool.Exec(ctx, `
		UPDATE ingestion_runs
		SET status = 'failed',
		    completed_at = NOW(),
		    metadata = jsonb_set(
		        COALESCE(metadata, '{}'::jsonb),
		        '{error}',
		        to_jsonb($1)
		    )
		WHERE id = $2
	`, errorMsg, runID)
	return err
}

// incrementProcessedFiles increments the processed files count
func incrementProcessedFiles(ctx context.Context, runID string) error {
	pool := database.Pool()
	_, err := pool.Exec(ctx, `
		UPDATE ingestion_runs
		SET processed_files = COALESCE(processed_files, 0) + 1
		WHERE id = $1
	`, runID)
	return err
}

// incrementProcessedEntries increments the processed entries count
func incrementProcessedEntries(ctx context.Context, runID string, count int) error {
	pool := database.Pool()
	_, err := pool.Exec(ctx, `
		UPDATE ingestion_runs
		SET processed_entries = COALESCE(processed_entries, 0) + $1
		WHERE id = $2
	`, count, runID)
	return err
}

// checkAndUpdateRunCompletion checks if run is complete and updates status
func checkAndUpdateRunCompletion(ctx context.Context, runID string) (bool, error) {
	pool := database.Pool()

	var runStatus string
	var totalFiles, processedFiles int
	err := pool.QueryRow(ctx, `
		SELECT status, COALESCE(total_files, 0), COALESCE(processed_files, 0)
		FROM ingestion_runs
		WHERE id = $1
	`, runID).Scan(&runStatus, &totalFiles, &processedFiles)
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, err
	}

	if runStatus == "completed" || runStatus == "failed" {
		return true, nil
	}

	// Check if all files processed
	if totalFiles > 0 && processedFiles >= totalFiles {
		if err := markRunCompleted(ctx, runID, processedFiles, 0); err != nil {
			return false, err
		}
		return true, nil
	}

	return false, nil
}
