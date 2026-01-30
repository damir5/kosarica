-- name: UpdateRunStartedAt :exec
UPDATE ingestion_runs
SET started_at = NOW()
WHERE id = $1;

-- name: UpdateRunTotalFiles :exec
UPDATE ingestion_runs
SET total_files = $1
WHERE id = $2;

-- name: UpdateRunCompleted :exec
UPDATE ingestion_runs
SET status = 'completed',
    completed_at = $1,
    processed_files = COALESCE($2, processed_files),
    processed_entries = COALESCE($3, processed_entries)
WHERE id = $4;

-- name: UpdateRunInterrupted :exec
UPDATE ingestion_runs
SET status = 'interrupted',
    completed_at = $1,
    metadata = jsonb_set(
        COALESCE(metadata::jsonb, '{}'::jsonb),
        '{interrupted_reason}',
        to_jsonb('Service restarted during processing'::text)
    )::text
WHERE id = $2;

-- name: UpdateRunFailed :exec
UPDATE ingestion_runs
SET status = 'failed',
    completed_at = NOW(),
    metadata = jsonb_set(
        COALESCE(metadata::jsonb, '{}'::jsonb),
        '{error}',
        to_jsonb($1::text)
    )::text
WHERE id = $2;

-- name: UpdateRunStatusSummary :exec
UPDATE ingestion_runs
SET status_reason = CASE
        WHEN status_severity IS NULL THEN $1
        WHEN CASE status_severity
                WHEN 'critical' THEN 3
                WHEN 'error' THEN 2
                WHEN 'warning' THEN 1
                ELSE 0
             END
             >= CASE $2
                WHEN 'critical' THEN 3
                WHEN 'error' THEN 2
                WHEN 'warning' THEN 1
                ELSE 0
             END THEN status_reason
        ELSE $1
    END,
    status_severity = CASE
        WHEN status_severity IS NULL THEN $2
        WHEN CASE status_severity
                WHEN 'critical' THEN 3
                WHEN 'error' THEN 2
                WHEN 'warning' THEN 1
                ELSE 0
             END
             >= CASE $2
                WHEN 'critical' THEN 3
                WHEN 'error' THEN 2
                WHEN 'warning' THEN 1
                ELSE 0
             END THEN status_severity
        ELSE $2
    END,
    status_type = CASE
        WHEN status_severity IS NULL THEN $3
        WHEN CASE status_severity
                WHEN 'critical' THEN 3
                WHEN 'error' THEN 2
                WHEN 'warning' THEN 1
                ELSE 0
             END
             >= CASE $2
                WHEN 'critical' THEN 3
                WHEN 'error' THEN 2
                WHEN 'warning' THEN 1
                ELSE 0
             END THEN status_type
        ELSE $3
    END
WHERE id = $4;

-- name: IncrementRunProcessedFiles :exec
UPDATE ingestion_runs
SET processed_files = COALESCE(processed_files, 0) + 1
WHERE id = $1;

-- name: IncrementRunProcessedEntries :exec
UPDATE ingestion_runs
SET processed_entries = COALESCE(processed_entries, 0) + $1
WHERE id = $2;

-- name: IncrementRunErrorCount :exec
UPDATE ingestion_runs
SET error_count = COALESCE(error_count, 0) + $1
WHERE id = $2;

-- name: GetRunProgressInfo :one
SELECT status, COALESCE(total_files, 0) as total_files, COALESCE(processed_files, 0) as processed_files
FROM ingestion_runs
WHERE id = $1;

-- name: UpdateRunResumed :exec
UPDATE ingestion_runs
SET status = 'running',
    started_at = $1
WHERE id = $2;
