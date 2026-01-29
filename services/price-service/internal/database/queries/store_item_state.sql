-- name: GetStorePreviousPrice :one
SELECT current_price
FROM store_item_state
WHERE store_id = $1 AND retailer_item_id = $2;

-- name: GetStorePreviousPricesBatch :many
SELECT retailer_item_id, current_price
FROM store_item_state
WHERE store_id = $1 AND retailer_item_id = ANY($2::text[]);

-- name: UpsertStoreItemState :one
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
    updated_at = NOW()
RETURNING previous_price, current_price;

-- name: BatchUpsertStoreItemState :exec
WITH new_values (store_id, retailer_item_id, current_price, previous_price, discount_price, discount_start, discount_end,
                 in_stock, unit_price, unit_price_base_quantity, unit_price_base_unit,
                 lowest_price_30d, anchor_price, anchor_price_as_of, price_signature) AS (
    SELECT UNNEST($1::text[]), UNNEST($2::text[]), UNNEST($3::int4[]), UNNEST($4::int4[]),
           UNNEST($5::int4[]), UNNEST($6::timestamptz[]), UNNEST($7::timestamptz[]),
           $8::boolean, UNNEST($9::int4[]), UNNEST($10::text[]), UNNEST($11::text[]),
           UNNEST($12::int4[]), UNNEST($13::int4[]), UNNEST($14::timestamptz[]), UNNEST($15::text[])
)
INSERT INTO store_item_state (
    store_id, retailer_item_id, current_price, previous_price,
    discount_price, discount_start, discount_end, in_stock,
    unit_price, unit_price_base_quantity, unit_price_base_unit,
    lowest_price_30d, anchor_price, anchor_price_as_of,
    price_signature, last_seen_at, updated_at
)
SELECT nv.store_id, nv.retailer_item_id, nv.current_price, nv.previous_price,
       nv.discount_price, nv.discount_start, nv.discount_end, nv.in_stock,
       nv.unit_price, nv.unit_price_base_quantity, nv.unit_price_base_unit,
       nv.lowest_price_30d, nv.anchor_price, nv.anchor_price_as_of,
       nv.price_signature, NOW(), NOW()
FROM new_values nv
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
