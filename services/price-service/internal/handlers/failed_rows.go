package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/pkg/cuid2"
)

type FailedRow struct {
	ID               string   `json:"id"`
	ChainSlug        string   `json:"chainSlug"`
	ChainName        string   `json:"chainName"`
	RunID            string   `json:"runId"`
	FileID           string   `json:"fileId"`
	StoreIdentifier  string   `json:"storeIdentifier"`
	RowNumber        int      `json:"rowNumber"`
	RawData          string   `json:"rawData"`
	ValidationErrors []string `json:"validationErrors"`
	FailedAt         string   `json:"failedAt"`
	Reviewed         bool     `json:"reviewed"`
	ReviewedBy       *string  `json:"reviewedBy"`
	ReviewNotes      *string  `json:"reviewNotes"`
	Reprocessable    bool     `json:"reprocessable"`
	ReprocessedAt    *string  `json:"reprocessedAt"`
}

type FailedRowsResponse struct {
	FailedRows []FailedRow `json:"failedRows"`
	Total      int         `json:"total"`
	Page       int         `json:"page"`
	TotalPages int         `json:"totalPages"`
}

type UpdateNotesRequest struct {
	Notes    string `json:"notes"`
	Reviewed bool   `json:"reviewed"`
}

type ReprocessRequest struct {
	IDs []string `json:"ids"`
}

func GetFailedRows(c *gin.Context) {
	pool := database.Pool()
	ctx := c.Request.Context()

	chain := c.DefaultQuery("chain", "konzum")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset := (page - 1) * limit

	const countQuery = `
		SELECT COUNT(*) FROM retailer_items_failed
		WHERE chain_slug = $1
	`

	var total int
	err := pool.QueryRow(ctx, countQuery, chain).Scan(&total)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count failed rows"})
		return
	}

	totalPages := (total + limit - 1) / limit

	query := `
		SELECT 
			id,
			chain_slug,
			run_id,
			file_id,
			store_identifier,
			row_number,
			raw_data,
			validation_errors,
			failed_at,
			reviewed,
			reviewed_by,
			review_notes,
			reprocessable,
			reprocessed_at
		FROM retailer_items_failed
		WHERE chain_slug = $1
		ORDER BY failed_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := pool.Query(ctx, query, chain, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query failed rows"})
		return
	}
	defer rows.Close()

	failedRows := make([]FailedRow, 0)
	for rows.Next() {
		var row FailedRow
		var validationErrors []string
		var reviewedBy, reviewNotes, reprocessedAt *string

		err := rows.Scan(
			&row.ID,
			&row.ChainSlug,
			&row.RunID,
			&row.FileID,
			&row.StoreIdentifier,
			&row.RowNumber,
			&row.RawData,
			&validationErrors,
			&row.FailedAt,
			&row.Reviewed,
			&reviewedBy,
			&reviewNotes,
			&row.Reprocessable,
			&reprocessedAt,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan row"})
			return
		}

		row.ChainName = getChainName(row.ChainSlug)
		row.ValidationErrors = validationErrors
		row.ReviewedBy = reviewedBy
		row.ReviewNotes = reviewNotes
		row.ReprocessedAt = reprocessedAt

		failedRows = append(failedRows, row)
	}

	c.JSON(http.StatusOK, FailedRowsResponse{
		FailedRows: failedRows,
		Total:      total,
		Page:       page,
		TotalPages: totalPages,
	})
}

func UpdateFailedRowNotes(c *gin.Context) {
	pool := database.Pool()
	ctx := c.Request.Context()

	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID is required"})
		return
	}

	var req UpdateNotesRequest
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	query := `
		UPDATE retailer_items_failed
		SET 
			review_notes = $1,
			reviewed = $2,
			reviewed_by = 'admin'
		WHERE id = $3
		RETURNING id
	`

	var updatedID string
	err := pool.QueryRow(ctx, query, req.Notes, req.Reviewed, id).Scan(&updatedID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update failed row"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"id": updatedID, "success": true})
}

func ReprocessFailedRows(c *gin.Context) {
	pool := database.Pool()
	ctx := c.Request.Context()

	var req ReprocessRequest
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if len(req.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No IDs provided"})
		return
	}

	selectQuery := `
		SELECT 
			id,
			chain_slug,
			run_id,
			file_id,
			store_identifier,
			row_number,
			raw_data,
			validation_errors
		FROM retailer_items_failed
		WHERE id = ANY($1) AND reprocessable = true
	`

	rows, err := pool.Query(ctx, selectQuery, req.IDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query failed rows for reprocessing"})
		return
	}
	defer rows.Close()

	type RowToReprocess struct {
		ID               string
		ChainSlug        string
		RunID            string
		FileID           string
		StoreIdentifier  string
		RowNumber        int
		RawData          string
		ValidationErrors []string
	}

	rowsToReprocess := make([]RowToReprocess, 0)
	for rows.Next() {
		var row RowToReprocess
		err := rows.Scan(
			&row.ID,
			&row.ChainSlug,
			&row.RunID,
			&row.FileID,
			&row.StoreIdentifier,
			&row.RowNumber,
			&row.RawData,
			&row.ValidationErrors,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan row for reprocessing"})
			return
		}
		rowsToReprocess = append(rowsToReprocess, row)
	}

	reprocessedCount := 0
	var newRunID *string

	for _, row := range rowsToReprocess {
		if newRunID == nil {
			runID := cuid2.GeneratePrefixedId("run", cuid2.PrefixedIdOptions{})
			newRunID = &runID

			_, err := pool.Exec(ctx, `
				INSERT INTO ingestion_runs (id, chain_slug, source, status, started_at, created_at)
				VALUES ($1, $2, 'reprocess', 'running', NOW(), NOW())
			`, *newRunID, row.ChainSlug)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create reprocessing run"})
				return
			}
		}

		_, err := pool.Exec(ctx, `
			UPDATE retailer_items_failed
			SET 
				reprocessed_at = NOW(),
				reprocessable = false
			WHERE id = $1
		`, row.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to mark row as reprocessed"})
			return
		}

		reprocessedCount++
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"count":   reprocessedCount,
		"runId":   newRunID,
		"message": "Rows queued for reprocessing",
	})
}
