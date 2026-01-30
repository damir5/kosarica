-- name: CountIngestionFiles :one
SELECT COUNT(*) FROM ingestion_files WHERE run_id = $1;

-- name: ListIngestionFiles :many
WITH file_stats AS (
    SELECT
        file_id,
        SUM(row_count) AS row_count,
        SUM(persisted_count) AS persisted_count,
        SUM(price_changes) AS price_changes,
        SUM(failed_rows) AS failed_rows,
        SUM(warning_rows) AS warning_rows,
        COUNT(DISTINCT store_id) AS store_count
    FROM ingestion_store_stats
    WHERE run_id = $1
    GROUP BY file_id
)
SELECT
    f.id, f.run_id, f.filename, f.file_type, f.file_size, f.file_hash, f.status,
    f.status_reason, f.status_severity, f.status_type, f.entry_count, f.processed_at,
    f.metadata, f.total_chunks, f.processed_chunks, f.chunk_size, f.created_at,
    fs.row_count, fs.persisted_count, fs.price_changes, fs.failed_rows, fs.warning_rows, fs.store_count
FROM ingestion_files f
LEFT JOIN file_stats fs ON fs.file_id = f.id
WHERE f.run_id = $1
ORDER BY f.created_at DESC
LIMIT $2 OFFSET $3;

-- name: GetIngestionFileByID :one
WITH file_stats AS (
    SELECT
        file_id,
        SUM(row_count) AS row_count,
        SUM(persisted_count) AS persisted_count,
        SUM(price_changes) AS price_changes,
        SUM(failed_rows) AS failed_rows,
        SUM(warning_rows) AS warning_rows,
        COUNT(DISTINCT store_id) AS store_count
    FROM ingestion_store_stats
    WHERE file_id = $1
    GROUP BY file_id
)
SELECT
    f.id, f.run_id, f.filename, f.file_type, f.file_size, f.file_hash, f.status,
    f.status_reason, f.status_severity, f.status_type, f.entry_count, f.processed_at,
    f.metadata, f.total_chunks, f.processed_chunks, f.chunk_size, f.created_at,
    fs.row_count, fs.persisted_count, fs.price_changes, fs.failed_rows, fs.warning_rows, fs.store_count
FROM ingestion_files f
LEFT JOIN file_stats fs ON fs.file_id = f.id
WHERE f.id = $1;

-- name: CreateIngestionFilePlaceholder :exec
INSERT INTO ingestion_files (
    id, run_id, filename, file_type, status, metadata, created_at
) VALUES (
    $1, $2, $3, $4, 'processing', $5, NOW()
);

-- name: CreateIngestionFile :exec
INSERT INTO ingestion_files (
    id, run_id, filename, file_type, file_size, file_hash,
    status, entry_count, total_chunks, chunk_size, metadata, created_at
) VALUES (
    $1, $2, $3, $4, $5, $6, 'processing', $7, 1, $7, $8, NOW()
);

-- name: UpdateIngestionFileFetchInfo :exec
UPDATE ingestion_files
SET file_size = $1,
    file_hash = $2
WHERE id = $3;

-- name: UpdateIngestionFileAfterParse :exec
UPDATE ingestion_files
SET entry_count = $1,
    total_chunks = $2,
    chunk_size = $3,
    metadata = $4
WHERE id = $5;

-- name: UpdateIngestionFileCompleted :exec
UPDATE ingestion_files
SET status = 'completed',
    processed_chunks = $1,
    processed_at = NOW()
WHERE id = $2;

-- name: UpdateIngestionFileCompletedWithStatus :exec
UPDATE ingestion_files
SET status = 'completed',
    processed_chunks = $1,
    processed_at = NOW(),
    status_reason = $2,
    status_severity = $3,
    status_type = $4
WHERE id = $5;

-- name: UpdateIngestionFileFailed :exec
UPDATE ingestion_files
SET status = 'failed',
    processed_at = NOW(),
    status_reason = $1,
    status_severity = $2,
    status_type = $3
WHERE id = $4;

-- name: ListPendingFilesForResume :many
SELECT id, filename, file_type, file_hash
FROM ingestion_files
WHERE run_id = $1
  AND status IN ('pending', 'processing')
ORDER BY created_at ASC;

-- name: ResetProcessingFilesToPending :exec
UPDATE ingestion_files
SET status = 'pending'
WHERE run_id = $1
  AND status = 'processing';
