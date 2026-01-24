package taskqueue

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

type TaskQueue struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *TaskQueue {
	return &TaskQueue{pool: pool}
}

func (q *TaskQueue) GetPool() *pgxpool.Pool {
	return q.pool
}

type ScheduleTaskInput struct {
	TaskType    string
	Payload     interface{}
	Priority    int
	ScheduledAt interface{}
	MaxRetries  int
}

type ScheduleTaskResult struct {
	ID  string
	Err error
}

func (q *TaskQueue) ScheduleTask(ctx context.Context, input ScheduleTaskInput) ScheduleTaskResult {
	payload, err := json.Marshal(input.Payload)
	if err != nil {
		return ScheduleTaskResult{Err: err}
	}

	maxRetries := 3
	if input.MaxRetries > 0 {
		maxRetries = input.MaxRetries
	}

	priority := 0
	if input.Priority > 0 {
		priority = input.Priority
	}

	var id string
	if input.ScheduledAt != nil {
		err = q.pool.QueryRow(ctx, `
			INSERT INTO task_queue (task_type, payload, priority, scheduled_for, max_retries)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id
		`, input.TaskType, payload, priority, input.ScheduledAt, maxRetries).Scan(&id)
	} else {
		err = q.pool.QueryRow(ctx, `
			INSERT INTO task_queue (task_type, payload, priority, scheduled_for, max_retries)
			VALUES ($1, $2, $3, NOW(), $4)
			RETURNING id
		`, input.TaskType, payload, priority, maxRetries).Scan(&id)
	}

	if err != nil {
		return ScheduleTaskResult{Err: err}
	}

	return ScheduleTaskResult{ID: id}
}

type ClaimTasksInput struct {
	WorkerID  string
	TaskTypes []string
	MaxTasks  int
}

type ClaimTasksResult struct {
	Tasks []ClaimedTask
	Err   error
}

func (q *TaskQueue) ClaimTasks(ctx context.Context, input ClaimTasksInput) ClaimTasksResult {
	rows, err := q.pool.Query(ctx, `
		SELECT * FROM claim_tasks($1, $2, $3)
	`, input.WorkerID, input.TaskTypes, input.MaxTasks)
	if err != nil {
		return ClaimTasksResult{Err: err}
	}
	defer rows.Close()

	tasks := make([]ClaimedTask, 0)
	for rows.Next() {
		var task ClaimedTask
		if err := rows.Scan(&task.ID, &task.TaskType, &task.Payload); err != nil {
			return ClaimTasksResult{Err: err}
		}
		tasks = append(tasks, task)
	}

	return ClaimTasksResult{Tasks: tasks}
}

func (q *TaskQueue) CompleteTask(ctx context.Context, taskID string, result interface{}) error {
	resultJSON := "NULL"
	if result != nil {
		data, err := json.Marshal(result)
		if err != nil {
			return err
		}
		resultJSON = string(data)
	}

	_, err := q.pool.Exec(ctx, `SELECT complete_task($1, `+resultJSON+`)`, taskID)
	return err
}

func (q *TaskQueue) FailTask(ctx context.Context, taskID, errorMessage string, shouldRetry bool) error {
	_, err := q.pool.Exec(ctx, `SELECT fail_task($1, $2, $3)`, taskID, errorMessage, shouldRetry)
	return err
}

func (q *TaskQueue) CleanupOldTasks(ctx context.Context, daysToKeep int) (int, error) {
	var count int
	err := q.pool.QueryRow(ctx, `SELECT cleanup_old_tasks($1)`, daysToKeep).Scan(&count)
	return count, err
}

func (q *TaskQueue) CancelTask(ctx context.Context, taskID string) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE task_queue
		SET status = 'cancelled', updated_at = NOW()
		WHERE id = $1 AND status IN ('pending', 'claimed')
	`, taskID)
	return err
}

func (q *TaskQueue) GetTask(ctx context.Context, taskID string) (*Task, error) {
	var task Task
	err := q.pool.QueryRow(ctx, `
		SELECT id, task_type, payload, priority, status,
		       scheduled_for, started_at, completed_at, failed_at,
		       worker_id, retry_count, max_retries, error_message,
		       created_at, updated_at
		FROM task_queue
		WHERE id = $1
	`, taskID).Scan(
		&task.ID, &task.TaskType, &task.Payload, &task.Priority, &task.Status,
		&task.ScheduledFor, &task.StartedAt, &task.CompletedAt, &task.FailedAt,
		&task.WorkerID, &task.RetryCount, &task.MaxRetries, &task.ErrorMessage,
		&task.CreatedAt, &task.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &task, nil
}
