-- name: FindPriceTier :one
-- Find existing price tier by chain, item, price, and discount
SELECT id, chain_slug, retailer_item_id, price, discount_price,
       unit_price, anchor_price, first_seen_at, last_seen_at,
       store_count, created_at
FROM price_tiers
WHERE chain_slug = $1
  AND retailer_item_id = $2
  AND price = $3
  AND COALESCE(discount_price, -1) = COALESCE($4::int, -1)
LIMIT 1;

-- name: CreatePriceTier :one
-- Create a new price tier, returns the tier on success
INSERT INTO price_tiers (
    id, chain_slug, retailer_item_id, price, discount_price,
    unit_price, anchor_price, first_seen_at, last_seen_at,
    store_count, created_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), 0, NOW()
)
ON CONFLICT (chain_slug, retailer_item_id, price, COALESCE(discount_price, -1)) DO NOTHING
RETURNING id, chain_slug, retailer_item_id, price, discount_price,
          unit_price, anchor_price, first_seen_at, last_seen_at,
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
       unit_price, anchor_price, first_seen_at, last_seen_at,
       store_count, created_at
FROM price_tiers
WHERE id = $1;

-- name: ListPriceTiersByItem :many
SELECT id, chain_slug, retailer_item_id, price, discount_price,
       unit_price, anchor_price, first_seen_at, last_seen_at,
       store_count, created_at
FROM price_tiers
WHERE retailer_item_id = $1
ORDER BY price;

-- name: ListPriceTiersByChain :many
SELECT id, chain_slug, retailer_item_id, price, discount_price,
       unit_price, anchor_price, first_seen_at, last_seen_at,
       store_count, created_at
FROM price_tiers
WHERE chain_slug = $1
ORDER BY last_seen_at DESC
LIMIT $2 OFFSET $3;

-- name: UpsertStorePriceRef :exec
-- Insert or update a store->tier reference
INSERT INTO store_price_refs (
    store_id, retailer_item_id, price_tier_id, in_stock, last_seen_at
) VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (store_id, retailer_item_id) DO UPDATE SET
    price_tier_id = EXCLUDED.price_tier_id,
    in_stock = EXCLUDED.in_stock,
    last_seen_at = NOW();

-- name: GetStorePriceRef :one
-- Get the price tier reference for a specific store+item
SELECT store_id, retailer_item_id, price_tier_id, in_stock, last_seen_at
FROM store_price_refs
WHERE store_id = $1 AND retailer_item_id = $2;

-- name: GetStorePriceViaTier :one
-- Get price for a specific store+item via tier join
SELECT pt.price, pt.discount_price, pt.unit_price, pt.anchor_price
FROM store_price_refs spr
JOIN price_tiers pt ON pt.id = spr.price_tier_id
WHERE spr.store_id = $1 AND spr.retailer_item_id = $2;

-- name: ListStorePricesViaTiers :many
-- Get all prices for a store via tier join (for cache loading)
SELECT
    spr.retailer_item_id,
    pt.id AS price_tier_id,
    pt.price,
    pt.discount_price,
    pt.unit_price,
    pt.anchor_price,
    spr.in_stock
FROM store_price_refs spr
JOIN price_tiers pt ON pt.id = spr.price_tier_id
WHERE spr.store_id = $1
ORDER BY spr.retailer_item_id;

-- name: ListStoreRefsByChain :many
-- Get all store->tier references for a chain (for cache loading)
SELECT
    spr.store_id,
    spr.retailer_item_id,
    spr.price_tier_id,
    spr.in_stock
FROM store_price_refs spr
JOIN stores s ON s.id = spr.store_id
WHERE s.chain_slug = $1 AND s.status = 'active';

-- name: ListPriceTiersForCache :many
-- Get all price tiers for a chain (for cache loading)
SELECT id, chain_slug, retailer_item_id, price, discount_price,
       unit_price, anchor_price
FROM price_tiers
WHERE chain_slug = $1;

-- name: DeleteStorePriceRef :exec
DELETE FROM store_price_refs
WHERE store_id = $1 AND retailer_item_id = $2;

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
