-- name: GetErrorSummaryByChain :many
SELECT
    chain_slug,
    COUNT(*) as total_rows,
    COUNT(*) as failed_rows,
    MIN(failed_at) as first_failed,
    MAX(failed_at) as last_failed
FROM retailer_items_failed
WHERE failed_at >= $1
GROUP BY chain_slug;
