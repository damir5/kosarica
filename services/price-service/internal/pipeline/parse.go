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
	zipexpand "github.com/kosarica/price-service/internal/ingestion/zip"
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
func ParsePhase(ctx context.Context, chainID string, fetchResult *FetchResult, file types.DiscoveredFile, runID string, fileID string) (*ParseResult, error) {
	// Get adapter from registry
	adapter, err := registry.GetAdapter(config.ChainID(chainID))
	if err != nil {
		return nil, fmt.Errorf("failed to get adapter for %s: %w", chainID, err)
	}

	log.Info().Str("filename", file.Filename).Msg("Parsing file")

	var parseResult *types.ParseResult

	if fetchResult.IsZip || file.Type == types.FileTypeZIP {
		expanded, expandErr := expandZipFiles(ctx, adapter, fetchResult.Content, file.Filename)
		if expandErr != nil {
			return nil, fmt.Errorf("expand failed for %s: %w", file.Filename, expandErr)
		}
		if len(expanded) == 0 {
			return nil, fmt.Errorf("no supported files extracted from %s", file.Filename)
		}

		parseResult = &types.ParseResult{
			Rows:     make([]types.NormalizedRow, 0),
			Errors:   make([]types.ParseError, 0),
			Warnings: make([]types.ParseWarning, 0),
		}

		for _, inner := range expanded {
			if inner.Type != types.FileTypeCSV {
				continue
			}

			innerResult, parseErr := adapter.Parse(inner.Content, inner.InnerFilename, nil)
			if parseErr != nil {
				return nil, fmt.Errorf("parse failed for %s/%s: %w", file.Filename, inner.InnerFilename, parseErr)
			}

			parseResult.TotalRows += innerResult.TotalRows
			parseResult.ValidRows += innerResult.ValidRows
			parseResult.Rows = append(parseResult.Rows, innerResult.Rows...)
			if len(innerResult.Errors) > 0 {
				parseResult.Errors = append(parseResult.Errors, prefixParseErrors(innerResult.Errors, inner.InnerFilename)...)
			}
			if len(innerResult.Warnings) > 0 {
				parseResult.Warnings = append(parseResult.Warnings, prefixParseWarnings(innerResult.Warnings, inner.InnerFilename)...)
			}
		}
	} else {
		// Parse the content directly
		parseResult, err = adapter.Parse(fetchResult.Content, file.Filename, nil)
		if err != nil {
			return nil, fmt.Errorf("parse failed for %s: %w", file.Filename, err)
		}
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
		// Log first 5 errors (or all if fewer than 5)
		errorsToLog := parseResult.Errors
		if len(errorsToLog) > 5 {
			errorsToLog = errorsToLog[:5]
		}
		for _, e := range errorsToLog {
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

	storeIdentifier := "unknown"
	if fetchResult.IsZip || file.Type == types.FileTypeZIP {
		storeIdentifier = "multiple"
	} else if storeID := adapter.ExtractStoreIdentifier(file); storeID != nil {
		storeIdentifier = storeID.Value
	}

	if err := updateIngestionFileAfterParse(ctx, fileID, file, parseResult, storeIdentifier); err != nil {
		return nil, fmt.Errorf("failed to update ingestion file record: %w", err)
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

type zipExpander interface {
	ExpandZIP(ctx context.Context, content []byte, filename string) ([]zipexpand.ExpandedFile, error)
}

func expandZipFiles(ctx context.Context, adapter interface{}, content []byte, filename string) ([]zipexpand.ExpandedFile, error) {
	if expander, ok := adapter.(zipExpander); ok {
		return expander.ExpandZIP(ctx, content, filename)
	}
	return zipexpand.ExpandInMemory(content, filename)
}

func prefixParseErrors(errors []types.ParseError, filename string) []types.ParseError {
	prefixed := make([]types.ParseError, len(errors))
	for i, err := range errors {
		err.Message = fmt.Sprintf("%s: %s", filename, err.Message)
		prefixed[i] = err
	}
	return prefixed
}

func prefixParseWarnings(warnings []types.ParseWarning, filename string) []types.ParseWarning {
	prefixed := make([]types.ParseWarning, len(warnings))
	for i, warn := range warnings {
		warn.Message = fmt.Sprintf("%s: %s", filename, warn.Message)
		prefixed[i] = warn
	}
	return prefixed
}

// markFileCompleted marks an ingestion file as completed using sqlc
func markFileCompleted(ctx context.Context, fileID string, processedChunks int) error {
	queries := sqlcgen.New(database.Pool())

	// Parse fileID to int64 (strip prefix if present)
	fileIDInt, err := parseFileIDToInt64(fileID)
	if err != nil {
		return err
	}

	return queries.UpdateIngestionFileCompleted(ctx, sqlcgen.UpdateIngestionFileCompletedParams{
		ProcessedChunks: pgtype.Int4{Int32: int32(processedChunks), Valid: true},
		ID:              fileIDInt,
	})
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
