-- name: CountIngestionFiles :one
SELECT COUNT(*) FROM ingestion_files WHERE run_id = $1;

-- name: ListIngestionFiles :many
SELECT id, run_id, filename, file_type, file_size, file_hash, status,
       entry_count, processed_at, metadata, total_chunks, processed_chunks,
       chunk_size, created_at
FROM ingestion_files
WHERE run_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CreateIngestionFile :exec
INSERT INTO ingestion_files (
    id, run_id, filename, file_type, file_size, file_hash,
    status, entry_count, total_chunks, chunk_size, metadata, created_at
) VALUES (
    $1, $2, $3, $4, $5, $6, 'processing', $7, 1, $7, $8, NOW()
);

-- name: UpdateIngestionFileCompleted :exec
UPDATE ingestion_files
SET status = 'completed',
    processed_chunks = $1,
    processed_at = NOW()
WHERE id = $2;
