package handlers

import (
	"context"
	"fmt"

	"github.com/kosarica/price-service/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/jsonb"
	"github.com/kosarica/price-service/internal/pipeline"
	"github.com/kosarica/price-service/internal/storage"
	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog/log"
)

// HandleFetchParseTask processes an ingestion_fetch_parse task from the queue.
// In the redesigned pipeline, this task only fetches and archives the file.
// Parsing is deferred to the Load+Cluster task which reads directly from archives.
func HandleFetchParseTask(ctx context.Context, payload jsonb.TaskQueuePayload) error {
	// Extract fields from payload
	chainSlug := payload.ChainSlug
	runID := ""
	if payload.RunID != nil {
		runID = *payload.RunID
	}
	fileURL := ""
	if payload.FileURL != nil {
		fileURL = *payload.FileURL
	}
	filename := ""
	if payload.Filename != nil {
		filename = *payload.Filename
	}
	fileType := ""
	if payload.FileType != nil {
		fileType = *payload.FileType
	}
	fileIndex := 0
	if payload.FileIndex != nil {
		fileIndex = *payload.FileIndex
	}
	totalFiles := 0
	if payload.TotalFiles != nil {
		totalFiles = *payload.TotalFiles
	}

	if chainSlug == "" || runID == "" || fileURL == "" || filename == "" {
		return fmt.Errorf("missing required fields in fetch_parse payload: chainSlug=%q runId=%q fileUrl=%q filename=%q", chainSlug, runID, fileURL, filename)
	}

	log.Info().
		Str("chain", chainSlug).
		Str("runId", runID).
		Str("filename", filename).
		Int("fileIndex", fileIndex).
		Int("totalFiles", totalFiles).
		Msg("Processing fetch+archive task")

	// Initialize chain registry
	if err := registry.InitializeDefaultAdapters(); err != nil {
		return fmt.Errorf("failed to initialize chain registry: %w", err)
	}

	// Initialize storage backend
	storageBackend, err := storage.NewStorageBackend(&config.Get().Storage)
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}

	// Build discovered file structure
	discoveredFile := types.DiscoveredFile{
		URL:      fileURL,
		Filename: filename,
		Type:     types.FileType(fileType),
	}

	// Fetch and archive (with run_id for Load+Cluster to query)
	fetchResult, err := pipeline.FetchPhaseWithRunId(ctx, chainSlug, discoveredFile, storageBackend, runID)
	if err != nil {
		log.Error().Err(err).Str("filename", filename).Msg("Fetch failed")
		return fmt.Errorf("fetch failed for %s: %w", filename, err)
	}

	// Handle duplicate files
	if fetchResult.IsDuplicate {
		log.Info().
			Str("filename", filename).
			Str("archiveId", fetchResult.ArchiveID).
			Msg("File already archived (duplicate checksum)")
		return nil // Success - duplicate files are expected
	}

	log.Info().
		Str("runId", runID).
		Str("filename", filename).
		Str("archiveId", fetchResult.ArchiveID).
		Int("fileSize", fetchResult.FileSize).
		Msg("Fetch+archive task complete")

	return nil
}
