package pipeline

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/config"
	adaptersconfig "github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/pkg/cuid2"
	"github.com/kosarica/price-service/internal/storage"
	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog/log"
	"golang.org/x/sync/semaphore"
)

// IngestionResult represents the result of an ingestion run
type IngestionResult struct {
	Success          bool
	RunID            string
	FilesProcessed   int
	EntriesPersisted int
	Errors           []string
}

// getIngestionParallelism calculates the parallelism based on DB pool size
// Returns 40% of DB max connections (conservative to avoid pool exhaustion)
// Can be overridden via INGESTION_PARALLELISM environment variable
func getIngestionParallelism(dbMaxConns int32) int {
	// Check for environment variable override
	if envParallelism := os.Getenv("INGESTION_PARALLELISM"); envParallelism != "" {
		var val int
		if _, err := fmt.Sscanf(envParallelism, "%d", &val); err == nil && val > 0 {
			return val
		}
	}

	// Calculate parallelism as 40% of DB pool (conservative)
	parallelism := int(dbMaxConns * 40 / 100)
	if parallelism < 1 {
		parallelism = 1
	}
	return parallelism
}

// Run executes the full ingestion pipeline for a chain
// If runID is provided, uses that run; otherwise creates a new one
// Returns the ingestion result with success status, run ID, and statistics
func Run(ctx context.Context, chainID string, targetDate string, runID string) (*IngestionResult, error) {
	// Validate chain ID
	if !adaptersconfig.IsValidChainID(chainID) {
		return nil, fmt.Errorf("invalid chain ID: %s", chainID)
	}

	// Initialize chain registry
	if err := registry.InitializeDefaultAdapters(); err != nil {
		return nil, fmt.Errorf("failed to initialize chain registry: %w", err)
	}

	// Initialize storage backend from config
	storageBackend, err := storage.NewStorageBackend(&config.Get().Storage)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize storage: %w", err)
	}

	// Use provided runID or create new one
	if runID == "" {
		runID = createIngestionRun(ctx, chainID)
		if runID == "" {
			return nil, fmt.Errorf("failed to create ingestion run")
		}
	}

	log.Info().Str("runId", runID).Str("chain", chainID).Msg("Starting ingestion run")

	result := &IngestionResult{
		RunID:  runID,
		Errors: make([]string, 0),
	}

	// Phase 1: Discover
	log.Info().Msg("Phase 1: Discovery")
	discoverStart := time.Now()
	discoveredFiles, err := DiscoverPhase(ctx, chainID, runID, targetDate)
	RecordPhaseDuration(ctx, PhaseDiscover, chainID, time.Since(discoverStart))
	if err != nil {
		errMsg := fmt.Sprintf("Discovery failed: %v", err)
		result.Errors = append(result.Errors, errMsg)
		recordIngestionError(ctx, IngestionErrorParams{
			RunID:        runID,
			ErrorType:    types.ErrorTypeFetch,
			ErrorMessage: errMsg,
			ErrorDetails: formatErrorDetails(err.Error(), map[string]string{
				"phase":      "discovery",
				"chain":      chainID,
				"targetDate": targetDate,
			}),
			Severity: types.SeverityError,
		})
		UpdateRunStatusSummary(ctx, runID, "Communication failure", types.SeverityError, string(types.StatusTypeCommunicationFailure))
		markRunFailed(ctx, runID, err.Error())
		result.Success = false
		return result, nil
	}

	if len(discoveredFiles) == 0 {
		log.Info().Msg("No files discovered, ingestion complete")
		result.Success = true
		return result, nil
	}

	log.Info().Int("count", len(discoveredFiles)).Msg("Discovered files")

	// Calculate parallelism based on DB pool size
	dbPool := database.Pool()
	dbMaxConns := int32(10) // Default from config
	if dbPool != nil {
		dbMaxConns = dbPool.Config().MaxConns
	}
	parallelism := getIngestionParallelism(dbMaxConns)
	log.Info().Int("parallelism", parallelism).Int32("db_max_conns", dbMaxConns).Msg("File processing parallelism configured")

	var firstArchiveID string
	var resultMu sync.Mutex
	var wg sync.WaitGroup

	// Create semaphore for limiting concurrent file processing
	sem := semaphore.NewWeighted(int64(parallelism))

	// Process each file in parallel (fetch+parse), but persist sequentially per file
	for _, file := range discoveredFiles {
		// Check for context cancellation before acquiring semaphore
		select {
		case <-ctx.Done():
			log.Warn().Msg("Context cancelled, stopping file processing")
			goto waitForWorkers
		default:
		}

		// Acquire semaphore before starting goroutine
		if err := sem.Acquire(ctx, 1); err != nil {
			log.Error().Err(err).Msg("Failed to acquire semaphore, waiting for active workers")
			// Don't break - let already-spawned workers complete
			goto waitForWorkers
		}

		wg.Add(1)
		go func(f types.DiscoveredFile) {
			defer wg.Done()
			defer sem.Release(1)

			// Track concurrent workers
			IncrementConcurrentWorkers(ctx, chainID)
			defer DecrementConcurrentWorkers(ctx, chainID)

			log.Info().Str("filename", f.Filename).Msg("Processing file")
			fileID := generateFileID()

			if err := createIngestionFilePlaceholder(ctx, fileID, runID, f); err != nil {
				errMsg := fmt.Sprintf("Failed to create ingestion file record for %s: %v", f.Filename, err)
				resultMu.Lock()
				result.Errors = append(result.Errors, errMsg)
				result.FilesProcessed++
				resultMu.Unlock()
				log.Error().Str("error", errMsg).Msg("File record creation failed")
				UpdateRunStatusSummary(ctx, runID, "File record creation failed", types.SeverityError, string(types.ErrorTypePersist))
				// incrementProcessedFiles will be called by markIngestionFileFailed
				return
			}

			// Phase 2: Fetch (with storage backend) - IO-bound, parallelized
			fetchStart := time.Now()
			fetchResult, err := FetchPhase(ctx, chainID, f, storageBackend)
			RecordPhaseDuration(ctx, PhaseFetch, chainID, time.Since(fetchStart))

			if err != nil {
				errMsg := fmt.Sprintf("Fetch failed for %s: %v", f.Filename, err)
				resultMu.Lock()
				result.Errors = append(result.Errors, errMsg)
				result.FilesProcessed++
				resultMu.Unlock()
				log.Error().Str("error", errMsg).Msg("Fetch failed")
				recordIngestionError(ctx, IngestionErrorParams{
					RunID:        runID,
					FileID:       fileID,
					ErrorType:    types.ErrorTypeFetch,
					ErrorMessage: errMsg,
					ErrorDetails: formatErrorDetails(err.Error(), map[string]string{
						"phase":    "fetch",
						"url":      f.URL,
						"filename": f.Filename,
					}),
					Severity: types.SeverityError,
				})
				UpdateRunStatusSummary(ctx, runID, "Communication failure", types.SeverityError, string(types.StatusTypeCommunicationFailure))
				if err := markIngestionFileFailed(ctx, fileID, "Communication failure", types.SeverityError, string(types.StatusTypeCommunicationFailure)); err != nil {
					log.Warn().Err(err).Str("file_id", fileID).Msg("Failed to mark file as failed")
				}
				// incrementProcessedFiles will be called by markIngestionFileFailed
				RecordFileProcessed(ctx, chainID, "fetch_failed")
				return
			}

			if err := updateIngestionFileFetchInfo(ctx, fileID, fetchResult.FileSize, fetchResult.Hash); err != nil {
				log.Warn().Err(err).Str("file_id", fileID).Msg("Failed to update file fetch info")
			}

			if fetchResult.IsDuplicate {
				reason := "Already imported"
				recordIngestionError(ctx, IngestionErrorParams{
					RunID:        runID,
					FileID:       fileID,
					ErrorType:    types.ErrorTypeDuplicate,
					ErrorMessage: reason,
					ErrorDetails: formatErrorDetails("Duplicate archive", map[string]string{
						"phase":     "fetch",
						"url":       f.URL,
						"filename":  f.Filename,
						"archiveId": fetchResult.ArchiveID,
					}),
					Severity: types.SeverityWarning,
				})
				UpdateRunStatusSummary(ctx, runID, reason, types.SeverityWarning, string(types.StatusTypeAlreadyImported))
				if err := markIngestionFileCompletedWithSummary(ctx, fileID, 0, reason, types.SeverityWarning, string(types.StatusTypeAlreadyImported)); err != nil {
					log.Warn().Err(err).Str("file_id", fileID).Msg("Failed to mark duplicate file as completed")
				}
				resultMu.Lock()
				result.FilesProcessed++
				resultMu.Unlock()
				// incrementProcessedFiles will be called by markIngestionFileCompletedWithSummary
				RecordFileProcessed(ctx, chainID, "duplicate")
				return
			}

			// Store first archive ID for linking to run
			resultMu.Lock()
			if firstArchiveID == "" && fetchResult.ArchiveID != "" {
				firstArchiveID = fetchResult.ArchiveID
			}
			resultMu.Unlock()

			// Phase 3: Parse - CPU-bound, parallelized
			parseStart := time.Now()
			parseResult, err := ParsePhase(ctx, chainID, fetchResult, f, runID, fileID)
			RecordPhaseDuration(ctx, PhaseParse, chainID, time.Since(parseStart))

			if err != nil {
				errMsg := fmt.Sprintf("Parse failed for %s: %v", f.Filename, err)
				resultMu.Lock()
				result.Errors = append(result.Errors, errMsg)
				result.FilesProcessed++
				resultMu.Unlock()
				log.Error().Str("error", errMsg).Msg("Parse failed")
				recordIngestionError(ctx, IngestionErrorParams{
					RunID:        runID,
					FileID:       fileID,
					ErrorType:    types.ErrorTypeParse,
					ErrorMessage: errMsg,
					ErrorDetails: formatErrorDetails(err.Error(), map[string]string{
						"phase":      "parse",
						"url":        f.URL,
						"filename":   f.Filename,
						"archiveId":  fetchResult.ArchiveID,
						"storageKey": fetchResult.StorageKey,
						"hash":       fetchResult.Hash,
					}),
					Severity: types.SeverityError,
				})
				UpdateRunStatusSummary(ctx, runID, "Parse failed", types.SeverityError, string(types.ErrorTypeParse))
				if err := markIngestionFileFailed(ctx, fileID, "Parse failed", types.SeverityError, string(types.ErrorTypeParse)); err != nil {
					log.Warn().Err(err).Str("file_id", fileID).Msg("Failed to mark file as failed")
				}
				// incrementProcessedFiles will be called by markIngestionFileFailed
				RecordFileProcessed(ctx, chainID, "parse_failed")
				return
			}

			if parseResult.ValidRows == 0 {
				log.Info().Str("filename", f.Filename).Msg("No valid rows, skipping persist")
				resultMu.Lock()
				result.FilesProcessed++
				resultMu.Unlock()
				// Update run progress for empty files - call incrementProcessedFiles
				if err := incrementProcessedFiles(ctx, runID); err != nil {
					log.Warn().Err(err).Msg("Failed to increment processed files")
				}
				RecordFileProcessed(ctx, chainID, "empty")
				return
			}

			// Phase 4: Persist - sequential per file, but files run in parallel
			// This allows DB to handle concurrent operations without excessive lock contention
			persistStart := time.Now()
			persistResult, err := PersistPhase(ctx, chainID, parseResult, f, runID, fetchResult.ArchiveID)
			RecordPhaseDuration(ctx, PhasePersist, chainID, time.Since(persistStart))

			if err != nil {
				errMsg := fmt.Sprintf("Persist failed for %s: %v", f.Filename, err)
				resultMu.Lock()
				result.Errors = append(result.Errors, errMsg)
				resultMu.Unlock()
				log.Error().Str("error", errMsg).Msg("Persist failed")
				recordIngestionError(ctx, IngestionErrorParams{
					RunID:        runID,
					FileID:       fileID,
					ErrorType:    types.ErrorTypePersist,
					ErrorMessage: errMsg,
					ErrorDetails: formatErrorDetails(err.Error(), map[string]string{
						"phase":     "persist",
						"url":       f.URL,
						"filename":  f.Filename,
						"archiveId": fetchResult.ArchiveID,
					}),
					Severity: types.SeverityError,
				})
				UpdateRunStatusSummary(ctx, runID, "Persist failed", types.SeverityError, string(types.ErrorTypePersist))
				if err := markIngestionFileFailed(ctx, fileID, "Persist failed", types.SeverityError, string(types.ErrorTypePersist)); err != nil {
					log.Warn().Err(err).Str("file_id", fileID).Msg("Failed to mark file as failed")
				}
				RecordFileProcessed(ctx, chainID, "persist_failed")
				return
			}

			resultMu.Lock()
			result.FilesProcessed++
			result.EntriesPersisted += persistResult.Persisted
			resultMu.Unlock()
			RecordEntriesPersisted(ctx, chainID, persistResult.Persisted)
			RecordFileProcessed(ctx, chainID, "success")
		}(file)
	}

