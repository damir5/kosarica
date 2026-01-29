package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
)

// ListStoreStatsRequest represents query parameters for listing store stats
type ListStoreStatsRequest struct {
	Limit  int `form:"limit" json:"limit" binding:"min=1,max=100" jsonschema:"minimum=1,maximum=100"`
	Offset int `form:"offset" json:"offset" binding:"min=0" jsonschema:"minimum=0"`
}

// IngestionStoreStats represents ingestion store stats response
type IngestionStoreStats struct {
	StoreID         string  `json:"storeId" jsonschema:"required"`
	StoreName       string  `json:"storeName" jsonschema:"required"`
	StoreCity       *string `json:"storeCity"`
	StoreIdentifier string  `json:"storeIdentifier" jsonschema:"required"`
	RowCount        int     `json:"rowCount" jsonschema:"required"`
	PersistedCount  int     `json:"persistedCount" jsonschema:"required"`
	PriceChanges    int     `json:"priceChanges" jsonschema:"required"`
	FailedRows      int     `json:"failedRows" jsonschema:"required"`
	WarningRows     int     `json:"warningRows" jsonschema:"required"`
	FileCount       *int    `json:"fileCount,omitempty"`
}

// ListStoreStatsResponse represents the response for listing store stats
type ListStoreStatsResponse struct {
	Stores []IngestionStoreStats `json:"stores" jsonschema:"required"`
	Total  int                   `json:"total" jsonschema:"required"`
}

// ListRunStoreStats returns a paginated list of store stats for a run
// @Summary List ingestion store stats (run)
// @Description Returns aggregated store stats for a specific ingestion run
// @Tags ingestion
// @Accept json
// @Produce json
// @Param runId path string true "Run ID"
// @Param limit query int false "Number of items to return" default(50) minimum(1) maximum(100)
// @Param offset query int false "Number of items to skip" default(0) minimum(0)
// @Success 200 {object} ListStoreStatsResponse
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /internal/ingestion/runs/{runId}/stores [get]
func ListRunStoreStats(c *gin.Context) {
	runID := c.Param("runId")
	if runID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "runId is required"})
		return
	}

	var req ListStoreStatsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Limit == 0 {
		req.Limit = 50
	}

	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	total, err := queries.CountIngestionStoreStatsByRunID(ctx, runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count store stats"})
		return
	}

	rows, err := queries.ListIngestionStoreStatsByRunID(ctx, sqlcgen.ListIngestionStoreStatsByRunIDParams{
		RunID:  runID,
		Limit:  int32(req.Limit),
		Offset: int32(req.Offset),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch store stats"})
		return
	}

	stores := make([]IngestionStoreStats, 0, len(rows))
	for _, row := range rows {
		stat := IngestionStoreStats{
			StoreID:         row.StoreID,
			StoreName:       row.StoreName,
			StoreIdentifier: row.StoreIdentifier,
			RowCount:        int(row.RowCount),
			PersistedCount:  int(row.PersistedCount),
			PriceChanges:    int(row.PriceChanges),
			FailedRows:      int(row.FailedRows),
			WarningRows:     int(row.WarningRows),
		}

		if row.StoreCity.Valid {
			stat.StoreCity = &row.StoreCity.String
		}
		if row.FileCount > 0 {
			v := int(row.FileCount)
			stat.FileCount = &v
		}

		stores = append(stores, stat)
	}

	c.JSON(http.StatusOK, ListStoreStatsResponse{
		Stores: stores,
		Total:  int(total),
	})
}

// ListFileStoreStats returns a paginated list of store stats for a file
// @Summary List ingestion store stats (file)
// @Description Returns store stats for a specific ingestion file
// @Tags ingestion
// @Accept json
// @Produce json
// @Param fileId path string true "File ID"
// @Param limit query int false "Number of items to return" default(50) minimum(1) maximum(100)
// @Param offset query int false "Number of items to skip" default(0) minimum(0)
// @Success 200 {object} ListStoreStatsResponse
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /internal/ingestion/files/{fileId}/stores [get]
func ListFileStoreStats(c *gin.Context) {
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

	var req ListStoreStatsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Limit == 0 {
		req.Limit = 50
	}

	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	total, err := queries.CountIngestionStoreStatsByFileID(ctx, fileIDInt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count store stats"})
		return
	}

	rows, err := queries.ListIngestionStoreStatsByFileID(ctx, sqlcgen.ListIngestionStoreStatsByFileIDParams{
		FileID: fileIDInt,
		Limit:  int32(req.Limit),
		Offset: int32(req.Offset),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch store stats"})
		return
	}

	stores := make([]IngestionStoreStats, 0, len(rows))
	for _, row := range rows {
		stat := IngestionStoreStats{
			StoreID:         row.StoreID,
			StoreName:       row.StoreName,
			StoreIdentifier: row.StoreIdentifier,
			RowCount:        int(row.RowCount),
			PersistedCount:  int(row.PersistedCount),
			PriceChanges:    int(row.PriceChanges),
			FailedRows:      int(row.FailedRows),
			WarningRows:     int(row.WarningRows),
		}

		if row.StoreCity.Valid {
			stat.StoreCity = &row.StoreCity.String
		}

		stores = append(stores, stat)
	}

	c.JSON(http.StatusOK, ListStoreStatsResponse{
		Stores: stores,
		Total:  int(total),
	})
}
