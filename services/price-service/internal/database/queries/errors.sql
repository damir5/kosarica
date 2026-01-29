-- name: CountIngestionErrors :one
SELECT COUNT(*) FROM ingestion_errors WHERE run_id = $1;

-- name: ListIngestionErrors :many
SELECT id, run_id, file_id, chunk_id, entry_id, error_type, error_message,
       error_details, severity, created_at
FROM ingestion_errors
WHERE run_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CountIngestionErrorsByFileID :one
SELECT COUNT(*) FROM ingestion_errors WHERE file_id = $1;

-- name: ListIngestionErrorsByFileID :many
SELECT id, run_id, file_id, chunk_id, entry_id, error_type, error_message,
       error_details, severity, created_at
FROM ingestion_errors
WHERE file_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CreateIngestionError :exec
INSERT INTO ingestion_errors (
    run_id, file_id, chunk_id, entry_id, error_type, error_message,
    error_details, severity, created_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, NOW()
);

-- name: CountErrorsByDateRange :one
SELECT COUNT(*)
FROM ingestion_errors
WHERE created_at >= $1 AND created_at <= $2;
