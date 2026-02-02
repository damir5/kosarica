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

-- name: SetTaskProcessingAny :exec
UPDATE task_queue
SET status = 'processing', updated_at = NOW()
WHERE id = $1;

-- name: ClaimTasks :many
SELECT * FROM claim_tasks($1, $2, $3);

-- name: CompleteTaskFunc :one
SELECT complete_task($1, $2::jsonb);

-- name: FailTaskFunc :one
SELECT fail_task($1, $2, $3);

-- name: CleanupOldTasksFunc :one
SELECT cleanup_old_tasks($1);

-- Note: recover_orphaned_tasks() is a stored procedure that returns TABLE(recovered_count, failed_count)
-- sqlc cannot infer the return type, so it must be called directly via pool.QueryRow

-- name: ScheduleChildTask :one
INSERT INTO task_queue (task_type, payload, priority, parent_task_id, max_retries)
VALUES ($1, $2, $3, $4, 3)
RETURNING id;

-- name: TransitionToWaiting :exec
UPDATE task_queue
SET status = 'waiting_for_children',
    expected_children = $2,
    updated_at = NOW()
WHERE id = $1;

-- name: InsertChildTask :exec
INSERT INTO task_queue (task_type, payload, priority, parent_task_id, max_retries)
VALUES ($1, $2, $3, $4, $5);

-- name: RecoverRunIDFromDatabase :one
SELECT id FROM ingestion_runs
WHERE chain_slug = $1 AND status IN ('pending', 'running')
ORDER BY created_at DESC LIMIT 1;

-- name: CountFailedTasksByRunID :one
SELECT COUNT(*) FROM task_queue
WHERE status = 'failed' AND payload::text LIKE '%' || $1 || '%';

-- name: CountArchivesByRunID :one
SELECT COUNT(*) FROM archives WHERE run_id = $1;

-- name: CountStorePriceRefsByRunID :one
SELECT COUNT(*) FROM store_price_refs spr
WHERE EXISTS (
    SELECT 1 FROM stores s
    WHERE s.id = spr.store_id
    AND s.updated_at >= (SELECT MIN(created_at) FROM archives WHERE run_id = $1)
);

-- name: UpdatePriceTierStoreCounts :exec
UPDATE price_tiers pt
SET store_count = (
    SELECT COUNT(DISTINCT spr.store_id)
    FROM store_price_refs spr
    WHERE spr.price_tier_id = pt.id
)
WHERE pt.chain_slug = $1;
