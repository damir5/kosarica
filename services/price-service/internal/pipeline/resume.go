package pipeline

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/config"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/storage"
	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog/log"
	"golang.org/x/sync/semaphore"
)

// ResumeRun resumes processing of an interrupted ingestion run
// Returns true if resumption was attempted, false if no files to process
func ResumeRun(ctx context.Context, runID string, chainID string) (bool, error) {
	queries := sqlcgen.New(database.Pool())

	// 1. Get pending/processing files for this run
	files, err := queries.ListPendingFilesForResume(ctx, runID)
	if err != nil {
		return false, fmt.Errorf("failed to list pending files: %w", err)
	}

	// 2. If no files: return false (nothing to resume)
	if len(files) == 0 {
		return false, nil
	}

	log.Info().
		Str("run_id", runID).
		Str("chain", chainID).
		Int("files_to_process", len(files)).
		Msg("Resuming interrupted run")

	// 3. Reset 'processing' files to 'pending'
	if err := queries.ResetProcessingFilesToPending(ctx, runID); err != nil {
		return false, fmt.Errorf("failed to reset processing files: %w", err)
	}

	// 4. Update run status to 'running'
	now := time.Now()
	if err := queries.UpdateRunResumed(ctx, sqlcgen.UpdateRunResumedParams{
		StartedAt: pgtype.Timestamp{Time: now, Valid: true},
		ID:        runID,
	}); err != nil {
		return false, fmt.Errorf("failed to update run status: %w", err)
	}

	// 5. Initialize storage backend from config
	storageBackend, err := storage.NewStorageBackend(&config.Get().Storage)
	if err != nil {
		return false, fmt.Errorf("failed to initialize storage: %w", err)
	}

	// 6. Process files using same parallelism as normal runs
	dbPool := database.Pool()
	parallelism := getIngestionParallelism(dbPool.Config().MaxConns)
	sem := semaphore.NewWeighted(int64(parallelism))

	var wg sync.WaitGroup
	var resultMu sync.Mutex
	result := &IngestionResult{
		RunID:  runID,
		Errors: make([]string, 0),
	}

	for _, file := range files {
		// Check for context cancellation
		select {
		case <-ctx.Done():
			log.Warn().Msg("Context cancelled during resume, stopping")
			goto waitForWorkers
		default:
		}

		// Acquire semaphore
		if err := sem.Acquire(ctx, 1); err != nil {
			log.Error().Err(err).Msg("Failed to acquire semaphore")
			goto waitForWorkers
		}

		wg.Add(1)
		go func(f sqlcgen.ListPendingFilesForResumeRow) {
			defer wg.Done()
			defer sem.Release(1)

			// Track concurrent workers
			IncrementConcurrentWorkers(ctx, chainID)
			defer DecrementConcurrentWorkers(ctx, chainID)

			// Process single file
			if err := processFileResume(ctx, f, runID, chainID, storageBackend, resultMu, result); err != nil {
				log.Error().Err(err).
					Str("filename", f.Filename).
					Msg("Failed to process file during resume")
			}
		}(file)
	}

waitForWorkers:
	wg.Wait()

	// 7. Update run status based on results
	if len(result.Errors) == 0 {
		MarkRunCompleted(ctx, runID, result.FilesProcessed, result.EntriesPersisted)
	} else {
		UpdateRunStatusSummary(ctx, runID, "Resume completed with errors", types.SeverityWarning, "resume_partial")
	}

	return true, nil
}

