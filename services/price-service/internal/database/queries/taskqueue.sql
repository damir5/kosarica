-- name: ScheduleTask :one
INSERT INTO task_queue (task_type, payload, priority, scheduled_for, max_retries)
VALUES ($1, $2, $3, COALESCE($4, NOW()), $5)
RETURNING id;

-- name: GetTask :one
SELECT * FROM task_queue WHERE id = $1;

-- name: UpdateTaskStatus :exec
UPDATE task_queue
SET status = $2, updated_at = NOW()
WHERE id = $1;

-- name: SetTaskProcessing :exec
UPDATE task_queue
SET status = 'processing', updated_at = NOW()
WHERE id = $1 AND status = 'claimed';

-- name: CancelTask :exec
UPDATE task_queue
SET status = 'cancelled', updated_at = NOW()
WHERE id = $1 AND status IN ('pending', 'claimed');

-- name: ListPendingTasks :many
SELECT * FROM task_queue
WHERE status = 'pending'
  AND scheduled_for <= NOW()
ORDER BY priority DESC, scheduled_for ASC
LIMIT $1;

-- name: ListTasksByStatus :many
SELECT * FROM task_queue
WHERE status = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CountTasksByStatus :one
SELECT COUNT(*) FROM task_queue WHERE status = $1;
