-- Legacy helper for manual local setup.
-- Prefer migration runner instead: pnpm clickhouse:migrate

CREATE TABLE IF NOT EXISTS prices (
    target_date Date,
    chain_slug LowCardinality(String),
    store_id String,
    retailer_item_id String,
    external_id Nullable(String),
    name String,
    barcode Nullable(String),
    price_cents Nullable(Int32),
    price_status Enum8('available' = 1, 'unavailable' = 2) DEFAULT 'available',
    price_unavailable_reason Nullable(Enum8('missing' = 1, 'invalid' = 2, 'non_positive' = 3)),
    discount_price_cents Nullable(Int32),
    unit_price_cents Nullable(Int32),
    category Nullable(String),
    brand Nullable(String),
    imported_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(imported_at)
PARTITION BY (toYYYYMM(target_date), chain_slug)
ORDER BY (target_date, chain_slug, store_id, retailer_item_id);
