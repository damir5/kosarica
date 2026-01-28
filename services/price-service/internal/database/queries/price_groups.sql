-- name: FindPriceGroupByHash :one
SELECT id, chain_slug, price_hash, hash_version, store_count, item_count,
       first_seen_at, last_seen_at, created_at, updated_at
FROM price_groups
WHERE chain_slug = $1 AND price_hash = $2 AND hash_version = 1
LIMIT 1;

-- name: CreatePriceGroup :one
INSERT INTO price_groups (
    id, chain_slug, price_hash, hash_version, store_count, item_count,
    first_seen_at, last_seen_at, created_at, updated_at
) VALUES (
    $1, $2, $3, 1, 0, 0, $4, $4, $4, $4
)
ON CONFLICT (chain_slug, price_hash, hash_version) DO NOTHING
RETURNING id, chain_slug, price_hash, hash_version, store_count, item_count,
          first_seen_at, last_seen_at, created_at, updated_at;

-- name: UpsertGroupPrice :exec
INSERT INTO group_prices (
    price_group_id, retailer_item_id, price, discount_price,
    unit_price, anchor_price, created_at
) VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (price_group_id, retailer_item_id) DO UPDATE SET
    price = EXCLUDED.price,
    discount_price = EXCLUDED.discount_price,
    unit_price = EXCLUDED.unit_price,
    anchor_price = EXCLUDED.anchor_price;

-- name: UpdatePriceGroupItemCount :exec
UPDATE price_groups
SET item_count = (
    SELECT COUNT(*) FROM group_prices WHERE price_group_id = $1
),
updated_at = NOW()
WHERE id = $1;

-- name: GetCurrentStoreGroupId :one
SELECT price_group_id
FROM store_group_history
WHERE store_id = $1 AND valid_to IS NULL
LIMIT 1;

-- name: CloseStoreGroupMembership :exec
UPDATE store_group_history
SET valid_to = $1
WHERE store_id = $2 AND valid_to IS NULL;

-- name: CreateStoreGroupHistory :exec
INSERT INTO store_group_history (id, store_id, price_group_id, valid_from, valid_to, created_at)
VALUES ($1, $2, $3, $4, NULL, NOW());

-- name: DecrementPriceGroupStoreCount :exec
UPDATE price_groups
SET store_count = store_count - 1,
    updated_at = NOW()
WHERE id = $1;

-- name: IncrementPriceGroupStoreCount :exec
UPDATE price_groups
SET store_count = store_count + 1,
    updated_at = NOW()
WHERE id = $1;

-- name: GetStorePriceException :one
SELECT price, discount_price
FROM store_price_exceptions
WHERE store_id = $1 AND retailer_item_id = $2 AND expires_at > NOW()
LIMIT 1;

-- name: GetStorePriceFromGroup :one
SELECT gp.price, gp.discount_price
FROM group_prices gp
JOIN store_group_history sgh ON sgh.price_group_id = gp.price_group_id
WHERE sgh.store_id = $1
  AND gp.retailer_item_id = $2
  AND sgh.valid_to IS NULL
LIMIT 1;

-- name: GetHistoricalStorePrice :one
SELECT gp.price, gp.discount_price
FROM group_prices gp
JOIN store_group_history sgh ON sgh.price_group_id = gp.price_group_id
WHERE sgh.store_id = $1
  AND gp.retailer_item_id = $2
  AND sgh.valid_from <= $3
  AND (sgh.valid_to IS NULL OR sgh.valid_to > $3)
ORDER BY sgh.valid_from DESC
LIMIT 1;

-- name: UpdatePriceGroupLastSeen :exec
UPDATE price_groups
SET last_seen_at = NOW(), updated_at = NOW()
WHERE id = $1;

-- name: DeleteExpiredPriceExceptions :execrows
DELETE FROM store_price_exceptions
WHERE expires_at <= NOW();

-- name: GetPriceGroupById :one
SELECT id, chain_slug, price_hash, hash_version, store_count, item_count,
       first_seen_at, last_seen_at, created_at, updated_at
FROM price_groups
WHERE id = $1;

-- name: ListGroupPrices :many
SELECT price_group_id, retailer_item_id, price, discount_price,
       unit_price, anchor_price, created_at
FROM group_prices
WHERE price_group_id = $1
ORDER BY retailer_item_id;

-- name: ListStorePricesViaGroup :many
SELECT
    gp.retailer_item_id,
    gp.price,
    gp.discount_price,
    gp.unit_price,
    gp.anchor_price,
    COALESCE(spe.store_id, '') != '' AS is_exception
FROM group_prices gp
JOIN store_group_history sgh ON sgh.price_group_id = gp.price_group_id
LEFT JOIN store_price_exceptions spe ON spe.store_id = sgh.store_id
    AND spe.retailer_item_id = gp.retailer_item_id
    AND spe.expires_at > NOW()
WHERE sgh.store_id = $1 AND sgh.valid_to IS NULL
ORDER BY gp.retailer_item_id;

-- name: ListPriceGroupsByChain :many
SELECT id, chain_slug, price_hash, hash_version, store_count, item_count,
       first_seen_at, last_seen_at, created_at, updated_at
FROM price_groups
WHERE chain_slug = $1
ORDER BY last_seen_at DESC
LIMIT $2 OFFSET $3;

-- name: CountPriceGroupsByChain :one
SELECT COUNT(*) FROM price_groups WHERE chain_slug = $1;

-- name: DeleteOrphanGroupPrices :exec
DELETE FROM group_prices
WHERE price_group_id IN (
    SELECT pg.id
    FROM price_groups pg
    WHERE pg.store_count = 0
      AND pg.last_seen_at < $1
      AND NOT EXISTS (
          SELECT 1
          FROM store_group_history sgh
          WHERE sgh.price_group_id = pg.id
            AND sgh.valid_to IS NULL
      )
);

-- name: DeleteOrphanPriceGroups :execrows
DELETE FROM price_groups
WHERE store_count = 0
  AND last_seen_at < $1
  AND NOT EXISTS (
      SELECT 1
      FROM store_group_history sgh
      WHERE sgh.price_group_id = price_groups.id
        AND sgh.valid_to IS NULL
  );
