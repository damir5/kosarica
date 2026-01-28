package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/chains"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
)

// ListRunsRequest represents query parameters for listing ingestion runs
type ListRunsRequest struct {
	ChainSlug string `form:"chainSlug" json:"chainSlug"`
	Status    string `form:"status" json:"status" jsonschema:"enum=pending,enum=running,enum=completed,enum=failed"`
	Limit     int    `form:"limit" json:"limit" binding:"min=1,max=100" jsonschema:"minimum=1,maximum=100"`
	Offset    int    `form:"offset" json:"offset" binding:"min=0" jsonschema:"minimum=0"`
}

// ListRunsResponse represents the response for listing ingestion runs
type ListRunsResponse struct {
	Runs  []IngestionRun `json:"runs" jsonschema:"required"`
	Total int            `json:"total" jsonschema:"required"`
}

// IngestionRun represents an ingestion run response
type IngestionRun struct {
	ID               string     `json:"id" jsonschema:"required"`
	ChainSlug        string     `json:"chainSlug" jsonschema:"required"`
	Source           string     `json:"source" jsonschema:"required"`
	Status           string     `json:"status" jsonschema:"required,enum=pending,enum=running,enum=completed,enum=failed"`
	StartedAt        *time.Time `json:"startedAt"`
	CompletedAt      *time.Time `json:"completedAt"`
	TotalFiles       *int       `json:"totalFiles"`
	ProcessedFiles   *int       `json:"processedFiles"`
	TotalEntries     *int       `json:"totalEntries"`
	ProcessedEntries *int       `json:"processedEntries"`
	ErrorCount       *int       `json:"errorCount"`
	Metadata         *string    `json:"metadata"`
	CreatedAt        time.Time  `json:"createdAt" jsonschema:"required"`
}

