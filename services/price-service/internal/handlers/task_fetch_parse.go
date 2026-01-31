package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/kosarica/price-service/config"
	adaptersconfig "github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	zipexpand "github.com/kosarica/price-service/internal/ingestion/zip"
	"github.com/kosarica/price-service/internal/jsonb"
	"github.com/kosarica/price-service/internal/pipeline"
	"github.com/kosarica/price-service/internal/storage"
	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog/log"
)

// HandleFetchParseTask processes an ingestion_fetch_parse task from the queue.
// It downloads a file, parses it, and writes parsed data to intermediate storage.
// This task does NOT write to the database (except archive record).
func HandleFetchParseTask(ctx context.Context, payload jsonb.TaskQueuePayload) error {
	// Extract fetch_parse payload from generic payload
	var fetchParsePayload jsonb.FetchParsePayload
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}
	if err := json.Unmarshal(payloadBytes, &fetchParsePayload); err != nil {
		return fmt.Errorf("failed to unmarshal fetch_parse payload: %w", err)
	}

	chainSlug := fetchParsePayload.ChainSlug
	runID := fetchParsePayload.RunID
	fileURL := fetchParsePayload.FileURL
	filename := fetchParsePayload.Filename
	fileType := fetchParsePayload.FileType

	if chainSlug == "" || runID == "" || fileURL == "" || filename == "" {
		return fmt.Errorf("missing required fields in fetch_parse payload")
	}

	log.Info().
		Str("chain", chainSlug).
		Str("runId", runID).
		Str("filename", filename).
		Int("fileIndex", fetchParsePayload.FileIndex).
		Int("totalFiles", fetchParsePayload.TotalFiles).
		Msg("Processing fetch_parse task")

	// Initialize chain registry
	if err := registry.InitializeDefaultAdapters(); err != nil {
		return fmt.Errorf("failed to initialize chain registry: %w", err)
	}

	// Initialize storage backend
	storageBackend, err := storage.NewStorageBackend(&config.Get().Storage)
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}

	intermediateStorage, ok := storageBackend.(storage.IntermediateStorage)
	if !ok {
		return fmt.Errorf("storage backend does not support intermediate storage")
	}

	// Build discovered file structure
	discoveredFile := types.DiscoveredFile{
		URL:      fileURL,
		Filename: filename,
		Type:     types.FileType(fileType),
	}

	// Phase 1: Fetch
	fetchResult, err := pipeline.FetchPhase(ctx, chainSlug, discoveredFile, storageBackend)
	if err != nil {
		log.Error().Err(err).Str("filename", filename).Msg("Fetch failed")
		return fmt.Errorf("fetch failed for %s: %w", filename, err)
	}

	// Handle duplicate files
	if fetchResult.IsDuplicate {
		log.Info().
			Str("filename", filename).
			Str("archiveId", fetchResult.ArchiveID).
			Msg("Skipping duplicate file")
		// Write a marker file to indicate this file was a duplicate
		markerData := map[string]interface{}{
			"runId":       runID,
			"filename":    filename,
			"archiveId":   fetchResult.ArchiveID,
			"isDuplicate": true,
			"processedAt": time.Now().Format(time.RFC3339),
		}
		markerKey := fmt.Sprintf("files/%s_duplicate.json", sanitizeFilename(filename))
		if err := intermediateStorage.WriteIntermediateJSON(ctx, runID, markerKey, markerData); err != nil {
			log.Warn().Err(err).Str("filename", filename).Msg("Failed to write duplicate marker")
		}
		return nil // Success - duplicate files are expected
	}

	// Phase 2: Parse
	adapter, err := registry.GetAdapter(adaptersconfig.ChainID(chainSlug))
	if err != nil {
		return fmt.Errorf("failed to get adapter for %s: %w", chainSlug, err)
	}

	var parseResult *types.ParseResult
	if fetchResult.IsZip || discoveredFile.Type == types.FileTypeZIP {
		parseResult, err = parseZipContent(ctx, adapter, fetchResult.Content, filename)
	} else {
		parseResult, err = adapter.Parse(fetchResult.Content, filename, nil)
	}

	if err != nil {
		log.Error().Err(err).Str("filename", filename).Msg("Parse failed")
		return fmt.Errorf("parse failed for %s: %w", filename, err)
	}

	log.Info().
		Str("filename", filename).
		Int("totalRows", parseResult.TotalRows).
		Int("validRows", parseResult.ValidRows).
		Msg("Parse complete")

	if parseResult.ValidRows == 0 {
		log.Warn().Str("filename", filename).Msg("No valid rows parsed")
		// Write a marker file indicating empty parse result
		emptyData := map[string]interface{}{
			"runId":       runID,
			"filename":    filename,
			"archiveId":   fetchResult.ArchiveID,
			"isEmpty":     true,
			"totalRows":   parseResult.TotalRows,
			"validRows":   0,
			"processedAt": time.Now().Format(time.RFC3339),
		}
		emptyKey := fmt.Sprintf("files/%s_empty.json", sanitizeFilename(filename))
		if err := intermediateStorage.WriteIntermediateJSON(ctx, runID, emptyKey, emptyData); err != nil {
			log.Warn().Err(err).Str("filename", filename).Msg("Failed to write empty marker")
		}
		return nil // Success - empty files are acceptable
	}

	// Group rows by store identifier
	rowsByStore := groupParsedRowsByStore(parseResult.Rows)

	// Write parsed data to intermediate storage - one file per store
	storesWritten := 0
	for storeIdentifier, rows := range rowsByStore {
		parsedStoreData := jsonb.ParsedStoreData{
			RunID:           runID,
			FileID:          fmt.Sprintf("file_%d", fetchParsePayload.FileIndex),
			ArchiveID:       fetchResult.ArchiveID,
			StoreIdentifier: storeIdentifier,
			ChainSlug:       chainSlug,
			ParsedAt:        time.Now().Format(time.RFC3339),
			Rows:            convertToParsedRows(rows),
		}

		storeKey := storage.BuildStoreDataKey(runID, storeIdentifier)
		if err := intermediateStorage.WriteIntermediateJSON(ctx, runID, storeKey, parsedStoreData); err != nil {
			log.Error().Err(err).
				Str("storeIdentifier", storeIdentifier).
				Str("filename", filename).
				Msg("Failed to write store data to intermediate storage")
			return fmt.Errorf("failed to write store data: %w", err)
		}
		storesWritten++
	}

	log.Info().
		Str("runId", runID).
		Str("filename", filename).
		Int("storesWritten", storesWritten).
		Int("totalRows", parseResult.ValidRows).
		Msg("Fetch_parse task complete, data written to intermediate storage")

	return nil
}

