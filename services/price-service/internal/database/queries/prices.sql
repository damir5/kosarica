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

-- name: CountSearchItems :one
-- Counts items matching search query with optional chain filter
-- Pass empty string for chain_slug to search all chains
SELECT COUNT(DISTINCT ri.id)
FROM retailer_items ri
WHERE ri.name ILIKE '%' || @search_query::text || '%'
  AND (@chain_filter::text = '' OR ri.chain_slug = @chain_filter::text);

-- name: SearchItemsWithStats :many
-- Search items by name with aggregated stats, optional chain filter
-- Pass empty string for chain_slug to search all chains
SELECT DISTINCT
    ri.id,
    ri.chain_slug::text as chain_slug,
    ri.external_id,
    ri.name,
    ri.description,
    ri.brand,
    ri.category,
    ri.subcategory,
    ri.unit,
    ri.unit_quantity,
    ri.image_url,
    COALESCE(AVG(sis.current_price), 0)::int as avg_price,
    COUNT(DISTINCT sis.store_id)::int as store_count
FROM retailer_items ri
LEFT JOIN store_item_state sis ON ri.id = sis.retailer_item_id
WHERE ri.name ILIKE '%' || @search_query::text || '%'
  AND (@chain_filter::text = '' OR ri.chain_slug = @chain_filter::text)
GROUP BY ri.id, ri.chain_slug, ri.external_id, ri.name, ri.description,
         ri.brand, ri.category, ri.subcategory, ri.unit, ri.unit_quantity, ri.image_url
ORDER BY ri.name
LIMIT @result_limit::int;