// ListRuns returns a paginated list of ingestion runs with optional filters
// @Summary List ingestion runs
// @Description Returns a paginated list of ingestion runs with optional chain and status filters
// @Tags ingestion
// @Accept json
// @Produce json
// @Param chainSlug query string false "Filter by chain slug"
// @Param status query string false "Filter by status" Enums(pending, running, completed, failed)
// @Param limit query int false "Number of items to return" default(20) minimum(1) maximum(100)
// @Param offset query int false "Number of items to skip" default(0) minimum(0)
// @Success 200 {object} ListRunsResponse
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /internal/ingestion/runs [get]
func ListRuns(c *gin.Context) {
	var req ListRunsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Set defaults
	if req.Limit == 0 {
		req.Limit = 20
	}

	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	// Get total count using sqlc (empty string means no filter)
	total, err := queries.CountIngestionRunsFiltered(ctx, sqlcgen.CountIngestionRunsFilteredParams{
		ChainFilter:  req.ChainSlug, // empty string = no filter
		StatusFilter: req.Status,    // empty string = no filter
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count runs"})
		return
	}

	// Get runs with pagination using sqlc
	runRows, err := queries.ListIngestionRunsFiltered(ctx, sqlcgen.ListIngestionRunsFilteredParams{
		ChainFilter:  req.ChainSlug, // empty string = no filter
		StatusFilter: req.Status,    // empty string = no filter
		ResultLimit:  int32(req.Limit),
		ResultOffset: int32(req.Offset),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch runs"})
		return
	}

	// Convert sqlcgen rows to IngestionRun
	runs := make([]IngestionRun, 0, len(runRows))
	for _, row := range runRows {
		run := IngestionRun{
			ID:        row.ID,
			ChainSlug: row.ChainSlug,
			Source:    row.Source,
			Status:    row.Status,
		}

		// Convert pgtype fields
		if row.StartedAt.Valid {
			t := row.StartedAt.Time
			run.StartedAt = &t
		}
		if row.CompletedAt.Valid {
			t := row.CompletedAt.Time
			run.CompletedAt = &t
		}
		if row.TotalFiles.Valid {
			v := int(row.TotalFiles.Int32)
			run.TotalFiles = &v
		}
		if row.ProcessedFiles.Valid {
			v := int(row.ProcessedFiles.Int32)
			run.ProcessedFiles = &v
		}
		if row.TotalEntries.Valid {
			v := int(row.TotalEntries.Int32)
			run.TotalEntries = &v
		}
		if row.ProcessedEntries.Valid {
			v := int(row.ProcessedEntries.Int32)
			run.ProcessedEntries = &v
		}
		if row.ErrorCount.Valid {
			v := int(row.ErrorCount.Int32)
			run.ErrorCount = &v
		}
		if row.Metadata.Valid {
			run.Metadata = &row.Metadata.String
		}
		if row.CreatedAt.Valid {
			run.CreatedAt = row.CreatedAt.Time
		}

		runs = append(runs, run)
	}

	c.JSON(http.StatusOK, ListRunsResponse{
		Runs:  runs,
		Total: int(total),
	})
}

// GetRun returns a single ingestion run by ID
// @Summary Get ingestion run
// @Description Returns a single ingestion run by its ID
// @Tags ingestion
// @Accept json
// @Produce json
// @Param runId path string true "Run ID"
// @Success 200 {object} IngestionRun
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 404 {object} map[string]string "Run not found"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /internal/ingestion/runs/{runId} [get]
func GetRun(c *gin.Context) {
	runID := c.Param("runId")
	if runID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "runId is required"})
		return
	}

	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	row, err := queries.GetIngestionRunById(ctx, runID)
	if err == pgx.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "Run not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch run"})
		return
	}

	// Convert sqlcgen row to IngestionRun
	run := IngestionRun{
		ID:        row.ID,
		ChainSlug: row.ChainSlug,
		Source:    row.Source,
		Status:    row.Status,
	}

	// Convert pgtype fields
	if row.StartedAt.Valid {
		t := row.StartedAt.Time
		run.StartedAt = &t
	}
	if row.CompletedAt.Valid {
		t := row.CompletedAt.Time
		run.CompletedAt = &t
	}
	if row.TotalFiles.Valid {
		v := int(row.TotalFiles.Int32)
		run.TotalFiles = &v
	}
	if row.ProcessedFiles.Valid {
		v := int(row.ProcessedFiles.Int32)
		run.ProcessedFiles = &v
	}
	if row.TotalEntries.Valid {
		v := int(row.TotalEntries.Int32)
		run.TotalEntries = &v
	}
	if row.ProcessedEntries.Valid {
		v := int(row.ProcessedEntries.Int32)
		run.ProcessedEntries = &v
	}
	if row.ErrorCount.Valid {
		v := int(row.ErrorCount.Int32)
		run.ErrorCount = &v
	}
	if row.Metadata.Valid {
		run.Metadata = &row.Metadata.String
	}
	if row.CreatedAt.Valid {
		run.CreatedAt = row.CreatedAt.Time
	}

	c.JSON(http.StatusOK, run)
}

// ListFilesRequest represents query parameters for listing ingestion files
type ListFilesRequest struct {
	Limit  int `form:"limit" json:"limit" binding:"min=1,max=100" jsonschema:"minimum=1,maximum=100"`
	Offset int `form:"offset" json:"offset" binding:"min=0" jsonschema:"minimum=0"`
}

// ListFilesResponse represents the response for listing ingestion files
type ListFilesResponse struct {
	Files []IngestionFile `json:"files" jsonschema:"required"`
	Total int             `json:"total" jsonschema:"required"`
}

// IngestionFile represents an ingestion file response
type IngestionFile struct {
	ID              *string    `json:"id"`
	RunID           string     `json:"runId" jsonschema:"required"`
	Filename        string     `json:"filename" jsonschema:"required"`
	FileType        string     `json:"fileType" jsonschema:"required"`
	FileSize        *int       `json:"fileSize"`
	FileHash        *string    `json:"fileHash"`
	Status          string     `json:"status" jsonschema:"required,enum=pending,enum=processing,enum=completed,enum=failed"`
	EntryCount      *int       `json:"entryCount"`
	ProcessedAt     *time.Time `json:"processedAt"`
	Metadata        *string    `json:"metadata"`
	TotalChunks     *int       `json:"totalChunks"`
	ProcessedChunks *int       `json:"processedChunks"`
	ChunkSize       *int       `json:"chunkSize"`
	CreatedAt       time.Time  `json:"createdAt" jsonschema:"required"`
}

