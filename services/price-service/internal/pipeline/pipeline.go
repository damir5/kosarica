package pipeline

import (
	"context"
	"fmt"
	"time"

	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/pkg/cuid2"
	"github.com/kosarica/price-service/internal/storage"
)

// IngestionResult represents the result of an ingestion run
type IngestionResult struct {
	Success          bool
	RunID            string
	FilesProcessed   int
	EntriesPersisted int
	Errors           []string
}

// Run executes the full ingestion pipeline for a chain
// Returns the ingestion result with success status, run ID, and statistics
func Run(ctx context.Context, chainID string, targetDate string) (*IngestionResult, error) {
	// Validate chain ID
	if !config.IsValidChainID(chainID) {
		return nil, fmt.Errorf("invalid chain ID: %s", chainID)
	}

	// Initialize chain registry
	if err := registry.InitializeDefaultAdapters(); err != nil {
		return nil, fmt.Errorf("failed to initialize chain registry: %w", err)
	}

	// Initialize storage backend
	storageBackend, err := storage.NewLocalStorage("./data/archives")
	if err != nil {
		return nil, fmt.Errorf("failed to initialize storage: %w", err)
	}

	// Create ingestion run
	runID := createIngestionRun(ctx, chainID)
	if runID == "" {
		return nil, fmt.Errorf("failed to create ingestion run")
	}

	fmt.Printf("[INFO] Starting ingestion run %s for chain %s\n", runID, chainID)

	result := &IngestionResult{
		RunID:  runID,
		Errors: make([]string, 0),
	}

	// Phase 1: Discover
	fmt.Printf("[INFO] Phase 1: Discovery\n")
	discoveredFiles, err := DiscoverPhase(ctx, chainID, runID, targetDate)
	if err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("Discovery failed: %v", err))
		markRunFailed(ctx, runID, err.Error())
		result.Success = false
		return result, nil
	}

	if len(discoveredFiles) == 0 {
		fmt.Printf("[INFO] No files discovered, ingestion complete\n")
		result.Success = true
		return result, nil
	}

	fmt.Printf("[INFO] Discovered %d files\n", len(discoveredFiles))

	var firstArchiveID string

	// Process each file through fetch, parse, persist phases
	for _, file := range discoveredFiles {
		fmt.Printf("[INFO] Processing file: %s\n", file.Filename)

		// Phase 2: Fetch (with storage backend)
		fetchResult, err := FetchPhase(ctx, chainID, file, storageBackend)
		if err != nil {
			errMsg := fmt.Sprintf("Fetch failed for %s: %v", file.Filename, err)
			result.Errors = append(result.Errors, errMsg)
			fmt.Printf("[ERROR] %s\n", errMsg)
			continue
		}

		if fetchResult == nil {
			// Duplicate file, skip
			continue
		}

		// Store first archive ID for linking to run
		if firstArchiveID == "" && fetchResult.ArchiveID != "" {
			firstArchiveID = fetchResult.ArchiveID
		}

		// Phase 3: Parse
		parseResult, err := ParsePhase(ctx, chainID, fetchResult, file, runID)
		if err != nil {
			errMsg := fmt.Sprintf("Parse failed for %s: %v", file.Filename, err)
			result.Errors = append(result.Errors, errMsg)
			fmt.Printf("[ERROR] %s\n", errMsg)
			continue
		}

		if parseResult.ValidRows == 0 {
			fmt.Printf("[INFO] No valid rows in %s, skipping persist\n", file.Filename)
			result.FilesProcessed++
			// Update run progress for empty files
			if err := incrementProcessedFiles(ctx, runID); err != nil {
				fmt.Printf("[WARN] Failed to increment processed files: %v\n", err)
			}
			continue
		}

		// Phase 4: Persist (with archive ID)
		persistResult, err := PersistPhase(ctx, chainID, parseResult, file, runID, fetchResult.ArchiveID)
		if err != nil {
			errMsg := fmt.Sprintf("Persist failed for %s: %v", file.Filename, err)
			result.Errors = append(result.Errors, errMsg)
			fmt.Printf("[ERROR] %s\n", errMsg)
			continue
		}

		result.FilesProcessed++
		result.EntriesPersisted += persistResult.Persisted
	}

	// Link first archive to ingestion run
	if firstArchiveID != "" {
		if err := database.LinkArchiveToIngestionRun(ctx, firstArchiveID, runID); err != nil {
			fmt.Printf("[WARN] Failed to link archive to run: %v\n", err)
		} else {
			fmt.Printf("[INFO] Linked archive %s to run %s\n", firstArchiveID, runID)
		}
	}

	// Mark run as completed
	fmt.Printf("[INFO] Ingestion run %s complete: %d files, %d entries\n", runID, result.FilesProcessed, result.EntriesPersisted)
	if len(result.Errors) > 0 {
		fmt.Printf("[WARN] Run completed with %d errors\n", len(result.Errors))
	}

	// Update run status to completed
	if err := markRunCompleted(ctx, runID, result.FilesProcessed, result.EntriesPersisted); err != nil {
		fmt.Printf("[WARN] Failed to mark run as completed: %v\n", err)
	}

	result.Success = len(result.Errors) == 0
	return result, nil
}

// createIngestionRun creates an ingestion run record in the database
func createIngestionRun(ctx context.Context, chainID string) string {
	pool := database.Pool()

	runID := cuid2.GeneratePrefixedId("run", cuid2.PrefixedIdOptions{})
	now := time.Now()

	_, err := pool.Exec(ctx, `
		INSERT INTO ingestion_runs (
			id, chain_slug, source, status, started_at, created_at
		) VALUES (
			$1, $2, 'worker', 'running', $3, $4
		)
	`, runID, chainID, now, now)

	if err != nil {
		fmt.Printf("[ERROR] Failed to create ingestion run: %v\n", err)
		return ""
	}

	return runID
}
