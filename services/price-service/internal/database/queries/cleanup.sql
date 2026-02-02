-- Cleanup job queries

-- name: DeleteOldCandidates :execrows
DELETE FROM product_match_candidates
WHERE created_at < $1;

-- name: DeleteOldAuditLogs :execrows
DELETE FROM product_match_audit
WHERE created_at < $1;

-- name: MarkStaleQueueItemsSkipped :execrows
UPDATE product_match_queue
SET status = 'skipped',
    reviewed_at = now()
WHERE status = 'pending'
AND created_at < $1;

-- name: CountOldCandidates :one
SELECT COUNT(*) FROM product_match_candidates WHERE created_at < $1;

-- name: CountOldAuditLogs :one
SELECT COUNT(*) FROM product_match_audit WHERE created_at < $1;

-- name: CountStaleQueueItems :one
SELECT COUNT(*) FROM product_match_queue WHERE status = 'pending' AND created_at < $1;