// ListFiles returns a paginated list of files for a run
// @Summary List ingestion files
// @Description Returns a paginated list of files for a specific ingestion run
// @Tags ingestion
// @Accept json
// @Produce json
// @Param runId path string true "Run ID"
// @Param limit query int false "Number of items to return" default(50) minimum(1) maximum(100)
// @Param offset query int false "Number of items to skip" default(0) minimum(0)
// @Success 200 {object} ListFilesResponse
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /internal/ingestion/runs/{runId}/files [get]
func ListFiles(c *gin.Context) {
	runID := c.Param("runId")
	if runID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "runId is required"})
		return
	}

	var req ListFilesRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Set defaults
	if req.Limit == 0 {
		req.Limit = 50
	}

	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	// Get total count using sqlc
	total, err := queries.CountIngestionFiles(ctx, runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count files"})
		return
	}

	// Get files with pagination using sqlc
	fileRows, err := queries.ListIngestionFiles(ctx, sqlcgen.ListIngestionFilesParams{
		RunID:  runID,
		Limit:  int32(req.Limit),
		Offset: int32(req.Offset),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch files"})
		return
	}

	// Convert sqlcgen rows to IngestionFile
	files := make([]IngestionFile, 0, len(fileRows))
	for _, row := range fileRows {
		file := IngestionFile{
			RunID:    row.RunID,
			Filename: row.Filename,
			FileType: row.FileType,
			Status:   row.Status,
		}

		// Convert ID (int64 to *string)
		idStr := fmt.Sprintf("%d", row.ID)
		file.ID = &idStr

		// Convert pgtype fields
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

		files = append(files, file)
	}

	c.JSON(http.StatusOK, ListFilesResponse{
		Files: files,
		Total: int(total),
	})
}

// ListErrorsRequest represents query parameters for listing ingestion errors
type ListErrorsRequest struct {
	Limit  int `form:"limit" json:"limit" binding:"min=1,max=100" jsonschema:"minimum=1,maximum=100"`
	Offset int `form:"offset" json:"offset" binding:"min=0" jsonschema:"minimum=0"`
}

// ListErrorsResponse represents the response for listing ingestion errors
type ListErrorsResponse struct {
	Errors []IngestionError `json:"errors" jsonschema:"required"`
	Total  int              `json:"total" jsonschema:"required"`
}

// IngestionError represents an ingestion error response
type IngestionError struct {
	ID           string    `json:"id" jsonschema:"required"`
	RunID        string    `json:"runId" jsonschema:"required"`
	FileID       *string   `json:"fileId"`
	ChunkID      *string   `json:"chunkId"`
	EntryID      *string   `json:"entryId"`
	ErrorType    string    `json:"errorType" jsonschema:"required"`
	ErrorMessage string    `json:"errorMessage" jsonschema:"required"`
	ErrorDetails *string   `json:"errorDetails"`
	Severity     string    `json:"severity" jsonschema:"required,enum=warning,enum=error,enum=critical"`
	CreatedAt    time.Time `json:"createdAt" jsonschema:"required"`
}

