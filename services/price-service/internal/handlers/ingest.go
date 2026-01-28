package handlers

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/chains"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/pipeline"
	"github.com/kosarica/price-service/internal/pkg/cuid2"
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

	// Create run record in database using sqlc
	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	runID := cuid2.GeneratePrefixedId("run", cuid2.PrefixedIdOptions{})
	now := time.Now()

	_, err := queries.CreateIngestionRun(ctx, sqlcgen.CreateIngestionRunParams{
		ID:        runID,
		ChainSlug: chainID,
		Source:    "api",
		Status:    "running",
		StartedAt: pgtype.Timestamp{Time: now, Valid: true},
		CreatedAt: pgtype.Timestamp{Time: now, Valid: true},
	})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": fmt.Sprintf("Failed to create ingestion run: %v", err),
		})
		return
	}

	// Spawn goroutine for actual processing
	go func() {
		// Use a background context for the goroutine
		bgCtx := context.Background()

		// Add panic recovery to prevent silent crashes
		defer func() {
			if r := recover(); r != nil {
				log.Error().Interface("panic", r).Str("runID", runID).Str("chain", chainID).Msg("Ingestion goroutine panicked")
				markRunFailed(bgCtx, runID, fmt.Sprintf("panic: %v", r))
			}
		}()

		// Acquire semaphore slot (blocks if max concurrent reached)
		ingestionSem <- struct{}{}
		defer func() { <-ingestionSem }() // Release semaphore slot when done

		// Pass the handler's runID to the pipeline to avoid duplicate run creation
		result, runErr := pipeline.Run(bgCtx, chainID, req.TargetDate, runID)

		// Update run status based on result with proper logging
		if runErr != nil {
			log.Error().Err(runErr).Str("runID", runID).Str("chain", chainID).Msg("Ingestion failed")
			markRunFailed(bgCtx, runID, runErr.Error())
		} else if !result.Success {
			log.Warn().Str("runID", runID).Int("errors", len(result.Errors)).Msg("Ingestion completed with errors")
			markRunFailed(bgCtx, runID, fmt.Sprintf("Ingestion completed with %d errors", len(result.Errors)))
		} else {
			log.Info().Str("runID", runID).Int("files", result.FilesProcessed).Int("entries", result.EntriesPersisted).Msg("Ingestion completed successfully")
			markRunCompleted(bgCtx, runID, result.FilesProcessed, result.EntriesPersisted)
		}
	}()

	// Return 202 Accepted immediately
	c.JSON(http.StatusAccepted, IngestChainStartedResponse{
		RunID:   runID,
		Status:  "started",
		PollURL: fmt.Sprintf("/internal/ingestion/runs/%s", runID),
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

	// Look up status from database using sqlc
	queries := sqlcgen.New(database.Pool())
	run, err := queries.GetIngestionRun(c.Request.Context(), runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to lookup status"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"runId":  runID,
		"status": run.Status,
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

	// Look up runs from database using sqlc
	queries := sqlcgen.New(database.Pool())
	rows, err := queries.ListIngestionRunsByChain(c.Request.Context(), sqlcgen.ListIngestionRunsByChainParams{
		ChainSlug: chainID,
		Limit:     20,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to lookup runs"})
		return
	}

	// Convert to response format
	var runs []interface{}
	for _, row := range rows {
		run := struct {
			ID               string  `json:"id"`
			Status           string  `json:"status"`
			StartedAt        string  `json:"startedAt"`
			CompletedAt      *string `json:"completedAt,omitempty"`
			FilesProcessed   int     `json:"filesProcessed"`
			EntriesPersisted int     `json:"entriesPersisted"`
		}{
			ID:     row.ID,
			Status: row.Status,
		}

		if row.StartedAt.Valid {
			s := row.StartedAt.Time.Format(time.RFC3339)
			run.StartedAt = s
		}
		if row.CompletedAt.Valid {
			s := row.CompletedAt.Time.Format(time.RFC3339)
			run.CompletedAt = &s
		}
		if row.ProcessedFiles.Valid {
			run.FilesProcessed = int(row.ProcessedFiles.Int32)
		}
		if row.ProcessedEntries.Valid {
			run.EntriesPersisted = int(row.ProcessedEntries.Int32)
		}
		runs = append(runs, run)
	}

	c.JSON(http.StatusOK, gin.H{
		"chain": chainID,
		"runs":  runs,
	})
}

// markRunFailed marks an ingestion run as failed using sqlc
func markRunFailed(ctx context.Context, runID string, errorMsg string) {
	queries := sqlcgen.New(database.Pool())
	err := queries.UpdateIngestionRunFailed(ctx, sqlcgen.UpdateIngestionRunFailedParams{
		ID:       runID,
		Metadata: pgtype.Text{String: fmt.Sprintf(`{"error": "%s"}`, errorMsg), Valid: true},
	})
	if err != nil {
		log.Error().Err(err).Str("runID", runID).Msg("Failed to mark run as failed")
	}
}

// markRunCompleted marks an ingestion run as completed using sqlc
func markRunCompleted(ctx context.Context, runID string, filesProcessed int, entriesPersisted int) {
	queries := sqlcgen.New(database.Pool())
	err := queries.UpdateIngestionRunStatus(ctx, sqlcgen.UpdateIngestionRunStatusParams{
		ID:               runID,
		Status:           "completed",
		CompletedAt:      pgtype.Timestamp{Time: time.Now(), Valid: true},
		ProcessedFiles:   pgtype.Int4{Int32: int32(filesProcessed), Valid: true},
		ProcessedEntries: pgtype.Int4{Int32: int32(entriesPersisted), Valid: true},
	})
	if err != nil {
		log.Error().Err(err).Str("runID", runID).Msg("Failed to mark run as completed")
	}
}
