package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/chains"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/jsonb"
	"github.com/kosarica/price-service/internal/pkg/cuid2"
	"github.com/kosarica/price-service/internal/taskqueue"
	"github.com/rs/zerolog/log"
)

// IngestChainRequest represents a request body for triggering ingestion
type IngestChainRequest struct {
	TargetDate string `json:"targetDate,omitempty"` // YYYY-MM-DD format
	Priority   int    `json:"priority,omitempty"`   // 0=normal, higher=more urgent
	Force      bool   `json:"force,omitempty"`      // Force re-ingestion even if exists
}

// IngestChainScheduledResponse represents the 202 response when ingestion is scheduled
type IngestChainScheduledResponse struct {
	RunID         string `json:"runId"`
	Status        string `json:"status"`
	PollURL       string `json:"pollUrl"`
	Message       string `json:"message,omitempty"`
	TaskID        string `json:"taskId,omitempty"`
	PreviousRunID string `json:"previousRunId,omitempty"`
	IsForced      bool   `json:"isForced"`
}

// ExistingIngestionResponse represents the 200 response when ingestion already exists
type ExistingIngestionResponse struct {
	RunID       string `json:"runId"`
	Status      string `json:"status"`
	PollURL     string `json:"pollUrl"`
	Message     string `json:"message,omitempty"`
	CompletedAt string `json:"completedAt,omitempty"`
	StartedAt   string `json:"startedAt,omitempty"`
	IsForced    bool   `json:"isForced"`
}

