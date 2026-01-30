package taskqueue

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/jsonb"
)

// Note: Some methods in this file use raw SQL for stored procedure calls
// because sqlc cannot properly infer return types for PL/pgSQL functions.
// Methods using sqlc: ScheduleTask, CancelTask, GetTask
// Methods using raw SQL: ClaimTasks, CompleteTask, FailTask, CleanupOldTasks

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
	Payload     jsonb.TaskQueuePayload
	Priority    int
	ScheduledAt interface{}
	MaxRetries  int
}

type ScheduleTaskResult struct {
	ID  string
	Err error
}

func (q *TaskQueue) ScheduleTask(ctx context.Context, input ScheduleTaskInput) ScheduleTaskResult {
	maxRetries := 3
	if input.MaxRetries > 0 {
		maxRetries = input.MaxRetries
	}

	priority := 0
	if input.Priority > 0 {
		priority = input.Priority
	}

	queries := sqlcgen.New(q.pool)
	id, err := queries.ScheduleTask(ctx, sqlcgen.ScheduleTaskParams{
		TaskType:   input.TaskType,
		Payload:    input.Payload,
		Priority:   pgtype.Int4{Int32: int32(priority), Valid: true},
		Column4:    input.ScheduledAt, // nil means NOW() via COALESCE
		MaxRetries: pgtype.Int4{Int32: int32(maxRetries), Valid: true},
	})

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
	queries := sqlcgen.New(q.pool)
	return queries.CancelTask(ctx, taskID)
}

func (q *TaskQueue) GetTask(ctx context.Context, taskID string) (*Task, error) {
	queries := sqlcgen.New(q.pool)
	sqlcTask, err := queries.GetTask(ctx, taskID)
	if err != nil {
		return nil, err
	}

	// Convert sqlcgen.TaskQueue to taskqueue.Task
	task := &Task{
		ID:         sqlcTask.ID,
		TaskType:   sqlcTask.TaskType,
		Payload:    sqlcTask.Payload,
		Priority:   int(sqlcTask.Priority.Int32),
		Status:     TaskStatus(sqlcTask.Status),
		RetryCount: int(sqlcTask.RetryCount.Int32),
		MaxRetries: int(sqlcTask.MaxRetries.Int32),
	}

	// Handle nullable timestamp fields
	if sqlcTask.ScheduledFor.Valid {
		s := sqlcTask.ScheduledFor.Time.Format("2006-01-02 15:04:05")
		task.ScheduledFor = &s
	}
	if sqlcTask.StartedAt.Valid {
		s := sqlcTask.StartedAt.Time.Format("2006-01-02 15:04:05")
		task.StartedAt = &s
	}
	if sqlcTask.CompletedAt.Valid {
		s := sqlcTask.CompletedAt.Time.Format("2006-01-02 15:04:05")
		task.CompletedAt = &s
	}
	if sqlcTask.FailedAt.Valid {
		s := sqlcTask.FailedAt.Time.Format("2006-01-02 15:04:05")
		task.FailedAt = &s
	}
	if sqlcTask.WorkerID.Valid {
		task.WorkerID = &sqlcTask.WorkerID.String
	}
	if sqlcTask.ErrorMessage.Valid {
		task.ErrorMessage = &sqlcTask.ErrorMessage.String
	}
	if sqlcTask.CreatedAt.Valid {
		task.CreatedAt = sqlcTask.CreatedAt.Time.Format("2006-01-02 15:04:05")
	}
	if sqlcTask.UpdatedAt.Valid {
		task.UpdatedAt = sqlcTask.UpdatedAt.Time.Format("2006-01-02 15:04:05")
	}

	return task, nil
}
