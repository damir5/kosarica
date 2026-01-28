-- name: GetRetailerItemByExternalId :one
SELECT id FROM retailer_items
WHERE chain_slug = $1 AND external_id = $2
LIMIT 1;

-- name: UpdateRetailerItem :exec
UPDATE retailer_items
SET name = $1, description = $2, category = $3, subcategory = $4,
    brand = $5, unit = $6, unit_quantity = $7, image_url = $8, updated_at = NOW()
WHERE id = $9;

-- name: UpsertRetailerItem :exec
INSERT INTO retailer_items (
    id, chain_slug, external_id, name, description, category, subcategory,
    brand, unit, unit_quantity, image_url, archive_id, created_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
)
ON CONFLICT (chain_slug, external_id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    subcategory = EXCLUDED.subcategory,
    brand = EXCLUDED.brand,
    unit = EXCLUDED.unit,
    unit_quantity = EXCLUDED.unit_quantity,
    image_url = EXCLUDED.image_url,
    archive_id = EXCLUDED.archive_id,
    updated_at = NOW();

-- name: UpdateRetailerItemsArchiveId :exec
UPDATE retailer_items
SET archive_id = $1
WHERE id = ANY($2::text[]);

-- name: GetRetailerItemDetails :one
SELECT name, external_id, brand, unit, unit_quantity
FROM retailer_items
WHERE id = $1;

-- name: GetRetailerItemName :one
SELECT name FROM retailer_items WHERE id = $1;
