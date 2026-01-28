-- name: CreateIngestionRun :one
INSERT INTO ingestion_runs (
  id, chain_slug, source, status, started_at, created_at
) VALUES (
  $1, $2, $3, $4, $5, $6
) RETURNING *;

-- name: GetIngestionRun :one
SELECT * FROM ingestion_runs WHERE id = $1;

-- name: UpdateIngestionRunStatus :exec
UPDATE ingestion_runs
SET status = $2,
    completed_at = $3,
    processed_files = $4,
    processed_entries = $5
WHERE id = $1;

-- name: UpdateIngestionRunFailed :exec
UPDATE ingestion_runs
SET status = 'failed',
    completed_at = NOW(),
    metadata = $2
WHERE id = $1;

-- name: ListIngestionRuns :many
SELECT * FROM ingestion_runs
WHERE (sqlc.narg('chain_slug')::text IS NULL OR chain_slug = sqlc.narg('chain_slug'))
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- name: ListIngestionRunsByChain :many
SELECT * FROM ingestion_runs
WHERE chain_slug = $1 AND source = 'api'
ORDER BY started_at DESC
LIMIT $2;
