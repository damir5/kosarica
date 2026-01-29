package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog/log"
)

type IngestionErrorParams struct {
	RunID        string
	FileID       string
	ChunkID      string
	EntryID      string
	ErrorType    types.IngestionErrorType
	ErrorMessage string
	ErrorDetails string
	Severity     types.ErrorSeverity
}

type IngestionStoreStatsParams struct {
	RunID           string
	FileID          string
	StoreID         string
	StoreIdentifier string
	RowCount        int
	PersistedCount  int
	PriceChanges    int
	FailedRows      int
	WarningRows     int
}

func parseFileIDToInt64(fileID string) (int64, error) {
	raw := strings.TrimSpace(fileID)
	if raw == "" {
		return 0, fmt.Errorf("fileID is empty")
	}
	if strings.HasPrefix(raw, "igf_") {
		raw = strings.TrimPrefix(raw, "igf_")
	}
	return strconv.ParseInt(raw, 10, 64)
}

func formatErrorDetails(message string, fields map[string]string) string {
	payload := make(map[string]string)
	for key, value := range fields {
		value = strings.TrimSpace(value)
		if value != "" {
			payload[key] = value
		}
	}
	if strings.TrimSpace(message) != "" {
		payload["details"] = message
	}
	if len(payload) == 0 {
		return ""
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return message
	}
	return string(encoded)
}

func createIngestionFilePlaceholder(ctx context.Context, fileID string, runID string, file types.DiscoveredFile) error {
	queries := sqlcgen.New(database.Pool())

	fileIDInt, err := parseFileIDToInt64(fileID)
	if err != nil {
		return err
	}

	metadataJSON, _ := json.Marshal(map[string]interface{}{
		"url": file.URL,
	})

	return queries.CreateIngestionFilePlaceholder(ctx, sqlcgen.CreateIngestionFilePlaceholderParams{
		ID:       fileIDInt,
		RunID:    runID,
		Filename: file.Filename,
		FileType: string(file.Type),
		Metadata: pgtype.Text{String: string(metadataJSON), Valid: true},
	})
}

func updateIngestionFileFetchInfo(ctx context.Context, fileID string, fileSize int, fileHash string) error {
	queries := sqlcgen.New(database.Pool())

	fileIDInt, err := parseFileIDToInt64(fileID)
	if err != nil {
		return err
	}

	return queries.UpdateIngestionFileFetchInfo(ctx, sqlcgen.UpdateIngestionFileFetchInfoParams{
		FileSize: pgtype.Int4{Int32: int32(fileSize), Valid: true},
		FileHash: pgtype.Text{String: fileHash, Valid: fileHash != ""},
		ID:       fileIDInt,
	})
}

func updateIngestionFileAfterParse(ctx context.Context, fileID string, file types.DiscoveredFile, parseResult *types.ParseResult, storeIdentifier string) error {
	queries := sqlcgen.New(database.Pool())

	fileIDInt, err := parseFileIDToInt64(fileID)
	if err != nil {
		return err
	}

	totalChunks := 0
	if parseResult.ValidRows > 0 {
		totalChunks = 1
	}

	metadataJSON, _ := json.Marshal(map[string]interface{}{
		"storeIdentifier": storeIdentifier,
		"url":             file.URL,
	})

	return queries.UpdateIngestionFileAfterParse(ctx, sqlcgen.UpdateIngestionFileAfterParseParams{
		EntryCount:  pgtype.Int4{Int32: int32(parseResult.ValidRows), Valid: true},
		TotalChunks: pgtype.Int4{Int32: int32(totalChunks), Valid: true},
		ChunkSize:   pgtype.Int4{Int32: int32(parseResult.ValidRows), Valid: true},
		Metadata:    pgtype.Text{String: string(metadataJSON), Valid: true},
		ID:          fileIDInt,
	})
}

func markIngestionFileFailed(ctx context.Context, fileID string, reason string, severity types.ErrorSeverity, statusType string) error {
	queries := sqlcgen.New(database.Pool())

	fileIDInt, err := parseFileIDToInt64(fileID)
	if err != nil {
		return err
	}

	return queries.UpdateIngestionFileFailed(ctx, sqlcgen.UpdateIngestionFileFailedParams{
		StatusReason:   pgtype.Text{String: reason, Valid: reason != ""},
		StatusSeverity: pgtype.Text{String: string(severity), Valid: severity != ""},
		StatusType:     pgtype.Text{String: statusType, Valid: statusType != ""},
		ID:             fileIDInt,
	})
}

