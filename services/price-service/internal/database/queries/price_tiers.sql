-- name: FindPriceTier :one
-- Find existing price tier by target_date, chain, item, price, and discount
SELECT id, chain_slug, retailer_item_id, price, discount_price,
       unit_price, anchor_price, target_date, first_seen_at, last_seen_at,
       store_count, created_at
FROM price_tiers
WHERE target_date = $1
  AND chain_slug = $2
  AND retailer_item_id = $3
  AND price = $4
  AND COALESCE(discount_price, -1) = COALESCE($5::int, -1)
LIMIT 1;

-- name: CreatePriceTier :one
-- Create a new price tier, returns the tier on success
INSERT INTO price_tiers (
    id, chain_slug, retailer_item_id, price, discount_price,
    unit_price, anchor_price, target_date, first_seen_at, last_seen_at,
    store_count, created_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), 0, NOW()
)
ON CONFLICT (target_date, chain_slug, retailer_item_id, price, COALESCE(discount_price, -1)) DO NOTHING
RETURNING id, chain_slug, retailer_item_id, price, discount_price,
          unit_price, anchor_price, target_date, first_seen_at, last_seen_at,
          store_count, created_at;

-- name: UpdatePriceTierLastSeen :exec
-- Update last_seen_at timestamp for a price tier
UPDATE price_tiers
SET last_seen_at = NOW()
WHERE id = $1;

-- name: UpdatePriceTierStoreCount :exec
-- Recalculate store_count from store_price_refs
UPDATE price_tiers
SET store_count = (
    SELECT COUNT(DISTINCT store_id)
    FROM store_price_refs
    WHERE price_tier_id = $1
)
WHERE id = $1;

-- name: IncrementPriceTierStoreCount :exec
UPDATE price_tiers
SET store_count = store_count + 1,
    last_seen_at = NOW()
WHERE id = $1;

-- name: DecrementPriceTierStoreCount :exec
UPDATE price_tiers
SET store_count = store_count - 1
WHERE id = $1;

-- name: GetPriceTierById :one
SELECT id, chain_slug, retailer_item_id, price, discount_price,
       unit_price, anchor_price, target_date, first_seen_at, last_seen_at,
       store_count, created_at
FROM price_tiers
WHERE id = $1;

-- name: ListPriceTiersByItem :many
SELECT id, chain_slug, retailer_item_id, price, discount_price,
       unit_price, anchor_price, target_date, first_seen_at, last_seen_at,
       store_count, created_at
FROM price_tiers
WHERE retailer_item_id = $1
ORDER BY target_date DESC, price;

-- name: ListPriceTiersByChain :many
SELECT id, chain_slug, retailer_item_id, price, discount_price,
       unit_price, anchor_price, target_date, first_seen_at, last_seen_at,
       store_count, created_at
FROM price_tiers
WHERE chain_slug = $1
ORDER BY target_date DESC, last_seen_at DESC
LIMIT $2 OFFSET $3;

-- name: UpsertStorePriceRef :exec
-- Insert or update a store->tier reference (scoped by date)
INSERT INTO store_price_refs (
    store_id, retailer_item_id, price_tier_id, in_stock, target_date, last_seen_at
) VALUES ($1, $2, $3, $4, $5, NOW())
ON CONFLICT (target_date, store_id, retailer_item_id) DO UPDATE SET
    price_tier_id = EXCLUDED.price_tier_id,
    in_stock = EXCLUDED.in_stock,
    last_seen_at = NOW();

-- name: GetStorePriceRef :one
-- Get the price tier reference for a specific store+item at a specific date
SELECT store_id, retailer_item_id, price_tier_id, in_stock, target_date, last_seen_at
FROM store_price_refs
WHERE target_date = $1 AND store_id = $2 AND retailer_item_id = $3;

-- name: GetStorePriceViaTier :one
-- Get price for a specific store+item via tier join at a specific date
SELECT pt.price, pt.discount_price, pt.unit_price, pt.anchor_price, spr.target_date
FROM store_price_refs spr
JOIN price_tiers pt ON pt.id = spr.price_tier_id
WHERE spr.target_date = $1 AND spr.store_id = $2 AND spr.retailer_item_id = $3;

-- name: ListStorePricesViaTiers :many
-- Get all prices for a store via tier join at a specific date
SELECT
    spr.retailer_item_id,
    pt.id AS price_tier_id,
    pt.price,
    pt.discount_price,
    pt.unit_price,
    pt.anchor_price,
    spr.in_stock,
    spr.target_date
