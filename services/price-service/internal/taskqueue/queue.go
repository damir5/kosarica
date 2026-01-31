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
	var resultJSON interface{}
	if result != nil {
		data, err := json.Marshal(result)
		if err != nil {
			return err
		}
		resultJSON = data
	}

	// Fixed: Use parameterized query to prevent SQL injection
	_, err := q.pool.Exec(ctx, `SELECT complete_task($1, $2)`, taskID, resultJSON)
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

// ScheduleChildTaskInput represents the input for scheduling a child task.
type ScheduleChildTaskInput struct {
	ParentTaskID string
	TaskType     string
	Payload      interface{} // Can be any payload type (DiscoverPayload, FetchParsePayload, etc.)
	Priority     int
}

// ScheduleChildTask schedules a task as a child of another task.
// The parent task should transition to waiting_for_children after spawning all children.
func (q *TaskQueue) ScheduleChildTask(ctx context.Context, input ScheduleChildTaskInput) ScheduleTaskResult {
	priority := 0
	if input.Priority > 0 {
		priority = input.Priority
	}

	payloadBytes, err := json.Marshal(input.Payload)
	if err != nil {
		return ScheduleTaskResult{Err: err}
	}

	var taskID string
	err = q.pool.QueryRow(ctx, `
		INSERT INTO task_queue (task_type, payload, priority, parent_task_id, max_retries)
		VALUES ($1, $2, $3, $4, 3)
		RETURNING id
	`, input.TaskType, payloadBytes, priority, input.ParentTaskID).Scan(&taskID)

	if err != nil {
		return ScheduleTaskResult{Err: err}
	}

	return ScheduleTaskResult{ID: taskID}
}

// TransitionToWaiting transitions a task to waiting_for_children status.
// Call this after spawning all child tasks, with expectedChildren set to the count.
func (q *TaskQueue) TransitionToWaiting(ctx context.Context, taskID string, expectedChildren int) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE task_queue
		SET status = 'waiting_for_children',
		    expected_children = $2,
		    updated_at = NOW()
		WHERE id = $1 AND status = 'processing'
	`, taskID, expectedChildren)
	return err
}

// ScheduleBatchChildTasks schedules multiple child tasks in a single transaction.
// Returns the parent task ID and the count of children scheduled.
func (q *TaskQueue) ScheduleBatchChildTasks(ctx context.Context, parentTaskID string, taskType string, payloads []interface{}, priority int) (int, error) {
	if len(payloads) == 0 {
		return 0, nil
	}

	tx, err := q.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	count := 0
	for _, payload := range payloads {
		payloadBytes, err := json.Marshal(payload)
		if err != nil {
			return 0, err
		}

		_, err = tx.Exec(ctx, `
			INSERT INTO task_queue (task_type, payload, priority, parent_task_id, max_retries)
			VALUES ($1, $2, $3, $4, 3)
		`, taskType, payloadBytes, priority, parentTaskID)
		if err != nil {
			return 0, err
		}
		count++
	}

	// Transition parent to waiting and set expected children count
	_, err = tx.Exec(ctx, `
		UPDATE task_queue
		SET status = 'waiting_for_children',
		    expected_children = $2,
		    updated_at = NOW()
		WHERE id = $1
	`, parentTaskID, count)
	if err != nil {
		return 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}

	return count, nil
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

	// Handle parent-child task fields
	if sqlcTask.ParentTaskID.Valid {
		task.ParentTaskID = &sqlcTask.ParentTaskID.String
	}
	if sqlcTask.ExpectedChildren.Valid {
		task.ExpectedChildren = int(sqlcTask.ExpectedChildren.Int32)
	}
	if sqlcTask.CompletedChildren.Valid {
		task.CompletedChildren = int(sqlcTask.CompletedChildren.Int32)
	}

	return task, nil
}
