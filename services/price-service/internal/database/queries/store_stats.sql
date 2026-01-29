-- name: CreateIngestionStoreStats :exec
INSERT INTO ingestion_store_stats (
    run_id, file_id, store_id, store_identifier,
    row_count, persisted_count, price_changes, failed_rows, warning_rows, created_at
) VALUES (
    $1, $2, $3, $4,
    $5, $6, $7, $8, $9, NOW()
);

-- name: CountIngestionStoreStatsByRunID :one
SELECT COUNT(*)
FROM (
    SELECT 1
    FROM ingestion_store_stats
    WHERE run_id = $1
    GROUP BY store_id, store_identifier
) AS store_counts;

-- name: ListIngestionStoreStatsByRunID :many
SELECT
    s.id AS store_id,
    s.name AS store_name,
    s.city AS store_city,
    iss.store_identifier,
    SUM(iss.row_count) AS row_count,
    SUM(iss.persisted_count) AS persisted_count,
    SUM(iss.price_changes) AS price_changes,
    SUM(iss.failed_rows) AS failed_rows,
    SUM(iss.warning_rows) AS warning_rows,
    COUNT(DISTINCT iss.file_id) AS file_count
FROM ingestion_store_stats iss
JOIN stores s ON s.id = iss.store_id
WHERE iss.run_id = $1
GROUP BY s.id, s.name, s.city, iss.store_identifier
ORDER BY persisted_count DESC
LIMIT $2 OFFSET $3;

-- name: CountIngestionStoreStatsByFileID :one
SELECT COUNT(*)
FROM ingestion_store_stats
WHERE file_id = $1;

-- name: ListIngestionStoreStatsByFileID :many
SELECT
    iss.id,
    iss.run_id,
    iss.file_id,
    iss.store_id,
    s.name AS store_name,
    s.city AS store_city,
    iss.store_identifier,
    iss.row_count,
    iss.persisted_count,
    iss.price_changes,
    iss.failed_rows,
    iss.warning_rows,
    iss.created_at
FROM ingestion_store_stats iss
JOIN stores s ON s.id = iss.store_id
WHERE iss.file_id = $1
ORDER BY iss.persisted_count DESC
LIMIT $2 OFFSET $3;

-- name: GetIngestionFileStatsSummary :one
SELECT
    COALESCE(SUM(row_count), 0)::bigint AS row_count,
    COALESCE(SUM(persisted_count), 0)::bigint AS persisted_count,
    COALESCE(SUM(price_changes), 0)::bigint AS price_changes,
    COALESCE(SUM(failed_rows), 0)::bigint AS failed_rows,
    COALESCE(SUM(warning_rows), 0)::bigint AS warning_rows,
    COUNT(DISTINCT store_id) AS store_count
FROM ingestion_store_stats
WHERE file_id = $1;

-- name: GetIngestionRunStatsSummary :one
SELECT
    COALESCE(SUM(row_count), 0)::bigint AS row_count,
    COALESCE(SUM(persisted_count), 0)::bigint AS persisted_count,
    COALESCE(SUM(price_changes), 0)::bigint AS price_changes,
    COALESCE(SUM(failed_rows), 0)::bigint AS failed_rows,
    COALESCE(SUM(warning_rows), 0)::bigint AS warning_rows,
    COUNT(DISTINCT store_id) AS store_count,
    COUNT(DISTINCT file_id) AS file_count
FROM ingestion_store_stats
WHERE run_id = $1;
