package taskqueue

import "encoding/json"

type TaskStatus string

const (
	StatusPending   TaskStatus = "pending"
	StatusClaimed  TaskStatus = "claimed"
	StatusProcessing TaskStatus = "processing"
	StatusCompleted TaskStatus = "completed"
	StatusFailed    TaskStatus = "failed"
	StatusCancelled TaskStatus = "cancelled"
)

type TaskType string

const (
	TaskTypeIngestion TaskType = "ingestion"
	TaskTypeRerun     TaskType = "rerun"
	TaskTypeCleanup    TaskType = "cleanup"
)

type Task struct {
	ID          string     `db:"id"`
	TaskType    string     `db:"task_type"`
	Payload     json.RawMessage `db:"payload"`
	Priority    int        `db:"priority"`
	Status      TaskStatus `db:"status"`
	ScheduledFor *string    `db:"scheduled_for"`
	StartedAt   *string    `db:"started_at"`
	CompletedAt *string    `db:"completed_at"`
	FailedAt    *string    `db:"failed_at"`
	WorkerID    *string    `db:"worker_id"`
	RetryCount  int        `db:"retry_count"`
	MaxRetries  int        `db:"max_retries"`
	ErrorMessage *string    `db:"error_message"`
	CreatedAt   string     `db:"created_at"`
	UpdatedAt   string     `db:"updated_at"`
}

type ClaimedTask struct {
	ID       string          `db:"id"`
	TaskType string          `db:"task_type"`
	Payload  json.RawMessage `db:"payload"`
}
