-- ClickHouse schema for price data
-- Apply with: docker exec -i clickhouse-local clickhouse-client < scripts/clickhouse-schema.sql

CREATE TABLE IF NOT EXISTS prices (
    target_date Date,
    chain_slug LowCardinality(String),
    store_id String,
    retailer_item_id String,
    external_id Nullable(String),
    name String,
    barcode Nullable(String),
    price_cents Int32,
    discount_price_cents Nullable(Int32),
    unit_price_cents Nullable(Int32),
    category Nullable(String),
    brand Nullable(String),
    imported_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(imported_at)
PARTITION BY (toYYYYMM(target_date), chain_slug)
ORDER BY (target_date, chain_slug, store_id, retailer_item_id);

-- Index for common query patterns
-- Note: ClickHouse primary key ordering already optimizes for date + chain queries
