-- name: CountIngestionChunksByFileID :one
SELECT COUNT(*)
FROM ingestion_chunks
WHERE file_id = $1
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'));

-- name: ListIngestionChunksByFileID :many
SELECT id, file_id, chunk_index, start_row, end_row, row_count, status,
       r2_key, persisted_count, error_count, processed_at, created_at
FROM ingestion_chunks
WHERE file_id = $1
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
ORDER BY chunk_index ASC
LIMIT $2 OFFSET $3;
