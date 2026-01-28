-- name: CountFailedRows :one
SELECT COUNT(*) FROM retailer_items_failed
WHERE chain_slug = $1;

-- name: ListFailedRows :many
SELECT
    id,
    chain_slug,
    run_id,
    file_id,
    store_identifier,
    row_number,
    raw_data,
    validation_errors,
    failed_at,
    reviewed,
    reviewed_by,
    review_notes,
    reprocessable,
    reprocessed_at
FROM retailer_items_failed
WHERE chain_slug = $1
ORDER BY failed_at DESC
LIMIT $2 OFFSET $3;

-- name: UpdateFailedRowNotes :one
UPDATE retailer_items_failed
SET
    review_notes = $1,
    reviewed = $2,
    reviewed_by = 'admin'
WHERE id = $3
RETURNING id;

-- name: GetFailedRowsForReprocessing :many
SELECT
    id,
    chain_slug,
    run_id,
    file_id,
    store_identifier,
    row_number,
    raw_data,
    validation_errors
FROM retailer_items_failed
WHERE id = ANY($1::text[]) AND reprocessable = true;

-- name: MarkRowAsReprocessed :exec
UPDATE retailer_items_failed
SET
    reprocessed_at = NOW(),
    reprocessable = false
WHERE id = $1;

-- name: CreateFailedRow :exec
INSERT INTO retailer_items_failed (
    id, chain_slug, run_id, file_id, store_identifier, row_number,
    raw_data, validation_errors, failed_at, reprocessable
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), true);
