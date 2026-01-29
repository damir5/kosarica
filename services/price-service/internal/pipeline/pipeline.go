package pipeline

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/pkg/cuid2"
	"github.com/kosarica/price-service/internal/storage"
	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog/log"
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
// If runID is provided, uses that run; otherwise creates a new one
// Returns the ingestion result with success status, run ID, and statistics
func Run(ctx context.Context, chainID string, targetDate string, runID string) (*IngestionResult, error) {
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
	discoveredFiles, err := DiscoverPhase(ctx, chainID, runID, targetDate)
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

	var firstArchiveID string

	// Process each file through fetch, parse, persist phases
	for _, file := range discoveredFiles {
		log.Info().Str("filename", file.Filename).Msg("Processing file")
		fileID := generateFileID()

		if err := createIngestionFilePlaceholder(ctx, fileID, runID, file); err != nil {
			errMsg := fmt.Sprintf("Failed to create ingestion file record for %s: %v", file.Filename, err)
			result.Errors = append(result.Errors, errMsg)
			log.Error().Str("error", errMsg).Msg("File record creation failed")
			UpdateRunStatusSummary(ctx, runID, "File record creation failed", types.SeverityError, string(types.ErrorTypePersist))
			continue
		}

		// Phase 2: Fetch (with storage backend)
		fetchResult, err := FetchPhase(ctx, chainID, file, storageBackend)
		if err != nil {
			errMsg := fmt.Sprintf("Fetch failed for %s: %v", file.Filename, err)
			result.Errors = append(result.Errors, errMsg)
			log.Error().Str("error", errMsg).Msg("Fetch failed")
			recordIngestionError(ctx, IngestionErrorParams{
				RunID:        runID,
				FileID:       fileID,
				ErrorType:    types.ErrorTypeFetch,
				ErrorMessage: errMsg,
				ErrorDetails: formatErrorDetails(err.Error(), map[string]string{
					"phase":    "fetch",
					"url":      file.URL,
					"filename": file.Filename,
				}),
				Severity: types.SeverityError,
			})
			UpdateRunStatusSummary(ctx, runID, "Communication failure", types.SeverityError, string(types.StatusTypeCommunicationFailure))
			if err := markIngestionFileFailed(ctx, fileID, "Communication failure", types.SeverityError, string(types.StatusTypeCommunicationFailure)); err != nil {
				log.Warn().Err(err).Str("file_id", fileID).Msg("Failed to mark file as failed")
			}
			if err := incrementProcessedFiles(ctx, runID); err != nil {
				log.Warn().Err(err).Msg("Failed to increment processed files")
			}
			result.FilesProcessed++
			continue
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
					"url":       file.URL,
					"filename":  file.Filename,
					"archiveId": fetchResult.ArchiveID,
				}),
				Severity: types.SeverityWarning,
			})
			UpdateRunStatusSummary(ctx, runID, reason, types.SeverityWarning, string(types.StatusTypeAlreadyImported))
			if err := markIngestionFileCompletedWithSummary(ctx, fileID, 0, reason, types.SeverityWarning, string(types.StatusTypeAlreadyImported)); err != nil {
				log.Warn().Err(err).Str("file_id", fileID).Msg("Failed to mark duplicate file as completed")
			}
			if err := incrementProcessedFiles(ctx, runID); err != nil {
				log.Warn().Err(err).Msg("Failed to increment processed files")
			}
			result.FilesProcessed++
			continue
		}

		// Store first archive ID for linking to run
		if firstArchiveID == "" && fetchResult.ArchiveID != "" {
			firstArchiveID = fetchResult.ArchiveID
		}

		// Phase 3: Parse
		parseResult, err := ParsePhase(ctx, chainID, fetchResult, file, runID, fileID)
		if err != nil {
			errMsg := fmt.Sprintf("Parse failed for %s: %v", file.Filename, err)
			result.Errors = append(result.Errors, errMsg)
			log.Error().Str("error", errMsg).Msg("Parse failed")
			recordIngestionError(ctx, IngestionErrorParams{
				RunID:        runID,
				FileID:       fileID,
				ErrorType:    types.ErrorTypeParse,
				ErrorMessage: errMsg,
				ErrorDetails: formatErrorDetails(err.Error(), map[string]string{
					"phase":      "parse",
					"url":        file.URL,
					"filename":   file.Filename,
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
			if err := incrementProcessedFiles(ctx, runID); err != nil {
				log.Warn().Err(err).Msg("Failed to increment processed files")
			}
			result.FilesProcessed++
			continue
		}

		if parseResult.ValidRows == 0 {
			log.Info().Str("filename", file.Filename).Msg("No valid rows, skipping persist")
			result.FilesProcessed++
			// Update run progress for empty files
			if err := incrementProcessedFiles(ctx, runID); err != nil {
				log.Warn().Err(err).Msg("Failed to increment processed files")
			}
			continue
		}

		// Phase 4: Persist (with archive ID)
		persistResult, err := PersistPhase(ctx, chainID, parseResult, file, runID, fetchResult.ArchiveID)
		if err != nil {
			errMsg := fmt.Sprintf("Persist failed for %s: %v", file.Filename, err)
			result.Errors = append(result.Errors, errMsg)
			log.Error().Str("error", errMsg).Msg("Persist failed")
			recordIngestionError(ctx, IngestionErrorParams{
				RunID:        runID,
				FileID:       fileID,
				ErrorType:    types.ErrorTypePersist,
				ErrorMessage: errMsg,
				ErrorDetails: formatErrorDetails(err.Error(), map[string]string{
					"phase":     "persist",
					"url":       file.URL,
					"filename":  file.Filename,
					"archiveId": fetchResult.ArchiveID,
				}),
				Severity: types.SeverityError,
			})
			UpdateRunStatusSummary(ctx, runID, "Persist failed", types.SeverityError, string(types.ErrorTypePersist))
			if err := markIngestionFileFailed(ctx, fileID, "Persist failed", types.SeverityError, string(types.ErrorTypePersist)); err != nil {
				log.Warn().Err(err).Str("file_id", fileID).Msg("Failed to mark file as failed")
			}
			continue
		}

		result.FilesProcessed++
		result.EntriesPersisted += persistResult.Persisted
	}

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
