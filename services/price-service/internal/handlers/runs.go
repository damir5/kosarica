package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/kosarica/price-service/internal/chains"
	"github.com/kosarica/price-service/internal/database"
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

	pool := database.Pool()
	ctx := c.Request.Context()

	// Build query with dynamic filters
	query := `
		SELECT id, chain_slug, source, status, started_at, completed_at,
		       total_files, processed_files, total_entries, processed_entries,
		       error_count, metadata, created_at
		FROM ingestion_runs
		WHERE 1=1
	`
	args := []interface{}{}
	argIdx := 1

	if req.ChainSlug != "" {
		query += fmt.Sprintf(" AND chain_slug = $%d", argIdx)
		args = append(args, req.ChainSlug)
		argIdx++
	}

	if req.Status != "" {
		query += fmt.Sprintf(" AND status = $%d", argIdx)
		args = append(args, req.Status)
		argIdx++
	}

	// Get total count
	countQuery := "SELECT COUNT(*) FROM ingestion_runs WHERE 1=1"
	countArgs := []interface{}{}
	countArgIdx := 1

	if req.ChainSlug != "" {
		countQuery += fmt.Sprintf(" AND chain_slug = $%d", countArgIdx)
		countArgs = append(countArgs, req.ChainSlug)
		countArgIdx++
	}

	if req.Status != "" {
		countQuery += fmt.Sprintf(" AND status = $%d", countArgIdx)
		countArgs = append(countArgs, req.Status)
		countArgIdx++
	}

	var total int
	err := pool.QueryRow(ctx, countQuery, countArgs...).Scan(&total)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count runs"})
		return
	}

	// Add ordering and pagination
	query += " ORDER BY created_at DESC"
	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, req.Limit, req.Offset)

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch runs"})
		return
	}
	defer rows.Close()

	runs := []IngestionRun{}
	for rows.Next() {
		var run IngestionRun
		err := rows.Scan(
			&run.ID, &run.ChainSlug, &run.Source, &run.Status,
			&run.StartedAt, &run.CompletedAt, &run.TotalFiles, &run.ProcessedFiles,
			&run.TotalEntries, &run.ProcessedEntries, &run.ErrorCount,
			&run.Metadata, &run.CreatedAt,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan run"})
			return
		}
		runs = append(runs, run)
	}

	if rows.Err() != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error iterating runs"})
		return
	}

	c.JSON(http.StatusOK, ListRunsResponse{
		Runs:  runs,
		Total: total,
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

	pool := database.Pool()
	ctx := c.Request.Context()

	query := `
		SELECT id, chain_slug, source, status, started_at, completed_at,
		       total_files, processed_files, total_entries, processed_entries,
		       error_count, metadata, created_at
		FROM ingestion_runs
		WHERE id = $1
	`

	var run IngestionRun
	err := pool.QueryRow(ctx, query, runID).Scan(
		&run.ID, &run.ChainSlug, &run.Source, &run.Status,
		&run.StartedAt, &run.CompletedAt, &run.TotalFiles, &run.ProcessedFiles,
		&run.TotalEntries, &run.ProcessedEntries, &run.ErrorCount,
		&run.Metadata, &run.CreatedAt,
	)

	if err == pgx.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "Run not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch run"})
		return
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

	pool := database.Pool()
	ctx := c.Request.Context()

	// Get total count
	var total int
	err := pool.QueryRow(ctx, "SELECT COUNT(*) FROM ingestion_files WHERE run_id = $1", runID).Scan(&total)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count files"})
		return
	}

	// Get files with pagination
	query := `
		SELECT id, run_id, filename, file_type, file_size, file_hash, status,
		       entry_count, processed_at, metadata, total_chunks, processed_chunks,
		       chunk_size, created_at
		FROM ingestion_files
		WHERE run_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := pool.Query(ctx, query, runID, req.Limit, req.Offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch files"})
		return
	}
	defer rows.Close()

	files := []IngestionFile{}
	for rows.Next() {
		var file IngestionFile
		err := rows.Scan(
			&file.ID, &file.RunID, &file.Filename, &file.FileType, &file.FileSize,
			&file.FileHash, &file.Status, &file.EntryCount, &file.ProcessedAt,
			&file.Metadata, &file.TotalChunks, &file.ProcessedChunks,
			&file.ChunkSize, &file.CreatedAt,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan file"})
			return
		}
		files = append(files, file)
	}

	if rows.Err() != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error iterating files"})
		return
	}

	c.JSON(http.StatusOK, ListFilesResponse{
		Files: files,
		Total: total,
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

	pool := database.Pool()
	ctx := c.Request.Context()

	// Get total count
	var total int
	err := pool.QueryRow(ctx, "SELECT COUNT(*) FROM ingestion_errors WHERE run_id = $1", runID).Scan(&total)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count errors"})
		return
	}

	// Get errors with pagination
	query := `
		SELECT id, run_id, file_id, chunk_id, entry_id, error_type, error_message,
		       error_details, severity, created_at
		FROM ingestion_errors
		WHERE run_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := pool.Query(ctx, query, runID, req.Limit, req.Offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch errors"})
		return
	}
	defer rows.Close()

	errors := []IngestionError{}
	for rows.Next() {
		var ingestionErr IngestionError
		err := rows.Scan(
			&ingestionErr.ID, &ingestionErr.RunID, &ingestionErr.FileID, &ingestionErr.ChunkID,
			&ingestionErr.EntryID, &ingestionErr.ErrorType, &ingestionErr.ErrorMessage,
			&ingestionErr.ErrorDetails, &ingestionErr.Severity, &ingestionErr.CreatedAt,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan error"})
			return
		}
		errors = append(errors, ingestionErr)
	}

	if rows.Err() != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error iterating errors"})
		return
	}

	c.JSON(http.StatusOK, ListErrorsResponse{
		Errors: errors,
		Total:  total,
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

	pool := database.Pool()
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

		// Get run counts by status
		query := `
			SELECT
				COUNT(*) as total_runs,
				COUNT(*) FILTER (WHERE status = 'completed') as completed,
				COUNT(*) FILTER (WHERE status = 'failed') as failed,
				COUNT(*) FILTER (WHERE status = 'running') as running,
				COUNT(*) FILTER (WHERE status = 'pending') as pending,
				COALESCE(SUM(total_files), 0) as total_files
			FROM ingestion_runs
			WHERE created_at >= $1 AND created_at <= $2
		`

		err := pool.QueryRow(ctx, query, bucketFrom, to).Scan(
			&buckets[i].TotalRuns, &buckets[i].Completed, &buckets[i].Failed,
			&buckets[i].Running, &buckets[i].Pending, &buckets[i].TotalFiles,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch stats"})
			return
		}

		// Get error count
		err = pool.QueryRow(ctx, `
			SELECT COUNT(*)
			FROM ingestion_errors
			WHERE created_at >= $1 AND created_at <= $2
		`, bucketFrom, to).Scan(&buckets[i].TotalErrors)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch error stats"})
			return
		}
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

	// Get original run
	pool := database.Pool()
	ctx := c.Request.Context()

	var chainSlug string
	err := pool.QueryRow(ctx, "SELECT chain_slug FROM ingestion_runs WHERE id = $1", runID).Scan(&chainSlug)
	if err == pgx.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "Original run not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch original run"})
		return
	}

	// Create new run
	newRunID := fmt.Sprintf("rerun-%d", time.Now().UnixNano())
	_, err = pool.Exec(ctx, `
		INSERT INTO ingestion_runs (
			id, chain_slug, source, status, started_at, created_at,
			parent_run_id, rerun_type, rerun_target_id
		) VALUES (
			$1, $2, 'rerun', 'pending', NOW(), NOW(),
			$3, $4, $5
		)
	`, newRunID, chainSlug, runID, req.RerunType, req.TargetID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create rerun"})
		return
	}

	// TODO: Spawn goroutine to handle the rerun
	// For now, just return the created run ID

	c.JSON(http.StatusCreated, gin.H{
		"runId":  newRunID,
		"status": "pending",
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

	// Check if run exists (within transaction)
	var exists bool
	err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM ingestion_runs WHERE id = $1)", runID).Scan(&exists)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check run existence"})
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Run not found"})
		return
	}

	// Delete associated errors, files, then run (in transaction)
	_, err = tx.Exec(ctx, "DELETE FROM ingestion_errors WHERE run_id = $1", runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete errors"})
		return
	}

	_, err = tx.Exec(ctx, "DELETE FROM ingestion_files WHERE run_id = $1", runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete files"})
		return
	}

	_, err = tx.Exec(ctx, "DELETE FROM ingestion_runs WHERE id = $1", runID)
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
