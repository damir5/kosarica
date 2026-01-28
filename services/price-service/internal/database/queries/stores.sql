-- name: GetStoreByIdentifier :one
SELECT si.id
FROM stores si
JOIN store_identifiers sident ON sident.store_id = si.id
WHERE si.chain_slug = $1
  AND sident.type = 'filename_code'
  AND sident.value = $2
LIMIT 1;

-- name: CreateStore :exec
INSERT INTO stores (id, chain_slug, name, address, city, postal_code, is_virtual, status, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, false, 'pending', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- name: CreateStoreIdentifier :exec
INSERT INTO store_identifiers (id, store_id, type, value, created_at)
VALUES ($1, $2, 'filename_code', $3, NOW())
ON CONFLICT (id) DO NOTHING;
