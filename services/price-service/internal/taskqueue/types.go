package taskqueue

import "github.com/kosarica/price-service/internal/jsonb"

type TaskStatus string

const (
	StatusPending            TaskStatus = "pending"
	StatusClaimed            TaskStatus = "claimed"
	StatusProcessing         TaskStatus = "processing"
	StatusCompleted          TaskStatus = "completed"
	StatusFailed             TaskStatus = "failed"
	StatusCancelled          TaskStatus = "cancelled"
	StatusWaitingForChildren TaskStatus = "waiting_for_children"
)

type TaskType string

const (
	TaskTypeIngestion TaskType = "ingestion"
	TaskTypeRerun     TaskType = "rerun"
	TaskTypeCleanup   TaskType = "cleanup"

	// New ingestion pipeline task types (parent-child architecture)
	TaskTypeIngestionDiscover   TaskType = "ingestion_discover"
	TaskTypeIngestionFetchParse TaskType = "ingestion_fetch_parse"
	TaskTypeIngestionCluster    TaskType = "ingestion_cluster"
	TaskTypeIngestionFinalize   TaskType = "ingestion_finalize"
)

type Task struct {
	ID           string                 `db:"id"`
	TaskType     string                 `db:"task_type"`
	Payload      jsonb.TaskQueuePayload `db:"payload"`
	Priority     int                    `db:"priority"`
	Status       TaskStatus             `db:"status"`
	ScheduledFor *string                `db:"scheduled_for"`
	StartedAt    *string                `db:"started_at"`
	CompletedAt  *string                `db:"completed_at"`
	FailedAt     *string                `db:"failed_at"`
	WorkerID     *string                `db:"worker_id"`
	RetryCount   int                    `db:"retry_count"`
	MaxRetries   int                    `db:"max_retries"`
	ErrorMessage *string                `db:"error_message"`
	// Parent-child task support
	ParentTaskID      *string `db:"parent_task_id"`
	ExpectedChildren  int     `db:"expected_children"`
	CompletedChildren int     `db:"completed_children"`
	CreatedAt         string  `db:"created_at"`
	UpdatedAt         string  `db:"updated_at"`
}

type ClaimedTask struct {
	ID       string                 `db:"id"`
	TaskType string                 `db:"task_type"`
	Payload  jsonb.TaskQueuePayload `db:"payload"`
}
