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
	fmt.Printf("[WORKER] Starting worker: %s (types: %v)\n", w.config.WorkerID, w.config.TaskTypes)

	for i := 0; i < w.config.NumWorkers; i++ {
		go w.workerLoop(ctx, i)
	}
}

func (w *Worker) Stop() {
	close(w.stopChan)
	fmt.Printf("[WORKER] Worker %s stopping, waiting for in-flight tasks...\n", w.config.WorkerID)
	w.wg.Wait()
	fmt.Printf("[WORKER] Worker %s stopped\n", w.config.WorkerID)
}

func (w *Worker) workerLoop(ctx context.Context, workerNum int) {
	workerID := fmt.Sprintf("%s-%d", w.config.WorkerID, workerNum)
	fmt.Printf("[WORKER] Starting worker goroutine %s\n", workerID)

	ticker := time.NewTicker(w.config.PollDelay)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			fmt.Printf("[WORKER] Worker %s shutting down\n", workerID)
			return

		case <-w.stopChan:
			fmt.Printf("[WORKER] Worker %s received stop signal\n", workerID)
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
		fmt.Printf("[ERROR] Failed to claim tasks: %v\n", claimResult.Err)
		return
	}

	if len(claimResult.Tasks) == 0 {
		return // No tasks to process
	}

	fmt.Printf("[WORKER] Worker %s claimed %d tasks\n", workerID, len(claimResult.Tasks))

	for _, task := range claimResult.Tasks {
		w.processTask(ctx, workerID, task)
	}
}

func (w *Worker) processTask(ctx context.Context, workerID string, task taskqueue.ClaimedTask) {
	w.wg.Add(1)
	defer w.wg.Done()

	handler, exists := w.handlers[task.TaskType]
	if !exists {
		fmt.Printf("[WARN] No handler for task type: %s\n", task.TaskType)
		w.queue.FailTask(ctx, task.ID, "No handler registered", false)
		return
	}

	fmt.Printf("[WORKER] Worker %s processing task %s (type: %s)\n", workerID, task.ID, task.TaskType)

	// Transition to 'processing' status
	pool := w.queue.GetPool()
	_, err := pool.Exec(ctx, `
		UPDATE task_queue
		SET status = 'processing', updated_at = NOW()
		WHERE id = $1
		`, task.ID)
	if err != nil {
		fmt.Printf("[ERROR] Failed to mark task as processing: %v\n", err)
		w.queue.FailTask(ctx, task.ID, fmt.Sprintf("Status update failed: %v", err), false)
		return
	}

	var payloadJSON interface{}
	if err := json.Unmarshal(task.Payload, &payloadJSON); err != nil {
		fmt.Printf("[ERROR] Failed to unmarshal payload: %v\n", err)
		w.queue.FailTask(ctx, task.ID, fmt.Sprintf("Payload parse error: %v", err), false)
		return
	}

	handlerErr := handler(ctx, task.Payload)
	if handlerErr != nil {
		w.queue.FailTask(ctx, task.ID, handlerErr.Error(), true)
		fmt.Printf("[ERROR] Task %s failed: %v\n", task.ID, handlerErr)
		return
	}

	completeErr := w.queue.CompleteTask(ctx, task.ID, payloadJSON)
	if completeErr != nil {
		fmt.Printf("[ERROR] Failed to mark task as completed: %v\n", completeErr)
		return
	}

	fmt.Printf("[WORKER] Worker %s completed task %s\n", workerID, task.ID)
}
