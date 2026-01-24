package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog/log"
)

// ParseResult represents the result of parsing a file
type ParseResult struct {
	FileID      string
	RowsByStore map[string][]types.NormalizedRow
	TotalRows   int
	ValidRows   int
}

// ParsePhase executes the parse phase of the ingestion pipeline
// It parses file content into normalized rows
func ParsePhase(ctx context.Context, chainID string, fetchResult *FetchResult, file types.DiscoveredFile, runID string) (*ParseResult, error) {
	// Get adapter from registry
	adapter, err := registry.GetAdapter(config.ChainID(chainID))
	if err != nil {
		return nil, fmt.Errorf("failed to get adapter for %s: %w", chainID, err)
	}

	log.Info().Str("filename", file.Filename).Msg("Parsing file")

	// Parse the content
	parseResult, err := adapter.Parse(fetchResult.Content, file.Filename, nil)
	if err != nil {
		return nil, fmt.Errorf("parse failed for %s: %w", file.Filename, err)
	}

	log.Info().
		Int("total_rows", parseResult.TotalRows).
		Int("valid_rows", parseResult.ValidRows).
		Str("filename", file.Filename).
		Msg("Parsed file")

	// Log any parse errors
	if len(parseResult.Errors) > 0 {
		log.Warn().
			Int("error_count", len(parseResult.Errors)).
			Str("filename", file.Filename).
			Msg("Parse errors found")
		for _, e := range parseResult.Errors[:5] { // Log first 5 errors
			event := log.Warn().
				Str("error", e.Message).
				Str("filename", file.Filename)
			if e.RowNumber != nil {
				event = event.Int("row_number", *e.RowNumber)
			}
			event.Msg("Parse error")
		}
		if len(parseResult.Errors) > 5 {
			log.Warn().
				Int("additional_error_count", len(parseResult.Errors)-5).
				Str("filename", file.Filename).
				Msg("Additional parse errors not shown")
		}
	}

	// Create file record in database
	fileID := generateFileID()
	storeIdentifier := "unknown"
	if storeID := adapter.ExtractStoreIdentifier(file); storeID != nil {
		storeIdentifier = storeID.Value
	}

	if err := createIngestionFile(ctx, fileID, runID, file, fetchResult, parseResult, storeIdentifier); err != nil {
		return nil, fmt.Errorf("failed to create ingestion file record: %w", err)
	}

	if parseResult.ValidRows == 0 {
		log.Info().Str("filename", file.Filename).Msg("No valid rows to persist")
		markFileCompleted(ctx, fileID, 0)
		return &ParseResult{
			FileID:    fileID,
			TotalRows: parseResult.TotalRows,
			ValidRows: 0,
		}, nil
	}

	// Group rows by store identifier
	rowsByStore := groupRowsByStore(parseResult.Rows)

	return &ParseResult{
		FileID:      fileID,
		RowsByStore: rowsByStore,
		TotalRows:   parseResult.TotalRows,
		ValidRows:   parseResult.ValidRows,
	}, nil
}

// createIngestionFile creates an ingestion file record in the database
func createIngestionFile(ctx context.Context, fileID string, runID string, file types.DiscoveredFile, fetchResult *FetchResult, parseResult *types.ParseResult, storeIdentifier string) error {
	pool := database.Pool()

	metadataJSON, _ := json.Marshal(map[string]interface{}{
		"storeIdentifier": storeIdentifier,
		"url":             file.URL,
	})

	_, err := pool.Exec(ctx, `
		INSERT INTO ingestion_files (
			id, run_id, filename, file_type, file_size, file_hash,
			status, entry_count, total_chunks, chunk_size, metadata, created_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, 'processing', $7, 1, $7, $8, NOW()
		)
	`, fileID, runID, file.Filename, string(file.Type), len(fetchResult.Content), fetchResult.Hash,
		parseResult.ValidRows, metadataJSON)

	return err
}

// markFileCompleted marks an ingestion file as completed
func markFileCompleted(ctx context.Context, fileID string, processedChunks int) error {
	pool := database.Pool()

	_, err := pool.Exec(ctx, `
		UPDATE ingestion_files
		SET status = 'completed',
		    processed_chunks = $1,
		    processed_at = NOW()
		WHERE id = $2
	`, processedChunks, fileID)

	return err
}

// groupRowsByStore groups normalized rows by store identifier
func groupRowsByStore(rows []types.NormalizedRow) map[string][]types.NormalizedRow {
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

// generateFileID generates a unique file ID
func generateFileID() string {
	return fmt.Sprintf("igf_%d", time.Now().UnixNano())
}
