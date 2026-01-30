package workers

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/kosarica/price-service/internal/jsonb"
	"github.com/kosarica/price-service/internal/pipeline"
	"github.com/kosarica/price-service/internal/taskqueue"
	"github.com/rs/zerolog"
)

var log = zerolog.New(os.Stdout).With().Timestamp().Str("component", "worker").Logger()

func StartIngestionWorker(ctx context.Context) error {
	queue := taskqueue.New(nil) // Pool will be initialized later
	config := WorkerConfig{
		WorkerID:  "ingestion-worker-1",
		TaskTypes: []string{"ingestion", "rerun"},
		MaxTasks:  5,
		PollDelay: 5 * time.Second,
	}

	worker := New(queue, config)
	worker.RegisterHandler("ingestion", NewIngestionHandler())
	worker.RegisterHandler("rerun", NewRerunHandler())

	log.Info().Msg("Starting ingestion worker...")
	worker.Start(ctx)

	return nil
}

func NewIngestionHandler() func(context.Context, jsonb.TaskQueuePayload) error {
	return func(ctx context.Context, payload jsonb.TaskQueuePayload) error {
		if !payload.IsIngestion() {
			return fmt.Errorf("expected ingestion payload, got type: %s", payload.Type)
		}

		result, err := pipeline.Run(ctx, payload.ChainSlug, "", "")
		if err != nil {
			return err
		}

		if !result.Success {
			return fmt.Errorf("ingestion failed with %d errors", len(result.Errors))
		}

		return nil
	}
}

func NewRerunHandler() func(context.Context, jsonb.TaskQueuePayload) error {
	return func(ctx context.Context, payload jsonb.TaskQueuePayload) error {
		if !payload.IsRerun() {
			return fmt.Errorf("expected rerun payload, got type: %s", payload.Type)
		}

		// Use the typed fields directly
		originalRunID := ""
		if payload.OriginalRunID != nil {
			originalRunID = *payload.OriginalRunID
		}

		result, err := pipeline.Run(ctx, "konzum", originalRunID, "")
		if err != nil {
			return err
		}

		if !result.Success {
			return fmt.Errorf("rerun failed with %d errors", len(result.Errors))
		}

		return nil
	}
}

func CleanupOldRuns(ctx context.Context) error {
	queue := taskqueue.New(nil)
	count, err := queue.CleanupOldTasks(ctx, 7) // Keep 7 days
	if err != nil {
		return fmt.Errorf("failed to cleanup old tasks: %w", err)
	}

	log.Info().Int("count", count).Msg("Cleaned up old tasks")
	return nil
}