waitForWorkers:
	// Wait for all file processing goroutines to complete
	wg.Wait()

	// Link first archive to ingestion run
	if firstArchiveID != "" {
		if err := database.LinkArchiveToIngestionRun(ctx, firstArchiveID, runID); err != nil {
			log.Warn().Err(err).Msg("Failed to link archive to run")
		} else {
			log.Info().Str("archiveId", firstArchiveID).Str("runId", runID).Msg("Linked archive to run")
		}
	}

	// Mark run as completed
	log.Info().Str("runId", runID).Int("files", result.FilesProcessed).Int("entries", result.EntriesPersisted).Msg("Ingestion run complete")
	if len(result.Errors) > 0 {
		log.Warn().Int("errors", len(result.Errors)).Msg("Run completed with errors")
	}

	// Update run status to completed
	if err := markRunCompleted(ctx, runID, result.FilesProcessed, result.EntriesPersisted); err != nil {
		log.Warn().Err(err).Msg("Failed to mark run as completed")
	}

	result.Success = len(result.Errors) == 0
	return result, nil
}

// createIngestionRun creates an ingestion run record in the database using sqlc
func createIngestionRun(ctx context.Context, chainID string) string {
	queries := sqlcgen.New(database.Pool())

	runID := cuid2.GeneratePrefixedId("run", cuid2.PrefixedIdOptions{})
	now := time.Now()

	_, err := queries.CreateIngestionRun(ctx, sqlcgen.CreateIngestionRunParams{
		ID:        runID,
		ChainSlug: chainID,
		Source:    "worker",
		Status:    "running",
		StartedAt: pgtype.Timestamp{Time: now, Valid: true},
		CreatedAt: pgtype.Timestamp{Time: now, Valid: true},
	})

	if err != nil {
		log.Error().Err(err).Msg("Failed to create ingestion run")
		return ""
	}

	return runID
}