// parseZipContent expands and parses all CSV files from a ZIP archive
func parseZipContent(ctx context.Context, adapter interface{}, content []byte, filename string) (*types.ParseResult, error) {
	// Expand ZIP using the zipexpand package
	expanded, err := zipexpand.ExpandInMemory(content, filename)
	if err != nil {
		return nil, fmt.Errorf("failed to expand ZIP: %w", err)
	}

	if len(expanded) == 0 {
		return nil, fmt.Errorf("no supported files extracted from %s", filename)
	}

	// Parse each expanded file
	type parser interface {
		Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error)
	}

	parseAdapter, ok := adapter.(parser)
	if !ok {
		return nil, fmt.Errorf("adapter does not implement Parse interface")
	}

	result := &types.ParseResult{
		Rows:     make([]types.NormalizedRow, 0),
		Errors:   make([]types.ParseError, 0),
		Warnings: make([]types.ParseWarning, 0),
	}

	for _, inner := range expanded {
		if inner.Type != types.FileTypeCSV {
			continue
		}

		innerResult, err := parseAdapter.Parse(inner.Content, inner.InnerFilename, nil)
		if err != nil {
			log.Warn().Err(err).Str("innerFile", inner.InnerFilename).Msg("Failed to parse inner file")
			continue
		}

		result.TotalRows += innerResult.TotalRows
		result.ValidRows += innerResult.ValidRows
		result.Rows = append(result.Rows, innerResult.Rows...)
		result.Errors = append(result.Errors, innerResult.Errors...)
		result.Warnings = append(result.Warnings, innerResult.Warnings...)
	}

	return result, nil
}

// groupParsedRowsByStore groups normalized rows by store identifier
func groupParsedRowsByStore(rows []types.NormalizedRow) map[string][]types.NormalizedRow {
	result := make(map[string][]types.NormalizedRow)
	for _, row := range rows {
		storeID := row.StoreIdentifier
		if storeID == "" {
			storeID = "unknown"
		}
		result[storeID] = append(result[storeID], row)
	}
	return result
}

// convertToParsedRows converts NormalizedRow slice to ParsedPriceRow slice
func convertToParsedRows(rows []types.NormalizedRow) []jsonb.ParsedPriceRow {
	result := make([]jsonb.ParsedPriceRow, 0, len(rows))
	for _, row := range rows {
		parsedRow := jsonb.ParsedPriceRow{
			Name:     row.Name,
			Price:    row.Price,
			Barcodes: row.Barcodes,
		}
		if row.ExternalID != nil {
			parsedRow.ExternalID = *row.ExternalID
		}
		if row.DiscountPrice != nil {
			parsedRow.DiscountPrice = row.DiscountPrice
		}
		if row.UnitPrice != nil {
			parsedRow.UnitPrice = row.UnitPrice
		}
		if row.AnchorPrice != nil {
			parsedRow.AnchorPrice = row.AnchorPrice
		}
		// InStock field - default to true if not specified
		inStock := true
		parsedRow.InStock = &inStock

		result = append(result, parsedRow)
	}
	return result
}

// sanitizeFilename makes a filename safe for use in storage keys
func sanitizeFilename(filename string) string {
	// Replace problematic characters
	safe := filename
	replacements := [][2]string{
		{"/", "_"},
		{"\\", "_"},
		{":", "_"},
		{"*", "_"},
		{"?", "_"},
		{"\"", "_"},
		{"<", "_"},
		{">", "_"},
		{"|", "_"},
	}
	for _, r := range replacements {
		safe = strings.ReplaceAll(safe, r[0], r[1])
	}
	return safe
}
