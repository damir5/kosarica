-- name: CountStorePrices :one
SELECT COUNT(*)
FROM store_item_state sis
JOIN retailer_items ri ON sis.retailer_item_id = ri.id
JOIN stores s ON sis.store_id = s.id
WHERE s.id = $1 AND s.chain_slug = $2;

-- name: ListStorePricesWithDetails :many
SELECT
    ri.id as retailer_item_id,
    ri.name as item_name,
    ri.external_id as item_external_id,
    ri.brand,
    ri.unit,
    ri.unit_quantity,
    sis.current_price,
    sis.previous_price,
    sis.discount_price,
    TO_CHAR(sis.discount_start, 'YYYY-MM-DD HH24:MI:SS') as discount_start,
    TO_CHAR(sis.discount_end, 'YYYY-MM-DD HH24:MI:SS') as discount_end,
    sis.in_stock,
    sis.unit_price,
    sis.unit_price_base_quantity,
    sis.unit_price_base_unit,
    sis.lowest_price_30d,
    sis.anchor_price,
    sis.price_signature,
    TO_CHAR(sis.last_seen_at, 'YYYY-MM-DD HH24:MI:SS') as last_seen_at
FROM store_item_state sis
JOIN retailer_items ri ON sis.retailer_item_id = ri.id
JOIN stores s ON sis.store_id = s.id
WHERE s.id = $1 AND s.chain_slug = $2
ORDER BY ri.name
LIMIT $3 OFFSET $4;
