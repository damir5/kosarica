-- name: CountStorePrices :one
-- Count prices for a store using price_tiers system (uses latest target_date)
SELECT COUNT(*)
FROM store_price_refs spr
JOIN stores s ON spr.store_id = s.id
WHERE s.id = $1 AND s.chain_slug = $2
  AND spr.target_date = (SELECT MAX(target_date) FROM price_tiers WHERE chain_slug = $2);

-- name: ListStorePricesWithDetails :many
-- List prices for a store with item details using price_tiers system
SELECT
    ri.id as retailer_item_id,
    ri.name as item_name,
    ri.external_id as item_external_id,
    ri.brand,
    ri.unit,
    ri.unit_quantity,
    pt.price as current_price,
    NULL::int4 as previous_price,
    pt.discount_price,
    ''::text as discount_start,
    ''::text as discount_end,
    spr.in_stock,
    pt.unit_price,
    NULL::text as unit_price_base_quantity,
    NULL::text as unit_price_base_unit,
    NULL::int4 as lowest_price_30d,
    pt.anchor_price,
    NULL::text as price_signature,
    TO_CHAR(spr.last_seen_at, 'YYYY-MM-DD HH24:MI:SS') as last_seen_at
FROM store_price_refs spr
JOIN price_tiers pt ON pt.id = spr.price_tier_id
JOIN retailer_items ri ON spr.retailer_item_id = ri.id
JOIN stores s ON spr.store_id = s.id
WHERE s.id = $1 AND s.chain_slug = $2
  AND spr.target_date = (SELECT MAX(target_date) FROM price_tiers WHERE chain_slug = $2)
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
-- Uses price_tiers for aggregation
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
    COALESCE(AVG(pt.price), 0)::int as avg_price,
    COUNT(DISTINCT spr.store_id)::int as store_count
FROM retailer_items ri
LEFT JOIN store_price_refs spr ON ri.id = spr.retailer_item_id
LEFT JOIN price_tiers pt ON pt.id = spr.price_tier_id
WHERE ri.name ILIKE '%' || @search_query::text || '%'
  AND (@chain_filter::text = '' OR ri.chain_slug = @chain_filter::text)
GROUP BY ri.id, ri.chain_slug, ri.external_id, ri.name, ri.description,
         ri.brand, ri.category, ri.subcategory, ri.unit, ri.unit_quantity, ri.image_url
ORDER BY ri.name
LIMIT @result_limit::int;

-- name: GetRetailerItemDetailsBatch :many
-- Batch fetch retailer item details for multiple IDs
-- Used to avoid N+1 queries when enriching price data
SELECT
    ri.id,
    ri.name,
    ri.external_id,
    ri.brand,
    ri.unit,
    ri.unit_quantity
FROM retailer_items ri
WHERE ri.id = ANY(@item_ids::text[]);
