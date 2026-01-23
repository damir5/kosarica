package workers

import (
	"context"
	"fmt"
	"time"

	"github.com/kosarica/price-service/internal/pipeline"
	"github.com/kosarica/price-service/internal/taskqueue"
)

func StartIngestionWorker(ctx context.Context) error {
	queue := taskqueue.New(nil) // Pool will be initialized later
	config := taskqueue.WorkerConfig{
		WorkerID:  "ingestion-worker-1",
		TaskTypes: []string{taskqueue.TaskTypeIngestion, taskqueue.TaskTypeRerun},
		MaxTasks:  5,
		PollDelay: 5 * time.Second,
	}

	worker := New(queue, config)
	worker.RegisterHandler(taskqueue.TaskTypeIngestion, NewIngestionHandler(""))
	worker.RegisterHandler(taskqueue.TaskTypeRerun, NewRerunHandler())

	fmt.Println("[WORKER] Starting ingestion worker...")
	worker.Start(ctx)

	return nil
}

func NewRerunHandler() func(context.Context, []byte) error {
	return func(ctx context.Context, payload []byte) error {
		var req struct {
			RunID string `json:"runId"`
		}

		if err := json.Unmarshal(payload, &req); err != nil {
			return fmt.Errorf("failed to unmarshal rerun payload: %w", err)
		}

		result, err := pipeline.Run(ctx, "konzum", "")
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

	fmt.Printf("[WORKER] Cleaned up %d old tasks\n", count)
	return nil
}
