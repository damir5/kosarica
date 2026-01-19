package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/kosarica/price-service/internal/pipeline"
)

// IngestChainRequest represents the request body for triggering ingestion
type IngestChainRequest struct {
	TargetDate string `json:"targetDate,omitempty"` // YYYY-MM-DD format
}

// IngestChainResponse represents the response from triggering ingestion
type IngestChainResponse struct {
	Success         bool   `json:"success"`
	RunID           string `json:"runId"`
	FilesProcessed  int    `json:"filesProcessed"`
	EntriesPersisted int   `json:"entriesPersisted"`
	Errors          []string `json:"errors,omitempty"`
	Message         string `json:"message,omitempty"`
}

// IngestChain triggers ingestion for a specific chain
// POST /internal/admin/ingest/:chain
func IngestChain(c *gin.Context) {
	chainID := c.Param("chain")
	if chainID == "" {
		c.JSON(http.StatusBadRequest, IngestChainResponse{
			Success: false,
			Message: "Chain parameter is required",
		})
		return
	}

	// Parse optional request body
	var req IngestChainRequest
	if c.Request.Body != nil && c.Request.ContentLength > 0 {
		if err := c.BindJSON(&req); err != nil {
			// Ignore bind errors, use defaults
		}
	}

	// Run the ingestion pipeline synchronously
	// Scaling is achieved by calling this endpoint multiple times for different chains
	result, err := pipeline.Run(c.Request.Context(), chainID, req.TargetDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, IngestChainResponse{
			Success: false,
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, IngestChainResponse{
		Success:         result.Success,
		RunID:           result.RunID,
		FilesProcessed:  result.FilesProcessed,
		EntriesPersisted: result.EntriesPersisted,
		Errors:          result.Errors,
		Message:         "Ingestion completed",
	})
}

// GetIngestionStatus returns the status of an ingestion run
// GET /internal/admin/ingest/status/:runId
func GetIngestionStatus(c *gin.Context) {
	runID := c.Param("runId")
	if runID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "runId parameter is required",
		})
		return
	}

	// TODO: Implement status lookup from database
	c.JSON(http.StatusOK, gin.H{
		"runId":  runID,
		"status": "pending",
		"message": "Status lookup not yet implemented",
	})
}

// ListIngestionRuns returns recent ingestion runs for a chain
// GET /internal/admin/ingest/runs/:chain
func ListIngestionRuns(c *gin.Context) {
	chainID := c.Param("chain")
	if chainID == "" {
		c.JSON(http.StatusOK, gin.H{
			"runs":  []interface{}{},
			"message": "Listing all runs (chain not specified)",
		})
		return
	}

	// TODO: Implement runs lookup from database
	c.JSON(http.StatusOK, gin.H{
		"chain": chainID,
		"runs":  []interface{}{},
		"message": "Run listing not yet implemented",
	})
}
