-- Pre-aggregated current prices table.
-- Contains one row per (retailer_item_id, chain_slug, store_id) with latest values.
-- Refreshed periodically by cron from the raw prices table.
--
-- Note: brand is Nullable(String), so tokenbf index is not supported on it.
-- name is String (non-nullable), so tokenbf works.

CREATE TABLE IF NOT EXISTS prices_current (
    retailer_item_id String,
    chain_slug LowCardinality(String),
    store_id String,
    name String,
    brand Nullable(String),
    category Nullable(String),
    external_id Nullable(String),
    barcode Nullable(String),
    price_cents Nullable(Int32),
    price_status Enum8('available' = 1, 'unavailable' = 2) DEFAULT 'available',
    price_unavailable_reason Nullable(Enum8('missing' = 1, 'invalid' = 2, 'non_positive' = 3)),
    discount_price_cents Nullable(Int32),
    unit_price_cents Nullable(Int32),
    target_date Date,
    imported_at DateTime DEFAULT now(),
    INDEX idx_category category TYPE bloom_filter GRANULARITY 1,
    INDEX idx_name name TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1
) ENGINE = ReplacingMergeTree(imported_at)
ORDER BY (retailer_item_id, chain_slug, store_id);

-- Chain metadata: latest date per chain for fast basket optimizer lookups.
CREATE TABLE IF NOT EXISTS prices_chain_metadata (
    chain_slug LowCardinality(String),
    latest_date Date,
    updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY chain_slug;