// IngestChain triggers ingestion for a specific chain
// POST /internal/admin/ingest/:chain
// Returns 202 Accepted for new ingestion, 200 OK for existing ingestion
func IngestChain(c *gin.Context) {
	chainID := c.Param("chain")
	if chainID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Chain parameter is required",
		})
		return
	}

	// Parse request body
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

	// Default target date to today
	targetDate := req.TargetDate
	if targetDate == "" {
		targetDate = time.Now().Format("2006-01-02")
	}

	ctx := c.Request.Context()
	queries := sqlcgen.New(database.Pool())

	// Check for existing ingestion (duplicate detection)
	existingRun, err := checkExistingIngestion(ctx, chainID, targetDate)
	if err != nil {
		log.Error().Err(err).Str("chain", chainID).Str("date", targetDate).Msg("Failed to check existing ingestion")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to check existing ingestion",
		})
		return
	}

	// Handle existing ingestion
	if existingRun != nil {
		// If not forcing, return existing run info
		if !req.Force {
			response := ExistingIngestionResponse{
				RunID:    existingRun.ID,
				Status:   existingRun.Status,
				PollURL:  fmt.Sprintf("/internal/ingestion/runs/%s", existingRun.ID),
				Message:  fmt.Sprintf("Ingestion already %s for %s", existingRun.Status, targetDate),
				IsForced: existingRun.IsForced.Bool,
			}

			if existingRun.StartedAt.Valid {
				response.StartedAt = existingRun.StartedAt.Time.Format(time.RFC3339)
			}
			if existingRun.CompletedAt.Valid {
				response.CompletedAt = existingRun.CompletedAt.Time.Format(time.RFC3339)
			}

			c.JSON(http.StatusOK, response)
			return
		}

		// Force flag is set - create new ingestion
		log.Info().
			Str("chain", chainID).
			Str("date", targetDate).
			Str("previousRunId", existingRun.ID).
			Msg("Force re-ingestion requested")
	}

	// Create new run record with pending status
	runID := cuid2.GeneratePrefixedId("run", cuid2.PrefixedIdOptions{})
	now := time.Now()

	// Parse target date for storage
	targetDateTime, err := time.Parse("2006-01-02", targetDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Invalid targetDate format: %s", targetDate),
		})
		return
	}

	_, err = queries.CreateIngestionRun(ctx, sqlcgen.CreateIngestionRunParams{
		ID:        runID,
		ChainSlug: chainID,
		Source:    "api",
		Status:    "pending",
		CreatedAt: pgtype.Timestamp{Time: now, Valid: true},
	})
	if err != nil {
		log.Error().Err(err).Str("runId", runID).Msg("Failed to create ingestion run")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to create ingestion run",
		})
		return
	}

	// Update target_date and is_forced (required for duplicate detection)
	err = queries.UpdateIngestionRunTargetDate(ctx, sqlcgen.UpdateIngestionRunTargetDateParams{
		ID:         runID,
		TargetDate: pgtype.Timestamptz{Time: targetDateTime, Valid: true},
		IsForced:   pgtype.Bool{Bool: req.Force, Valid: true},
	})
	if err != nil {
		log.Error().Err(err).Str("runId", runID).Msg("Failed to update run target date")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to configure ingestion run",
		})
		return
	}

	// Schedule task in queue (using new parent-child architecture)
	tq := taskqueue.New(database.Pool())
	scheduleResult := tq.ScheduleTask(ctx, taskqueue.ScheduleTaskInput{
		TaskType: string(taskqueue.TaskTypeIngestionDiscover),
		Payload: jsonb.TaskQueuePayload{
			Type:       "ingestion_discover",
			ChainSlug:  chainID,
			TargetDate: &targetDate,
			RunID:      &runID,
		},
		Priority:   req.Priority,
		MaxRetries: 3,
	})

	if scheduleResult.Err != nil {
		log.Error().Err(scheduleResult.Err).Str("runId", runID).Msg("Failed to schedule ingestion task")
		// Mark run as failed since we couldn't schedule it
		errorMeta := map[string]string{"error": fmt.Sprintf("Failed to schedule task: %s", scheduleResult.Err.Error())}
		metaJSON, _ := json.Marshal(errorMeta)
		queries.UpdateIngestionRunFailed(ctx, sqlcgen.UpdateIngestionRunFailedParams{
			ID:       runID,
			Metadata: pgtype.Text{String: string(metaJSON), Valid: true},
		})
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to schedule ingestion task",
		})
		return
	}

	// Return 202 Accepted with scheduled status
	response := IngestChainScheduledResponse{
		RunID:    runID,
		Status:   "scheduled",
		PollURL:  fmt.Sprintf("/internal/ingestion/runs/%s", runID),
		Message:  fmt.Sprintf("Ingestion scheduled for %s", targetDate),
		TaskID:   scheduleResult.ID,
		IsForced: req.Force,
	}

	if existingRun != nil && req.Force {
		response.PreviousRunID = existingRun.ID
		response.Message = fmt.Sprintf("Forced re-ingestion scheduled for %s", targetDate)
	}

	log.Info().
		Str("runId", runID).
		Str("chain", chainID).
		Str("date", targetDate).
		Str("taskId", scheduleResult.ID).
		Bool("forced", req.Force).
		Int("priority", req.Priority).
		Msg("Ingestion scheduled")

	c.JSON(http.StatusAccepted, response)
}

// checkExistingIngestion looks for an active or completed ingestion for chain+date
// Returns the existing run if found, nil if not found
func checkExistingIngestion(ctx context.Context, chainSlug string, targetDate string) (*sqlcgen.IngestionRun, error) {
	queries := sqlcgen.New(database.Pool())

	// Parse target date
	targetDateTime, err := time.Parse("2006-01-02", targetDate)
	if err != nil {
		return nil, err
	}

	// Look for any run (active or completed) for this chain+date
	run, err := queries.GetIngestionRunByChainAndDate(ctx, sqlcgen.GetIngestionRunByChainAndDateParams{
		ChainSlug:  chainSlug,
		TargetDate: pgtype.Timestamptz{Time: targetDateTime, Valid: true},
	})

	if err == pgx.ErrNoRows {
		return nil, nil // No existing ingestion
	}
	if err != nil {
		return nil, err
	}

	return &run, nil
}