// processFileResume processes a single file during resumption
func processFileResume(
	ctx context.Context,
	file sqlcgen.ListPendingFilesForResumeRow,
	runID string,
	chainID string,
	storageBackend storage.Storage,
	resultMu sync.Mutex,
	result *IngestionResult,
) error {
	log.Info().Str("filename", file.Filename).Msg("Resuming file")

	// Convert fileID to string for helper functions
	fileID := fmt.Sprintf("%d", file.ID)

	var content []byte
	var archive *database.Archive
	var err error
	var fetchResult *FetchResult

	// Check if file was already fetched (has file_hash)
	if file.FileHash.Valid {
		// Load from archive
		archive, err = database.GetArchiveByChecksum(ctx, file.FileHash.String)
		if err != nil {
			log.Warn().Err(err).Str("filename", file.Filename).Msg("Archive not found, will re-fetch")
		} else {
			// Load content from storage
			content, err = storageBackend.Get(ctx, archive.ArchivePath)
			if err != nil {
				log.Warn().Err(err).Str("filename", file.Filename).Msg("Storage load failed, will re-fetch")
				archive = nil // Clear to trigger re-fetch
			} else {
				log.Info().Str("filename", file.Filename).Str("archive", archive.ID).Msg("Loaded from archive")
				fileSize := int64(0)
				if archive.FileSize != nil {
					fileSize = *archive.FileSize
				}
				fetchResult = &FetchResult{
					Content:   content,
					Hash:      archive.Checksum,
					ArchiveID: archive.ID,
					FileSize:  int(fileSize),
				}
			}
		}
	}

	// If no content loaded, we need to fetch from source
	if fetchResult == nil {
		log.Warn().Str("filename", file.Filename).Msg("No archive available, skipping (source URL not available)")
		// Mark as failed since we can't re-fetch without the source URL
		if err := markIngestionFileFailed(ctx, fileID, "Source URL not available for resume", types.SeverityError, string(types.ErrorTypeFetch)); err != nil {
			log.Warn().Err(err).Str("file_id", fileID).Msg("Failed to mark file as failed")
		}
		resultMu.Lock()
		result.FilesProcessed++
		result.Errors = append(result.Errors, fmt.Sprintf("No archive for %s", file.Filename))
		resultMu.Unlock()
		return nil
	}

	// Create a DiscoveredFile for parsing
	discoveredFile := types.DiscoveredFile{
		Filename: file.Filename,
		Type:     types.FileType(file.FileType),
		URL:      "", // Not available during resume
	}

	// Phase 3: Parse - CPU-bound
	parseStart := time.Now()
	parseResult, err := ParsePhase(ctx, chainID, fetchResult, discoveredFile, runID, fileID)
	RecordPhaseDuration(ctx, PhaseParse, chainID, time.Since(parseStart))

	if err != nil {
		errMsg := fmt.Sprintf("Parse failed for %s: %v", file.Filename, err)
		resultMu.Lock()
		result.Errors = append(result.Errors, errMsg)
		result.FilesProcessed++
		resultMu.Unlock()
		log.Error().Str("error", errMsg).Msg("Parse failed during resume")
		recordIngestionError(ctx, IngestionErrorParams{
			RunID:        runID,
			FileID:       fileID,
			ErrorType:    types.ErrorTypeParse,
			ErrorMessage: errMsg,
			ErrorDetails: formatErrorDetails(err.Error(), map[string]string{
				"phase":     "resume_parse",
				"filename":  file.Filename,
				"archiveId": fetchResult.ArchiveID,
			}),
			Severity: types.SeverityError,
		})
		UpdateRunStatusSummary(ctx, runID, "Parse failed during resume", types.SeverityError, string(types.ErrorTypeParse))
		if err := markIngestionFileFailed(ctx, fileID, "Parse failed", types.SeverityError, string(types.ErrorTypeParse)); err != nil {
			log.Warn().Err(err).Str("file_id", fileID).Msg("Failed to mark file as failed")
		}
		RecordFileProcessed(ctx, chainID, "parse_failed")
		return nil
	}

	if parseResult.ValidRows == 0 {
		log.Info().Str("filename", file.Filename).Msg("No valid rows, skipping persist")
		resultMu.Lock()
		result.FilesProcessed++
		resultMu.Unlock()
		// Update run progress for empty files
		if err := incrementProcessedFiles(ctx, runID); err != nil {
			log.Warn().Err(err).Msg("Failed to increment processed files")
		}
		RecordFileProcessed(ctx, chainID, "empty")
		return nil
	}

	// Phase 4: Persist
	persistStart := time.Now()
	persistResult, err := PersistPhase(ctx, chainID, parseResult, discoveredFile, runID, fetchResult.ArchiveID)
	RecordPhaseDuration(ctx, PhasePersist, chainID, time.Since(persistStart))

	if err != nil {
		errMsg := fmt.Sprintf("Persist failed for %s: %v", file.Filename, err)
		resultMu.Lock()
		result.Errors = append(result.Errors, errMsg)
		result.FilesProcessed++
		resultMu.Unlock()
		log.Error().Str("error", errMsg).Msg("Persist failed during resume")
		recordIngestionError(ctx, IngestionErrorParams{
			RunID:        runID,
			FileID:       fileID,
			ErrorType:    types.ErrorTypePersist,
			ErrorMessage: errMsg,
			ErrorDetails: formatErrorDetails(err.Error(), map[string]string{
				"phase":     "resume_persist",
				"filename":  file.Filename,
				"archiveId": fetchResult.ArchiveID,
			}),
			Severity: types.SeverityError,
		})
		UpdateRunStatusSummary(ctx, runID, "Persist failed", types.SeverityError, string(types.ErrorTypePersist))
		if err := markIngestionFileFailed(ctx, fileID, "Persist failed", types.SeverityError, string(types.ErrorTypePersist)); err != nil {
			log.Warn().Err(err).Str("file_id", fileID).Msg("Failed to mark file as failed")
		}
		RecordFileProcessed(ctx, chainID, "persist_failed")
		return nil
	}

	// Mark file as completed
	if err := markIngestionFileCompletedWithSummary(ctx, fileID, persistResult.Persisted, "", "", ""); err != nil {
		log.Warn().Err(err).Str("file_id", fileID).Msg("Failed to mark file as completed")
	}

	// Update result
	resultMu.Lock()
	result.FilesProcessed++
	result.EntriesPersisted += persistResult.Persisted
	resultMu.Unlock()

	log.Info().
		Str("filename", file.Filename).
		Int("rows", persistResult.Persisted).
		Msg("File resumed successfully")

	RecordFileProcessed(ctx, chainID, "success")
	return nil
}
