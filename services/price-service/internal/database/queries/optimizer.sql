-- Price cache loading queries

-- name: GetActiveChains :many
SELECT DISTINCT chain_slug
FROM stores
WHERE status = 'active';

-- name: GetActiveStoresByChain :many
SELECT s.id, s.latitude, s.longitude
FROM stores s
WHERE s.chain_slug = $1
  AND s.status = 'active';

-- name: GetPriceTiersByChain :many
SELECT id, retailer_item_id, price, discount_price
FROM price_tiers
WHERE chain_slug = $1;

-- name: GetStorePriceRefsByChain :many
SELECT spr.store_id, spr.retailer_item_id, spr.price_tier_id
FROM store_price_refs spr
JOIN stores s ON s.id = spr.store_id
WHERE s.chain_slug = $1 AND s.status = 'active';
