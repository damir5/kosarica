-- name: InsertRetailerItemBarcode :exec
INSERT INTO retailer_item_barcodes (id, retailer_item_id, barcode, is_primary, created_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT DO NOTHING;
