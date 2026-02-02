package workers

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/jsonb"
	"github.com/kosarica/price-service/internal/taskqueue"
	"github.com/rs/zerolog"
)

var log = zerolog.New(os.Stdout).With().Timestamp().Str("component", "worker").Logger()

// isRetryableError checks if an error should be retried.
// Returns false for data constraint violations that won't be fixed by retry.
func isRetryableError(errMsg string) bool {
	// List of non-retryable database errors
	nonRetryablePatterns := []string{
		"duplicate key value violates unique constraint",
		"violates unique constraint",
		"violates check constraint",
		"violates not-null constraint",
		"violates foreign key constraint",
		"violates exclusion constraint",
	}

	errLower := strings.ToLower(errMsg)
	for _, pattern := range nonRetryablePatterns {
		if strings.Contains(errLower, strings.ToLower(pattern)) {
			return false
		}
	}

	return true
}

type WorkerConfig struct {
	WorkerID   string
	TaskTypes  []string
	MaxTasks   int
	NumWorkers int
	PollDelay  time.Duration
}

// ExtendedHandler is a handler that receives the task queue and task ID for parent-child task support
type ExtendedHandler func(ctx context.Context, payload jsonb.TaskQueuePayload, tq *taskqueue.TaskQueue, taskID string) error

type Worker struct {
	queue            *taskqueue.TaskQueue
	config           WorkerConfig
	handlers         map[string]func(context.Context, jsonb.TaskQueuePayload) error
	extendedHandlers map[string]ExtendedHandler
	stopChan         chan struct{}
	running          chan struct{}
	wg               sync.WaitGroup
}

func New(queue *taskqueue.TaskQueue, config WorkerConfig) *Worker {
	return &Worker{
		queue:            queue,
		config:           config,
		handlers:         make(map[string]func(context.Context, jsonb.TaskQueuePayload) error),
		extendedHandlers: make(map[string]ExtendedHandler),
		stopChan:         make(chan struct{}),
		running:          make(chan struct{}),
	}
}

func (w *Worker) RegisterHandler(taskType string, handler func(context.Context, jsonb.TaskQueuePayload) error) {
	w.handlers[taskType] = handler
}

// RegisterExtendedHandler registers a handler that receives the task queue and task ID
// Use this for handlers that need to schedule child tasks
func (w *Worker) RegisterExtendedHandler(taskType string, handler ExtendedHandler) {
	w.extendedHandlers[taskType] = handler
}

func (w *Worker) Start(ctx context.Context) {
	log.Info().
		Str("component", "worker").
		Str("worker_id", w.config.WorkerID).
		Strs("task_types", w.config.TaskTypes).
		Msg("Starting worker")

	for i := 0; i < w.config.NumWorkers; i++ {
		go w.workerLoop(ctx, i)
	}
}

func (w *Worker) Stop() {
	close(w.stopChan)
	log.Info().
		Str("component", "worker").
		Str("worker_id", w.config.WorkerID).
		Msg("Worker stopping, waiting for in-flight tasks")
	w.wg.Wait()
	log.Info().
		Str("component", "worker").
		Str("worker_id", w.config.WorkerID).
		Msg("Worker stopped")
}

func (w *Worker) workerLoop(ctx context.Context, workerNum int) {
	workerID := fmt.Sprintf("%s-%d", w.config.WorkerID, workerNum)
	log.Info().
		Str("component", "worker").
		Str("worker_id", workerID).
		Msg("Starting worker goroutine")

	ticker := time.NewTicker(w.config.PollDelay)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Info().
				Str("component", "worker").
				Str("worker_id", workerID).
				Msg("Worker shutting down")
			return

		case <-w.stopChan:
			log.Info().
				Str("component", "worker").
				Str("worker_id", workerID).
				Msg("Worker received stop signal")
			return

		case <-ticker.C:
			w.processTasks(ctx, workerID)
		}
	}
}

func (w *Worker) processTasks(ctx context.Context, workerID string) {
	claimResult := w.queue.ClaimTasks(ctx, taskqueue.ClaimTasksInput{
		WorkerID:  workerID,
		TaskTypes: w.config.TaskTypes,
		MaxTasks:  w.config.MaxTasks,
	})

	if claimResult.Err != nil {
		log.Error().Err(claimResult.Err).Msg("Failed to claim tasks")
		return
	}

	if len(claimResult.Tasks) == 0 {
		return // No tasks to process
	}

	log.Info().
		Str("component", "worker").
		Str("worker_id", workerID).
		Int("task_count", len(claimResult.Tasks)).
		Msg("Worker claimed tasks")

	for _, task := range claimResult.Tasks {
		w.processTask(ctx, workerID, task)
	}
}

func (w *Worker) processTask(ctx context.Context, workerID string, task taskqueue.ClaimedTask) {
	w.wg.Add(1)
	defer w.wg.Done()

	// Extract runId from payload for logging
	runID := ""
	if task.Payload.RunID != nil {
		runID = *task.Payload.RunID
	}

	// Check for extended handler first, then regular handler
	handler, hasHandler := w.handlers[task.TaskType]
	extHandler, hasExtHandler := w.extendedHandlers[task.TaskType]

	if !hasHandler && !hasExtHandler {
		log.Warn().
			Str("task_type", task.TaskType).
			Msg("No handler for task type")
		w.queue.FailTask(ctx, task.ID, "No handler registered", false)
		return
	}

	log.Info().
		Str("component", "worker").
		Str("worker_id", workerID).
		Str("task_id", task.ID).
		Str("task_type", task.TaskType).
		Str("run_id", runID).
		Msg("Worker processing task")

	// Transition to 'processing' status
	pool := w.queue.GetPool()
	queries := sqlcgen.New(pool)
	err := queries.SetTaskProcessingAny(ctx, task.ID)
	if err != nil {
		log.Error().Err(err).Msg("Failed to mark task as processing")
		w.queue.FailTask(ctx, task.ID, fmt.Sprintf("Status update failed: %v", err), false)
		return
	}

	// Execute the appropriate handler
	var handlerErr error
	if hasExtHandler {
		handlerErr = extHandler(ctx, task.Payload, w.queue, task.ID)
	} else {
		handlerErr = handler(ctx, task.Payload)
	}

	if handlerErr != nil {
		shouldRetry := isRetryableError(handlerErr.Error())
		w.queue.FailTask(ctx, task.ID, handlerErr.Error(), shouldRetry)

		logEvent := log.Error().
			Str("task_id", task.ID).
			Str("run_id", runID).
			Err(handlerErr).
			Bool("will_retry", shouldRetry)

		if !shouldRetry {
			logEvent.Msg("Task failed with non-retryable error (constraint violation)")
		} else {
			logEvent.Msg("Task failed and will retry")
		}
		return
	}

	completeErr := w.queue.CompleteTask(ctx, task.ID, task.Payload)
	if completeErr != nil {
		log.Error().Err(completeErr).Msg("Failed to mark task as completed")
		return
	}

	log.Info().
		Str("component", "worker").
		Str("worker_id", workerID).
		Str("task_id", task.ID).
		Str("run_id", runID).
		Msg("Worker completed task")
}
