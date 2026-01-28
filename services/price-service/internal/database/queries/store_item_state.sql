-- name: GetStorePreviousPrice :one
SELECT current_price
FROM store_item_state
WHERE store_id = $1 AND retailer_item_id = $2;

-- name: UpsertStoreItemState :exec
INSERT INTO store_item_state (
    store_id, retailer_item_id, current_price, previous_price,
    discount_price, discount_start, discount_end, in_stock,
    unit_price, unit_price_base_quantity, unit_price_base_unit,
    lowest_price_30d, anchor_price, anchor_price_as_of,
    price_signature, last_seen_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, true,
    $8, $9, $10, $11, $12, $13, $14, NOW(), NOW()
)
ON CONFLICT (store_id, retailer_item_id) DO UPDATE SET
    previous_price = store_item_state.current_price,
    current_price = EXCLUDED.current_price,
    discount_price = EXCLUDED.discount_price,
    discount_start = EXCLUDED.discount_start,
    discount_end = EXCLUDED.discount_end,
    unit_price = EXCLUDED.unit_price,
    unit_price_base_quantity = EXCLUDED.unit_price_base_quantity,
    unit_price_base_unit = EXCLUDED.unit_price_base_unit,
    lowest_price_30d = EXCLUDED.lowest_price_30d,
    anchor_price = EXCLUDED.anchor_price,
    anchor_price_as_of = EXCLUDED.anchor_price_as_of,
    price_signature = EXCLUDED.price_signature,
    last_seen_at = NOW(),
    updated_at = NOW();
