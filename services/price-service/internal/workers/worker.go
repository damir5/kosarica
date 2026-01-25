package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/kosarica/price-service/internal/taskqueue"
)

type WorkerConfig struct {
	WorkerID   string
	TaskTypes  []string
	MaxTasks   int
	NumWorkers int
	PollDelay  time.Duration
}

type Worker struct {
	queue    *taskqueue.TaskQueue
	config   WorkerConfig
	handlers map[string]func(context.Context, []byte) error
	stopChan chan struct{}
	running  chan struct{}
	wg       sync.WaitGroup
}

func New(queue *taskqueue.TaskQueue, config WorkerConfig) *Worker {
	return &Worker{
		queue:    queue,
		config:   config,
		handlers: make(map[string]func(context.Context, []byte) error),
		stopChan: make(chan struct{}),
		running:  make(chan struct{}),
	}
}

func (w *Worker) RegisterHandler(taskType string, handler func(context.Context, []byte) error) {
	w.handlers[taskType] = handler
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

	handler, exists := w.handlers[task.TaskType]
	if !exists {
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
		Msg("Worker processing task")

	// Transition to 'processing' status
	pool := w.queue.GetPool()
	_, err := pool.Exec(ctx, `
		UPDATE task_queue
		SET status = 'processing', updated_at = NOW()
		WHERE id = $1
		`, task.ID)
	if err != nil {
		log.Error().Err(err).Msg("Failed to mark task as processing")
		w.queue.FailTask(ctx, task.ID, fmt.Sprintf("Status update failed: %v", err), false)
		return
	}

	var payloadJSON interface{}
	if err := json.Unmarshal(task.Payload, &payloadJSON); err != nil {
		log.Error().Err(err).Msg("Failed to unmarshal payload")
		w.queue.FailTask(ctx, task.ID, fmt.Sprintf("Payload parse error: %v", err), false)
		return
	}

	handlerErr := handler(ctx, task.Payload)
	if handlerErr != nil {
		w.queue.FailTask(ctx, task.ID, handlerErr.Error(), true)
		log.Error().
			Str("task_id", task.ID).
			Err(handlerErr).
			Msg("Task failed")
		return
	}

	completeErr := w.queue.CompleteTask(ctx, task.ID, payloadJSON)
	if completeErr != nil {
		log.Error().Err(completeErr).Msg("Failed to mark task as completed")
		return
	}

	log.Info().
		Str("component", "worker").
		Str("worker_id", workerID).
		Str("task_id", task.ID).
		Msg("Worker completed task")
}