FROM store_price_refs spr
JOIN price_tiers pt ON pt.id = spr.price_tier_id
WHERE spr.target_date = $1 AND spr.store_id = $2
ORDER BY spr.retailer_item_id;

-- name: ListStoreRefsByChain :many
-- Get all store->tier references for a chain at a specific date
SELECT
    spr.store_id,
    spr.retailer_item_id,
    spr.price_tier_id,
    spr.in_stock,
    spr.target_date
FROM store_price_refs spr
JOIN stores s ON s.id = spr.store_id
WHERE s.chain_slug = $1 AND spr.target_date = $2 AND s.status = 'active';

-- name: ListPriceTiersForCache :many
-- Get all price tiers for a chain at a specific date (for cache loading)
SELECT id, chain_slug, retailer_item_id, price, discount_price,
       unit_price, anchor_price, target_date
FROM price_tiers
WHERE chain_slug = $1 AND target_date = $2;

-- name: DeleteStorePriceRef :exec
DELETE FROM store_price_refs
WHERE target_date = $1 AND store_id = $2 AND retailer_item_id = $3;

-- name: DeleteStoreAllPriceRefs :exec
-- Remove all price refs for a store
DELETE FROM store_price_refs
WHERE store_id = $1;

-- name: DeleteOrphanPriceTiers :execrows
-- Clean up price tiers with no store references
DELETE FROM price_tiers
WHERE store_count = 0
  AND last_seen_at < $1;

-- name: CountPriceTiersByChain :one
SELECT COUNT(*) FROM price_tiers WHERE chain_slug = $1;

-- name: CountStorePriceRefsByChain :one
SELECT COUNT(*)
FROM store_price_refs spr
JOIN stores s ON s.id = spr.store_id
WHERE s.chain_slug = $1;

-- ============================================================================
-- Date-Scoped Operations for Ingestion
-- ============================================================================

-- name: GetMaxTargetDateForChain :one
-- Get the latest target_date for a chain (for production queries)
SELECT MAX(target_date)::date AS max_date
FROM price_tiers
WHERE chain_slug = $1;

-- name: DeleteStorePriceRefsByChainAndDate :execrows
-- Delete all store_price_refs for stores in a chain at a specific date
-- Used for same-day overwrite during ingestion
DELETE FROM store_price_refs
WHERE target_date = $1
  AND store_id IN (
    SELECT id FROM stores WHERE chain_slug = $2
  );

-- name: DeletePriceTiersByChainAndDate :execrows
-- Delete all price_tiers for a chain at a specific date
-- Used for same-day overwrite during ingestion
DELETE FROM price_tiers
WHERE chain_slug = $1 AND target_date = $2;

-- name: GetLatestStorePriceViaTier :one
-- Get the latest price for a store+item (uses MAX(target_date))
SELECT pt.price, pt.discount_price, pt.unit_price, pt.anchor_price, spr.target_date
FROM store_price_refs spr
JOIN price_tiers pt ON pt.id = spr.price_tier_id
WHERE spr.store_id = $1
  AND spr.retailer_item_id = $2
  AND spr.target_date = (
    SELECT MAX(target_date) FROM store_price_refs
    WHERE store_id = $1 AND retailer_item_id = $2
  );

-- name: ListLatestStorePricesViaTiers :many
-- Get all latest prices for a store (uses MAX(target_date) per chain)
SELECT
    spr.retailer_item_id,
    pt.id AS price_tier_id,
    pt.price,
    pt.discount_price,
    pt.unit_price,
    pt.anchor_price,
    spr.in_stock,
    spr.target_date
FROM store_price_refs spr
JOIN price_tiers pt ON pt.id = spr.price_tier_id
JOIN stores s ON s.id = spr.store_id
WHERE spr.store_id = $1
  AND spr.target_date = (
    SELECT MAX(target_date) FROM price_tiers WHERE chain_slug = s.chain_slug
  )
ORDER BY spr.retailer_item_id;

-- name: ListLatestPriceTiersByChain :many
-- Get all price tiers for a chain at the latest date
SELECT pt.id, pt.chain_slug, pt.retailer_item_id, pt.price, pt.discount_price,
       pt.unit_price, pt.anchor_price, pt.target_date, pt.first_seen_at, pt.last_seen_at,
       pt.store_count, pt.created_at
FROM price_tiers pt
WHERE pt.chain_slug = $1
  AND pt.target_date = (SELECT MAX(pt2.target_date) FROM price_tiers pt2 WHERE pt2.chain_slug = $1)
ORDER BY pt.retailer_item_id;
