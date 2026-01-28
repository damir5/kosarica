-- name: UpsertArchive :exec
INSERT INTO archives (
    id, chain_slug, source_url, filename, original_format,
    archive_path, archive_type, content_type, file_size,
    compressed_size, checksum, downloaded_at, metadata,
    created_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
)
ON CONFLICT (id) DO UPDATE SET
    source_url = EXCLUDED.source_url,
    filename = EXCLUDED.filename,
    archive_path = EXCLUDED.archive_path,
    original_format = EXCLUDED.original_format,
    archive_type = EXCLUDED.archive_type,
    content_type = EXCLUDED.content_type,
    file_size = EXCLUDED.file_size,
    compressed_size = EXCLUDED.compressed_size,
    checksum = EXCLUDED.checksum,
    downloaded_at = EXCLUDED.downloaded_at,
    metadata = EXCLUDED.metadata,
    updated_at = EXCLUDED.updated_at;

-- name: GetArchiveByChecksum :one
SELECT id, chain_slug, source_url, filename, original_format,
    archive_path, archive_type, content_type, file_size,
    compressed_size, checksum, downloaded_at, metadata,
    created_at, updated_at
FROM archives
WHERE checksum = $1
LIMIT 1;

-- name: GetArchiveById :one
SELECT id, chain_slug, source_url, filename, original_format,
    archive_path, archive_type, content_type, file_size,
    compressed_size, checksum, downloaded_at, metadata,
    created_at, updated_at
FROM archives
WHERE id = $1;

-- name: ListArchivesByChain :many
SELECT id, chain_slug, source_url, filename, original_format,
    archive_path, archive_type, content_type, file_size,
    compressed_size, checksum, downloaded_at, metadata,
    created_at, updated_at
FROM archives
WHERE chain_slug = $1
ORDER BY downloaded_at DESC
LIMIT $2 OFFSET $3;

-- name: LinkArchiveToRun :exec
UPDATE ingestion_runs
SET archive_id = $1,
    source_url = (
        SELECT source_url FROM archives WHERE archives.id = $1
    )
WHERE ingestion_runs.id = $2;