func markIngestionFileCompletedWithSummary(ctx context.Context, fileID string, processedChunks int, reason string, severity types.ErrorSeverity, statusType string) error {
	queries := sqlcgen.New(database.Pool())

	fileIDInt, err := parseFileIDToInt64(fileID)
	if err != nil {
		return err
	}

	return queries.UpdateIngestionFileCompletedWithStatus(ctx, sqlcgen.UpdateIngestionFileCompletedWithStatusParams{
		ProcessedChunks: pgtype.Int4{Int32: int32(processedChunks), Valid: true},
		StatusReason:    pgtype.Text{String: reason, Valid: reason != ""},
		StatusSeverity:  pgtype.Text{String: string(severity), Valid: severity != ""},
		StatusType:      pgtype.Text{String: statusType, Valid: statusType != ""},
		ID:              fileIDInt,
	})
}

func UpdateRunStatusSummary(ctx context.Context, runID string, reason string, severity types.ErrorSeverity, statusType string) {
	queries := sqlcgen.New(database.Pool())
	if err := queries.UpdateRunStatusSummary(ctx, sqlcgen.UpdateRunStatusSummaryParams{
		StatusReason:   pgtype.Text{String: reason, Valid: reason != ""},
		StatusSeverity: pgtype.Text{String: string(severity), Valid: severity != ""},
		StatusType:     pgtype.Text{String: statusType, Valid: statusType != ""},
		ID:             runID,
	}); err != nil {
		log.Warn().Err(err).Str("run_id", runID).Msg("Failed to update run status summary")
	}
}

func recordIngestionError(ctx context.Context, params IngestionErrorParams) {
	queries := sqlcgen.New(database.Pool())

	var fileID pgtype.Int8
	if params.FileID != "" {
		if parsed, err := parseFileIDToInt64(params.FileID); err == nil {
			fileID = pgtype.Int8{Int64: parsed, Valid: true}
		}
	}

	chunkID := pgtype.Text{Valid: false}
	if params.ChunkID != "" {
		chunkID = pgtype.Text{String: params.ChunkID, Valid: true}
	}

	entryID := pgtype.Text{Valid: false}
	if params.EntryID != "" {
		entryID = pgtype.Text{String: params.EntryID, Valid: true}
	}

	details := pgtype.Text{Valid: false}
	if params.ErrorDetails != "" {
		details = pgtype.Text{String: params.ErrorDetails, Valid: true}
	}

	if err := queries.CreateIngestionError(ctx, sqlcgen.CreateIngestionErrorParams{
		RunID:        params.RunID,
		FileID:       fileID,
		ChunkID:      chunkID,
		EntryID:      entryID,
		ErrorType:    string(params.ErrorType),
		ErrorMessage: params.ErrorMessage,
		ErrorDetails: details,
		Severity:     string(params.Severity),
	}); err != nil {
		log.Warn().Err(err).Str("run_id", params.RunID).Msg("Failed to record ingestion error")
		return
	}

	if params.Severity != types.SeverityWarning {
		if err := queries.IncrementRunErrorCount(ctx, sqlcgen.IncrementRunErrorCountParams{
			ErrorCount: pgtype.Int4{Int32: 1, Valid: true},
			ID:         params.RunID,
		}); err != nil {
			log.Warn().Err(err).Str("run_id", params.RunID).Msg("Failed to increment run error count")
		}
	}
}

func recordIngestionStoreStats(ctx context.Context, params IngestionStoreStatsParams) {
	queries := sqlcgen.New(database.Pool())

	fileIDInt, err := parseFileIDToInt64(params.FileID)
	if err != nil {
		log.Warn().Err(err).Str("file_id", params.FileID).Msg("Failed to parse file ID for store stats")
		return
	}

	storeIdentifier := params.StoreIdentifier
	if storeIdentifier == "" {
		storeIdentifier = params.StoreID
	}

	if err := queries.CreateIngestionStoreStats(ctx, sqlcgen.CreateIngestionStoreStatsParams{
		RunID:           params.RunID,
		FileID:          fileIDInt,
		StoreID:         params.StoreID,
		StoreIdentifier: storeIdentifier,
		RowCount:        int32(params.RowCount),
		PersistedCount:  int32(params.PersistedCount),
		PriceChanges:    int32(params.PriceChanges),
		FailedRows:      int32(params.FailedRows),
		WarningRows:     int32(params.WarningRows),
	}); err != nil {
		log.Warn().Err(err).Str("run_id", params.RunID).Str("store_id", params.StoreID).Msg("Failed to record ingestion store stats")
	}
}