// ListErrors returns a paginated list of errors for a run
// @Summary List ingestion errors
// @Description Returns a paginated list of errors for a specific ingestion run
// @Tags ingestion
// @Accept json
// @Produce json
// @Param runId path string true "Run ID"
// @Param limit query int false "Number of items to return" default(50) minimum(1) maximum(100)
// @Param offset query int false "Number of items to skip" default(0) minimum(0)
// @Success 200 {object} ListErrorsResponse
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /internal/ingestion/runs/{runId}/errors [get]
func ListErrors(c *gin.Context) {
	runID := c.Param("runId")
	if runID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "runId is required"})
		return
	}

	var req ListErrorsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Set defaults
	if req.Limit == 0 {
		req.Limit = 50
	}

	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	// Get total count using sqlc
	total, err := queries.CountIngestionErrors(ctx, runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count errors"})
		return
	}

	// Get errors with pagination using sqlc
	errorRows, err := queries.ListIngestionErrors(ctx, sqlcgen.ListIngestionErrorsParams{
		RunID:  runID,
		Limit:  int32(req.Limit),
		Offset: int32(req.Offset),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch errors"})
		return
	}

	// Convert sqlcgen rows to IngestionError
	errors := make([]IngestionError, 0, len(errorRows))
	for _, row := range errorRows {
		ingestionErr := IngestionError{
			ID:           fmt.Sprintf("%d", row.ID),
			RunID:        row.RunID,
			ErrorType:    row.ErrorType,
			ErrorMessage: row.ErrorMessage,
			Severity:     row.Severity,
		}

		// Convert pgtype fields
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

// GetStatsRequest represents query parameters for getting ingestion stats
type GetStatsRequest struct {
	From string `form:"from" json:"from" binding:"required" jsonschema:"required"`
	To   string `form:"to" json:"to" binding:"required" jsonschema:"required"`
}

// StatsBucket represents a single time bucket in stats
type StatsBucket struct {
	Label       string `json:"label" jsonschema:"required"` // "24h", "7d", "30d"
	TotalRuns   int    `json:"totalRuns" jsonschema:"required"`
	Completed   int    `json:"completed" jsonschema:"required"`
	Failed      int    `json:"failed" jsonschema:"required"`
	Running     int    `json:"running" jsonschema:"required"`
	Pending     int    `json:"pending" jsonschema:"required"`
	TotalFiles  int    `json:"totalFiles" jsonschema:"required"`
	TotalErrors int    `json:"totalErrors" jsonschema:"required"`
}

// GetStatsResponse represents the response for ingestion stats
type GetStatsResponse struct {
	Buckets []StatsBucket `json:"buckets" jsonschema:"required"`
}

// GetStats returns aggregated statistics for a time range
// @Summary Get ingestion stats
// @Description Returns aggregated statistics for ingestion runs within a time range (24h/7d/30d buckets)
// @Tags ingestion
// @Accept json
// @Produce json
// @Param from query string true "Start date (RFC3339 format)"
// @Param to query string true "End date (RFC3339 format)"
// @Success 200 {object} GetStatsResponse
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /internal/ingestion/stats [get]
func GetStats(c *gin.Context) {
	var req GetStatsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Parse dates
	from, err := time.Parse(time.RFC3339, req.From)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid from date format, use RFC3339"})
		return
	}

	to, err := time.Parse(time.RFC3339, req.To)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid to date format, use RFC3339"})
		return
	}

	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	// Calculate 24h, 7d, 30d bucket boundaries from the "to" date
	buckets := []StatsBucket{
		{Label: "24h"},
		{Label: "7d"},
		{Label: "30d"},
	}

	for i := range buckets {
		var bucketFrom time.Time
		switch buckets[i].Label {
		case "24h":
			bucketFrom = to.Add(-24 * time.Hour)
		case "7d":
			bucketFrom = to.Add(-7 * 24 * time.Hour)
		case "30d":
			bucketFrom = to.Add(-30 * 24 * time.Hour)
		}

		// Clamp to from date
		if bucketFrom.Before(from) {
			bucketFrom = from
		}

		// Get run counts by status using sqlc
		stats, err := queries.GetRunStats(ctx, sqlcgen.GetRunStatsParams{
			CreatedAt:   pgtype.Timestamp{Time: bucketFrom, Valid: true},
			CreatedAt_2: pgtype.Timestamp{Time: to, Valid: true},
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch stats"})
			return
		}

		buckets[i].TotalRuns = int(stats.TotalRuns)
		buckets[i].Completed = int(stats.Completed)
		buckets[i].Failed = int(stats.Failed)
		buckets[i].Running = int(stats.Running)
		buckets[i].Pending = int(stats.Pending)
		// TotalFiles comes as interface{} from COALESCE, handle it
		if v, ok := stats.TotalFiles.(int64); ok {
			buckets[i].TotalFiles = int(v)
		}

		// Get error count using sqlc
		errorCount, err := queries.CountErrorsByDateRange(ctx, sqlcgen.CountErrorsByDateRangeParams{
			CreatedAt:   pgtype.Timestamp{Time: bucketFrom, Valid: true},
			CreatedAt_2: pgtype.Timestamp{Time: to, Valid: true},
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch error stats"})
			return
		}
		buckets[i].TotalErrors = int(errorCount)
	}

	c.JSON(http.StatusOK, GetStatsResponse{
		Buckets: buckets,
	})
}

// RerunRunRequest represents the request for rerunning a run
type RerunRunRequest struct {
	RerunType string `json:"rerunType" binding:"required" jsonschema:"required,enum=file,enum=chunk,enum=entry"` // "file", "chunk", "entry"
	TargetID  string `json:"targetId" binding:"required" jsonschema:"required"`                                  // ID of file/chunk/entry to rerun
}

// RerunRun creates a new run that reruns a specific file/chunk/entry
// @Summary Rerun ingestion
// @Description Creates a new run that reruns a specific file, chunk, or entry from an existing run
// @Tags ingestion
// @Accept json
// @Produce json
// @Param runId path string true "Original run ID"
// @Param request body RerunRunRequest true "Rerun request"
// @Success 201 {object} map[string]interface{} "Rerun created"
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 404 {object} map[string]string "Run not found"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /internal/ingestion/runs/{runId}/rerun [post]
func RerunRun(c *gin.Context) {
	runID := c.Param("runId")
	if runID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "runId is required"})
		return
	}

	var req RerunRunRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate rerun type
	validTypes := map[string]bool{"file": true, "chunk": true, "entry": true}
	if !validTypes[req.RerunType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rerunType must be 'file', 'chunk', or 'entry'"})
		return
	}

	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	// Get original run's chain slug using sqlc
	chainSlug, err := queries.GetRunChainSlug(ctx, runID)
	if err == pgx.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "Original run not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch original run"})
		return
	}

	// Create new run using sqlc
	newRunID := fmt.Sprintf("rerun-%d", time.Now().UnixNano())
	err = queries.CreateRerunRun(ctx, sqlcgen.CreateRerunRunParams{
		ID:            newRunID,
		ChainSlug:     chainSlug,
		ParentRunID:   pgtype.Text{String: runID, Valid: true},
		RerunType:     pgtype.Text{String: req.RerunType, Valid: true},
		RerunTargetID: pgtype.Text{String: req.TargetID, Valid: true},
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create rerun"})
		return
	}

	// TODO: Spawn goroutine to handle the rerun
	// For now, just return the created run ID

	c.JSON(http.StatusCreated, gin.H{
		"runId":   newRunID,
		"status":  "pending",
		"message": fmt.Sprintf("Rerun created for %s: %s", req.RerunType, req.TargetID),
	})
}

