package handlers

import (
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
)

// GetFile returns a single ingestion file by ID
// @Summary Get ingestion file
// @Description Returns a single ingestion file by its ID
// @Tags ingestion
// @Accept json
// @Produce json
// @Param fileId path string true "File ID"
// @Success 200 {object} IngestionFile
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 404 {object} map[string]string "File not found"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /internal/ingestion/files/{fileId} [get]
func GetFile(c *gin.Context) {
	fileID := c.Param("fileId")
	if fileID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "fileId is required"})
		return
	}

	fileIDInt, err := strconv.ParseInt(fileID, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "fileId must be a numeric ID"})
		return
	}

	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	row, err := queries.GetIngestionFileByID(ctx, fileIDInt)
	if err == pgx.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch file"})
		return
	}

	file := IngestionFile{
		RunID:    row.RunID,
		Filename: row.Filename,
		FileType: row.FileType,
		Status:   row.Status,
	}

	idStr := fmt.Sprintf("%d", row.ID)
	file.ID = &idStr

	if row.FileSize.Valid {
		v := int(row.FileSize.Int32)
		file.FileSize = &v
	}
	if row.FileHash.Valid {
		file.FileHash = &row.FileHash.String
	}
	if row.EntryCount.Valid {
		v := int(row.EntryCount.Int32)
		file.EntryCount = &v
	}
	if row.RowCount.Valid {
		v := int(row.RowCount.Int64)
		file.RowCount = &v
	}
	if row.PersistedCount.Valid {
		v := int(row.PersistedCount.Int64)
		file.PersistedCount = &v
	}
	if row.PriceChanges.Valid {
		v := int(row.PriceChanges.Int64)
		file.PriceChanges = &v
	}
	if row.FailedRows.Valid {
		v := int(row.FailedRows.Int64)
		file.FailedRows = &v
	}
	if row.WarningRows.Valid {
		v := int(row.WarningRows.Int64)
		file.WarningRows = &v
	}
	if row.StoreCount.Valid {
		v := int(row.StoreCount.Int64)
		file.StoreCount = &v
	}
	if row.StatusReason.Valid {
		file.StatusReason = &row.StatusReason.String
	}
	if row.StatusSeverity.Valid {
		file.StatusSeverity = &row.StatusSeverity.String
	}
	if row.StatusType.Valid {
		file.StatusType = &row.StatusType.String
	}
	if row.ProcessedAt.Valid {
		t := row.ProcessedAt.Time
		file.ProcessedAt = &t
	}
	if row.Metadata.Valid {
		file.Metadata = &row.Metadata.String
	}
	if row.TotalChunks.Valid {
		v := int(row.TotalChunks.Int32)
		file.TotalChunks = &v
	}
	if row.ProcessedChunks.Valid {
		v := int(row.ProcessedChunks.Int32)
		file.ProcessedChunks = &v
	}
	if row.ChunkSize.Valid {
		v := int(row.ChunkSize.Int32)
		file.ChunkSize = &v
	}
	if row.CreatedAt.Valid {
		file.CreatedAt = row.CreatedAt.Time
	}

	c.JSON(http.StatusOK, file)
}

// ListChunksRequest represents query parameters for listing ingestion chunks
type ListChunksRequest struct {
	Status   string `form:"status" json:"status" binding:"omitempty,oneof=pending processing completed failed" jsonschema:"enum=pending,enum=processing,enum=completed,enum=failed"`
	Page     int    `form:"page" json:"page" binding:"min=1" jsonschema:"minimum=1"`
	PageSize int    `form:"pageSize" json:"pageSize" binding:"min=1,max=100" jsonschema:"minimum=1,maximum=100"`
}

// IngestionChunk represents an ingestion chunk response
type IngestionChunk struct {
	ID             string     `json:"id" jsonschema:"required"`
	FileID         string     `json:"fileId" jsonschema:"required"`
	ChunkIndex     int        `json:"chunkIndex" jsonschema:"required"`
	StartRow       int        `json:"startRow" jsonschema:"required"`
	EndRow         int        `json:"endRow" jsonschema:"required"`
	RowCount       int        `json:"rowCount" jsonschema:"required"`
	Status         string     `json:"status" jsonschema:"required,enum=pending,enum=processing,enum=completed,enum=failed"`
	R2Key          *string    `json:"r2Key"`
	PersistedCount *int       `json:"persistedCount"`
	ErrorCount     *int       `json:"errorCount"`
	ProcessedAt    *time.Time `json:"processedAt"`
	CreatedAt      time.Time  `json:"createdAt" jsonschema:"required"`
}

// ListChunksResponse represents the response for listing ingestion chunks
type ListChunksResponse struct {
	Chunks     []IngestionChunk `json:"chunks" jsonschema:"required"`
	Total      int              `json:"total" jsonschema:"required"`
	TotalPages int              `json:"totalPages" jsonschema:"required"`
}

