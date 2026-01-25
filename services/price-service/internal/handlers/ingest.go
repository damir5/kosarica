package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/kosarica/price-service/internal/chains"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/pipeline"
	"github.com/rs/zerolog/log"
)

// ingestionSem limits concurrent ingestion goroutines to prevent resource exhaustion
var ingestionSem = make(chan struct{}, 10) // Max 10 concurrent ingestion runs

// IngestChainRequest represents a request body for triggering ingestion
type IngestChainRequest struct {
	TargetDate string `json:"targetDate,omitempty"` // YYYY-MM-DD format
}

// IngestChainStartedResponse represents the 202 response when ingestion is started
type IngestChainStartedResponse struct {
	RunID   string `json:"runId"`
	Status  string `json:"status"`
	PollURL string `json:"pollUrl"`
	Message string `json:"message,omitempty"`
}

// IngestChain triggers ingestion for a specific chain asynchronously
// POST /internal/admin/ingest/:chain
// Returns 202 Accepted immediately with runId and pollUrl
func IngestChain(c *gin.Context) {
	chainID := c.Param("chain")
	if chainID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Chain parameter is required",
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

	// Validate chain ID
	if !chains.IsValidChain(chainID) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Invalid chain ID: %s", chainID),
		})
		return
	}

	// Create run record in database
	pool := database.Pool()
	ctx := c.Request.Context()

	var runID int64
	err := pool.QueryRow(ctx, `
		INSERT INTO ingestion_runs (
			chain_slug, source, status, started_at, created_at
		) VALUES (
			$1, 'api', 'running', NOW(), NOW()
		) RETURNING id
	`, chainID).Scan(&runID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": fmt.Sprintf("Failed to create ingestion run: %v", err),
		})
		return
	}

	// Spawn goroutine for actual processing
	go func() {
		// Acquire semaphore slot (blocks if max concurrent reached)
		ingestionSem <- struct{}{}
		defer func() { <-ingestionSem }() // Release semaphore slot when done

		// Use a background context for the goroutine
		bgCtx := context.Background()
		result, runErr := pipeline.Run(bgCtx, chainID, req.TargetDate)

		// Update run status based on result
		if runErr != nil {
			markRunFailed(bgCtx, runID, runErr.Error())
		} else if !result.Success {
			markRunFailed(bgCtx, runID, fmt.Sprintf("Ingestion completed with %d errors", len(result.Errors)))
		} else {
			markRunCompleted(bgCtx, runID, result.FilesProcessed, result.EntriesPersisted)
		}
	}()

	// Return 202 Accepted immediately
	c.JSON(http.StatusAccepted, IngestChainStartedResponse{
		RunID:   strconv.FormatInt(runID, 10),
		Status:  "started",
		PollURL: fmt.Sprintf("/internal/ingestion/runs/%s", strconv.FormatInt(runID, 10)),
		Message: fmt.Sprintf("Ingestion started for chain %s", chainID),
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

	// Look up status from database
	pool := database.Pool()
	var status string
	err := pool.QueryRow(c.Request.Context(), "SELECT status FROM ingestion_runs WHERE id = $1", runID).Scan(&status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to lookup status"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"runId":  runID,
		"status": status,
	})
}

// ListIngestionRuns returns recent ingestion runs for a chain
// GET /internal/admin/ingest/runs/:chain
func ListIngestionRuns(c *gin.Context) {
	chainID := c.Param("chain")
	if chainID == "" {
		c.JSON(http.StatusOK, gin.H{
			"runs":    []interface{}{},
			"message": "Listing all runs (chain not specified)",
		})
		return
	}

	// Look up runs from database
	pool := database.Pool()
	rows, err := pool.Query(c.Request.Context(), `
		SELECT id, status, started_at, completed_at, files_processed, entries_persisted
		FROM ingestion_runs
		WHERE chain_slug = $1 AND source = 'api'
		ORDER BY started_at DESC
		LIMIT 20
	`, chainID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to lookup runs"})
		return
	}
	defer rows.Close()

	var runs []interface{}
	for rows.Next() {
		var run struct {
			ID               string  `json:"id"`
			Status           string  `json:"status"`
			StartedAt        string  `json:"startedAt"`
			CompletedAt      *string `json:"completedAt,omitempty"`
			FilesProcessed   int     `json:"filesProcessed"`
			EntriesPersisted int     `json:"entriesPersisted"`
		}
		err := rows.Scan(
			&run.ID,
			&run.Status,
			&run.StartedAt,
			&run.CompletedAt,
			&run.FilesProcessed,
			&run.EntriesPersisted,
		)
		if err != nil {
			continue
		}
		runs = append(runs, run)
	}

	c.JSON(http.StatusOK, gin.H{
		"chain": chainID,
		"runs":  runs,
	})
}

// markRunFailed marks an ingestion run as failed
func markRunFailed(ctx context.Context, runID int64, errorMsg string) {
	pool := database.Pool()
	_, err := pool.Exec(ctx, `
		UPDATE ingestion_runs
		SET status = 'failed',
		    completed_at = NOW(),
		    metadata = $2
		WHERE id = $1
	`, runID, fmt.Sprintf(`{"error": "%s"}`, errorMsg))
	if err != nil {
		log.Error().Err(err).Int64("runID", runID).Msg("Failed to mark run as failed")
	}
}

// markRunCompleted marks an ingestion run as completed
func markRunCompleted(ctx context.Context, runID int64, filesProcessed int, entriesPersisted int) {
	pool := database.Pool()
	_, err := pool.Exec(ctx, `
		UPDATE ingestion_runs
		SET status = 'completed',
		    completed_at = NOW(),
		    processed_files = $2,
		    processed_entries = $3
		WHERE id = $1
	`, runID, filesProcessed, entriesPersisted)
	if err != nil {
		log.Error().Err(err).Int64("runID", runID).Msg("Failed to mark run as completed")
	}
}