// DeleteRun deletes an ingestion run and its associated data
// @Summary Delete ingestion run
// @Description Deletes an ingestion run and all its associated files and errors
// @Tags ingestion
// @Accept json
// @Produce json
// @Param runId path string true "Run ID"
// @Success 200 {object} map[string]interface{} "Run deleted"
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 404 {object} map[string]string "Run not found"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /internal/ingestion/runs/{runId} [delete]
func DeleteRun(c *gin.Context) {
	runID := c.Param("runId")
	if runID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "runId is required"})
		return
	}

	pool := database.Pool()
	ctx := c.Request.Context()

	// Begin transaction for atomic delete
	tx, err := pool.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to begin transaction"})
		return
	}
	defer tx.Rollback(ctx)

	// Use sqlc queries with transaction
	txQueries := sqlcgen.New(tx)

	// Check if run exists using sqlc
	exists, err := txQueries.CheckRunExists(ctx, runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check run existence"})
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Run not found"})
		return
	}

	// Delete associated errors using sqlc
	err = txQueries.DeleteIngestionErrors(ctx, runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete errors"})
		return
	}

	// Delete associated files using sqlc
	err = txQueries.DeleteIngestionFiles(ctx, runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete files"})
		return
	}

	// Delete run using sqlc
	err = txQueries.DeleteIngestionRun(ctx, runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete run"})
		return
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to commit transaction"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Run deleted successfully",
		"runId":   runID,
	})
}

// ListChainsResponse represents the response for listing valid chains
type ListChainsResponse struct {
	Chains []string `json:"chains" jsonschema:"required"`
}

// ListChains returns the list of valid chain slugs
// GET /internal/chains
func ListChains(c *gin.Context) {
	c.JSON(http.StatusOK, ListChainsResponse{
		Chains: chains.ValidChains(),
	})
}
