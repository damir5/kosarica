package handlers

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
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
	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	chain := c.DefaultQuery("chain", "konzum")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset := (page - 1) * limit

	// Count total using sqlc
	total, err := queries.CountFailedRows(ctx, chain)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count failed rows"})
		return
	}

	totalPages := (int(total) + limit - 1) / limit

	// List failed rows using sqlc
	rowData, err := queries.ListFailedRows(ctx, sqlcgen.ListFailedRowsParams{
		ChainSlug: chain,
		Limit:     int32(limit),
		Offset:    int32(offset),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query failed rows"})
		return
	}

	// Convert sqlcgen rows to response format
	failedRows := make([]FailedRow, 0, len(rowData))
	for _, data := range rowData {
		row := FailedRow{
			ID:        data.ID,
			ChainSlug: data.ChainSlug,
			ChainName: getChainName(data.ChainSlug),
			RawData:   data.RawData,
		}

		// Convert pgtype fields
		if data.RunID.Valid {
			row.RunID = data.RunID.String
		}
		if data.FileID.Valid {
			row.FileID = fmt.Sprintf("%d", data.FileID.Int64)
		}
		if data.StoreIdentifier.Valid {
			row.StoreIdentifier = data.StoreIdentifier.String
		}
		if data.RowNumber.Valid {
			row.RowNumber = int(data.RowNumber.Int32)
		}
		if data.FailedAt.Valid {
			row.FailedAt = data.FailedAt.Time.Format("2006-01-02T15:04:05Z07:00")
		}
		if data.Reviewed.Valid {
			row.Reviewed = data.Reviewed.Bool
		}
		if data.ReviewedBy.Valid {
			row.ReviewedBy = &data.ReviewedBy.String
		}
		if data.ReviewNotes.Valid {
			row.ReviewNotes = &data.ReviewNotes.String
		}
		if data.Reprocessable.Valid {
			row.Reprocessable = data.Reprocessable.Bool
		}
		if data.ReprocessedAt.Valid {
			s := data.ReprocessedAt.Time.Format("2006-01-02T15:04:05Z07:00")
			row.ReprocessedAt = &s
		}

		// Extract error messages from typed validation errors
		validationErrors := make([]string, len(data.ValidationErrors))
		for i, ve := range data.ValidationErrors {
			validationErrors[i] = ve.Message
		}
		row.ValidationErrors = validationErrors

		failedRows = append(failedRows, row)
	}

	c.JSON(http.StatusOK, FailedRowsResponse{
		FailedRows: failedRows,
		Total:      int(total),
		Page:       page,
		TotalPages: totalPages,
	})
}

func UpdateFailedRowNotes(c *gin.Context) {
	queries := sqlcgen.New(database.Pool())
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

	// Update using sqlc
	updatedID, err := queries.UpdateFailedRowNotes(ctx, sqlcgen.UpdateFailedRowNotesParams{
		ReviewNotes: pgtype.Text{String: req.Notes, Valid: true},
		Reviewed:    pgtype.Bool{Bool: req.Reviewed, Valid: true},
		ID:          id,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update failed row"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"id": updatedID, "success": true})
}

func ReprocessFailedRows(c *gin.Context) {
	queries := sqlcgen.New(database.Pool())
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

	// Get rows to reprocess using sqlc
	rowsToReprocess, err := queries.GetFailedRowsForReprocessing(ctx, req.IDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query failed rows for reprocessing"})
		return
	}

	reprocessedCount := 0
	var newRunID *string

	for _, row := range rowsToReprocess {
		if newRunID == nil {
			runID := cuid2.GeneratePrefixedId("run", cuid2.PrefixedIdOptions{})
			newRunID = &runID

			// Create reprocessing run using sqlc
			err := queries.CreateReprocessingRun(ctx, sqlcgen.CreateReprocessingRunParams{
				ID:        *newRunID,
				ChainSlug: row.ChainSlug,
			})
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create reprocessing run"})
				return
			}
		}

		// Mark row as reprocessed using sqlc
		err := queries.MarkRowAsReprocessed(ctx, row.ID)
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