// ListChunks returns a paginated list of chunks for a file
// @Summary List ingestion chunks
// @Description Returns a paginated list of chunks for a specific ingestion file
// @Tags ingestion
// @Accept json
// @Produce json
// @Param fileId path string true "File ID"
// @Param status query string false "Chunk status" Enums(pending,processing,completed,failed)
// @Param page query int false "Page number" default(1) minimum(1)
// @Param pageSize query int false "Items per page" default(20) minimum(1) maximum(100)
// @Success 200 {object} ListChunksResponse
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /internal/ingestion/files/{fileId}/chunks [get]
func ListChunks(c *gin.Context) {
	fileID := c.Param("fileId")
	if fileID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "fileId is required"})
		return
	}

	fileIDInt, err := strconv.ParseInt(fileID, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "fileId must be a numeric ID"})
		return
	}

	var req ListChunksRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Page == 0 {
		req.Page = 1
	}
	if req.PageSize == 0 {
		req.PageSize = 20
	}

	offset := (req.Page - 1) * req.PageSize

	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	statusParam := pgtype.Text{Valid: false}
	if req.Status != "" {
		statusParam = pgtype.Text{String: req.Status, Valid: true}
	}

	total, err := queries.CountIngestionChunksByFileID(ctx, sqlcgen.CountIngestionChunksByFileIDParams{
		FileID: fileIDInt,
		Status: statusParam,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count chunks"})
		return
	}

	chunkRows, err := queries.ListIngestionChunksByFileID(ctx, sqlcgen.ListIngestionChunksByFileIDParams{
		FileID: fileIDInt,
		Status: statusParam,
		Limit:  int32(req.PageSize),
		Offset: int32(offset),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch chunks"})
		return
	}

	chunks := make([]IngestionChunk, 0, len(chunkRows))
	for _, row := range chunkRows {
		chunk := IngestionChunk{
			ID:         row.ID,
			FileID:     fmt.Sprintf("%d", row.FileID),
			ChunkIndex: int(row.ChunkIndex),
			StartRow:   int(row.StartRow),
			EndRow:     int(row.EndRow),
			RowCount:   int(row.RowCount),
			Status:     row.Status,
		}

		if row.R2Key.Valid {
			chunk.R2Key = &row.R2Key.String
		}
		if row.PersistedCount.Valid {
			v := int(row.PersistedCount.Int32)
			chunk.PersistedCount = &v
		}
		if row.ErrorCount.Valid {
			v := int(row.ErrorCount.Int32)
			chunk.ErrorCount = &v
		}
		if row.ProcessedAt.Valid {
			t := row.ProcessedAt.Time
			chunk.ProcessedAt = &t
		}
		if row.CreatedAt.Valid {
			chunk.CreatedAt = row.CreatedAt.Time
		}

		chunks = append(chunks, chunk)
	}

	totalPages := 0
	if req.PageSize > 0 {
		totalPages = int(math.Ceil(float64(total) / float64(req.PageSize)))
	}

	c.JSON(http.StatusOK, ListChunksResponse{
		Chunks:     chunks,
		Total:      int(total),
		TotalPages: totalPages,
	})
}

// ListFileErrorsRequest represents query parameters for listing ingestion errors for a file
type ListFileErrorsRequest struct {
	Page     int `form:"page" json:"page" binding:"min=1" jsonschema:"minimum=1"`
	PageSize int `form:"pageSize" json:"pageSize" binding:"min=1,max=100" jsonschema:"minimum=1,maximum=100"`
}

// ListFileErrors returns a paginated list of errors for a file
// @Summary List ingestion errors for file
// @Description Returns a paginated list of errors for a specific ingestion file
// @Tags ingestion
// @Accept json
// @Produce json
// @Param fileId path string true "File ID"
// @Param page query int false "Page number" default(1) minimum(1)
// @Param pageSize query int false "Items per page" default(20) minimum(1) maximum(100)
// @Success 200 {object} ListErrorsResponse
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /internal/ingestion/files/{fileId}/errors [get]
func ListFileErrors(c *gin.Context) {
	fileID := c.Param("fileId")
	if fileID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "fileId is required"})
		return
	}

	fileIDInt, err := strconv.ParseInt(fileID, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "fileId must be a numeric ID"})
		return
	}

	var req ListFileErrorsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Page == 0 {
		req.Page = 1
	}
	if req.PageSize == 0 {
		req.PageSize = 20
	}

	offset := (req.Page - 1) * req.PageSize

	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	fileIDParam := pgtype.Int8{Int64: fileIDInt, Valid: true}

	total, err := queries.CountIngestionErrorsByFileID(ctx, fileIDParam)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count errors"})
		return
	}

	errorRows, err := queries.ListIngestionErrorsByFileID(ctx, sqlcgen.ListIngestionErrorsByFileIDParams{
		FileID: fileIDParam,
		Limit:  int32(req.PageSize),
		Offset: int32(offset),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch errors"})
		return
	}

	errors := make([]IngestionError, 0, len(errorRows))
	for _, row := range errorRows {
		ingestionErr := IngestionError{
			ID:           fmt.Sprintf("%d", row.ID),
			RunID:        row.RunID,
			ErrorType:    row.ErrorType,
			ErrorMessage: row.ErrorMessage,
			Severity:     row.Severity,
		}

		if row.FileID.Valid {
			s := fmt.Sprintf("%d", row.FileID.Int64)
			ingestionErr.FileID = &s
		}
		if row.ChunkID.Valid {
			ingestionErr.ChunkID = &row.ChunkID.String
		}
		if row.EntryID.Valid {
			ingestionErr.EntryID = &row.EntryID.String
		}
		if row.ErrorDetails.Valid {
			ingestionErr.ErrorDetails = &row.ErrorDetails.String
		}
		if row.CreatedAt.Valid {
			ingestionErr.CreatedAt = row.CreatedAt.Time
		}

		errors = append(errors, ingestionErr)
	}

	c.JSON(http.StatusOK, ListErrorsResponse{
		Errors: errors,
		Total:  int(total),
	})
}
