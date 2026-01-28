-- name: GetIngestionRunById :one
SELECT id, chain_slug, source, status, started_at, completed_at,
       total_files, processed_files, total_entries, processed_entries,
       error_count, metadata, created_at
FROM ingestion_runs
WHERE id = $1;

-- name: GetRunChainSlug :one
SELECT chain_slug FROM ingestion_runs WHERE id = $1;

-- name: CreateRerunRun :exec
INSERT INTO ingestion_runs (
    id, chain_slug, source, status, started_at, created_at,
    parent_run_id, rerun_type, rerun_target_id
) VALUES (
    $1, $2, 'rerun', 'pending', NOW(), NOW(),
    $3, $4, $5
);

-- name: CreateReprocessingRun :exec
INSERT INTO ingestion_runs (id, chain_slug, source, status, started_at, created_at)
VALUES ($1, $2, 'reprocess', 'running', NOW(), NOW());

-- name: CheckRunExists :one
SELECT EXISTS(SELECT 1 FROM ingestion_runs WHERE id = $1);

-- name: DeleteIngestionErrors :exec
DELETE FROM ingestion_errors WHERE run_id = $1;

-- name: DeleteIngestionFiles :exec
DELETE FROM ingestion_files WHERE run_id = $1;

-- name: DeleteIngestionRun :exec
DELETE FROM ingestion_runs WHERE id = $1;

-- name: GetRunStats :one
SELECT
    COUNT(*) as total_runs,
    COUNT(*) FILTER (WHERE status = 'completed') as completed,
    COUNT(*) FILTER (WHERE status = 'failed') as failed,
    COUNT(*) FILTER (WHERE status = 'running') as running,
    COUNT(*) FILTER (WHERE status = 'pending') as pending,
    COALESCE(SUM(total_files), 0) as total_files
FROM ingestion_runs
WHERE created_at >= $1 AND created_at <= $2;

-- name: CountIngestionRunsFiltered :one
-- Count ingestion runs with optional chain and status filters
-- Pass empty string for chain_slug or status to not filter by that field
SELECT COUNT(*)
FROM ingestion_runs
WHERE (@chain_filter::text = '' OR chain_slug = @chain_filter::text)
  AND (@status_filter::text = '' OR status = @status_filter::text);

-- name: ListIngestionRunsFiltered :many
-- List ingestion runs with optional chain and status filters, paginated
-- Pass empty string for chain_slug or status to not filter by that field
SELECT id, chain_slug, source, status, started_at, completed_at,
       total_files, processed_files, total_entries, processed_entries,
       error_count, metadata, created_at
FROM ingestion_runs
WHERE (@chain_filter::text = '' OR chain_slug = @chain_filter::text)
  AND (@status_filter::text = '' OR status = @status_filter::text)
ORDER BY created_at DESC
LIMIT @result_limit::int OFFSET @result_offset::int;
