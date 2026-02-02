-- name: CountProductMatchQueueByStatus :one
SELECT COUNT(*) FROM product_match_queue WHERE status = $1;

-- name: CountProductMatchCandidates :one
SELECT COUNT(*) FROM product_match_candidates;

-- name: CountProductLinks :one
SELECT COUNT(*) FROM product_links;

-- name: GetMatchingStatus :one
SELECT
    (SELECT COUNT(*) FROM product_match_queue WHERE status = 'pending') as pending_count,
    (SELECT COUNT(*) FROM product_match_queue WHERE status = 'approved') as approved_count,
    (SELECT COUNT(*) FROM product_match_queue WHERE status = 'rejected') as rejected_count,
    (SELECT COUNT(*) FROM product_match_candidates) as candidate_count,
    (SELECT COUNT(*) FROM product_links) as total_links;

-- Barcode matching queries

-- name: GetUnlinkedItemsWithBarcodes :many
SELECT DISTINCT
    rib.barcode,
    ri.id,
    ri.name,
    ri.brand,
    ri.unit,
    ri.unit_quantity,
    ri.category,
    ri.image_url,
    c.slug as chain_slug,
    ri.external_id
FROM retailer_item_barcodes rib
JOIN retailer_items ri ON ri.id = rib.retailer_item_id
JOIN chains c ON c.slug = ri.chain_slug
WHERE rib.barcode IS NOT NULL AND rib.barcode != ''
AND NOT EXISTS (
    SELECT 1 FROM product_links pl WHERE pl.retailer_item_id = ri.id
)
ORDER BY rib.barcode;

-- name: GetCanonicalBarcodeProductID :one
SELECT product_id FROM canonical_barcodes WHERE barcode = $1;

-- name: InsertCanonicalBarcode :exec
INSERT INTO canonical_barcodes (barcode, product_id)
VALUES ($1, $2);

-- name: InsertProductForBarcode :one
INSERT INTO products (id, name, brand, category, subcategory, unit, unit_quantity, image_url, created_at, updated_at)
VALUES (gen_random_text(), $1, $2, $3, $4, $5, $6, $7, now(), now())
RETURNING id;

-- name: InsertProductLinkForBarcode :exec
INSERT INTO product_links (id, product_id, retailer_item_id, confidence, created_at)
VALUES (gen_random_text(), $1, $2, 'auto', now())
ON CONFLICT (retailer_item_id) DO NOTHING;

-- name: InsertQueueForReview :exec
INSERT INTO product_match_queue (id, retailer_item_id, status, created_at)
VALUES (gen_random_text(), $1, 'pending', now())
ON CONFLICT (retailer_item_id) DO NOTHING;

-- name: InsertCandidateWithFlag :exec
INSERT INTO product_match_candidates (id, retailer_item_id, match_type, flags, created_at)
VALUES (gen_random_text(), $1, 'barcode', $2, now())
ON CONFLICT (retailer_item_id, candidate_product_id) DO NOTHING;

-- AI matching queries

-- name: GetUnmatchedItemsForAI :many
SELECT
    ri.id,
    ri.name,
    ri.brand,
    ri.unit,
    ri.unit_quantity,
    ri.category,
    ri.image_url,
    c.slug as chain_slug
FROM retailer_items ri
JOIN chains c ON c.slug = ri.chain_slug
WHERE NOT EXISTS (
    SELECT 1 FROM product_links pl WHERE pl.retailer_item_id = ri.id
)
AND NOT EXISTS (
    SELECT 1 FROM product_match_queue pmq WHERE pmq.retailer_item_id = ri.id AND pmq.status = 'pending'
)
LIMIT $1;

-- name: GetTrgmCandidates :many
SELECT p.id
FROM products p
WHERE similarity(lower(p.name), lower($1)) > 0.1
ORDER BY similarity(lower(p.name), lower($1)) DESC
LIMIT $2;

-- name: CheckRejectionExists :one
SELECT EXISTS(
    SELECT 1 FROM product_match_rejections
    WHERE retailer_item_id = $1 AND rejected_product_id = $2
);

-- name: GetProductInfo :one
SELECT id, name, brand, category, unit, unit_quantity, image_url
FROM products WHERE id = $1;

-- name: StoreCandidateMatch :exec
INSERT INTO product_match_candidates (
    id, retailer_item_id, candidate_product_id, similarity, match_type, rank,
    matching_run_id, model_version, normalized_text_hash, created_at
)
VALUES (
    gen_random_text(), $1, $2, $3::real, $4, $5, $6, $7, $8, now()
)
ON CONFLICT (retailer_item_id, candidate_product_id)
DO UPDATE SET
    similarity = EXCLUDED.similarity,
    rank = EXCLUDED.rank,
    matching_run_id = EXCLUDED.matching_run_id,
    model_version = EXCLUDED.model_version;

-- name: CreateProductLink :exec
INSERT INTO product_links (id, product_id, retailer_item_id, confidence, created_at)
VALUES (gen_random_text(), $1, $2, $3, now())
ON CONFLICT (retailer_item_id) DO NOTHING;
