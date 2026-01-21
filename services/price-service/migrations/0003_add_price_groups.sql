-- Migration: Add Price Groups
-- This migration creates the price groups system for content-addressable price storage
-- with immutable price groups for 50%+ storage reduction

-- Enable btree_gist extension for GiST exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Create price_groups table - Content-addressable groups (immutable)
CREATE TABLE IF NOT EXISTS price_groups (
    id text PRIMARY KEY,
    chain_slug text NOT NULL REFERENCES chains(slug) ON DELETE CASCADE,
    price_hash text NOT NULL,
    hash_version smallint NOT NULL DEFAULT 1,
    store_count integer NOT NULL DEFAULT 0,
    item_count integer NOT NULL DEFAULT 0,
    first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),

    -- Content-addressable uniqueness constraint
    CONSTRAINT price_groups_chain_hash_unique UNIQUE (chain_slug, price_hash, hash_version)
);

-- Create indexes for price_groups table
CREATE INDEX IF NOT EXISTS idx_price_groups_chain_slug ON price_groups(chain_slug);
CREATE INDEX IF NOT EXISTS idx_price_groups_price_hash ON price_groups(price_hash);
CREATE INDEX IF NOT EXISTS idx_price_groups_last_seen ON price_groups(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_groups_store_count ON price_groups(store_count);

-- Create group_prices table - Prices stored at group level
CREATE TABLE IF NOT EXISTS group_prices (
    price_group_id text NOT NULL REFERENCES price_groups(id) ON DELETE CASCADE,
    retailer_item_id text NOT NULL REFERENCES retailer_items(id) ON DELETE CASCADE,
    price integer NOT NULL, -- cents/lipa, NOT NULL
    discount_price integer, -- NULL = no discount (distinct from 0!)
    unit_price integer, -- price per unit in cents (e.g., per kg/l)
    anchor_price integer, -- "sidrena cijena" anchor/reference price in cents
    created_at timestamp with time zone NOT NULL DEFAULT now(),

    -- Composite primary key
    CONSTRAINT group_prices_pkey PRIMARY KEY (price_group_id, retailer_item_id)
);

-- Create indexes for group_prices table
CREATE INDEX IF NOT EXISTS idx_group_prices_price_group_id ON group_prices(price_group_id);
CREATE INDEX IF NOT EXISTS idx_group_prices_retailer_item_id ON group_prices(retailer_item_id);

-- Create store_group_history table - Temporal store->group mapping
CREATE TABLE IF NOT EXISTS store_group_history (
    id text PRIMARY KEY,
    store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    price_group_id text NOT NULL REFERENCES price_groups(id) ON DELETE CASCADE,
    valid_from timestamp with time zone NOT NULL,
    valid_to timestamp with time zone, -- NULL = current membership
    created_at timestamp with time zone NOT NULL DEFAULT now(),

    -- GiST exclusion constraint to prevent overlapping time ranges for same store
    -- Use COALESCE to treat NULL valid_to as infinity for proper overlap detection
    CONSTRAINT store_group_history_no_overlap EXCLUDE USING gist (
        store_id WITH =,
        period(valid_from, COALESCE(valid_to, 'infinity'::timestamptz)) WITH &&
    )
);

-- Create indexes for store_group_history table
CREATE INDEX IF NOT EXISTS idx_store_group_history_store_id ON store_group_history(store_id);
CREATE INDEX IF NOT EXISTS idx_store_group_history_price_group_id ON store_group_history(price_group_id);
CREATE INDEX IF NOT EXISTS idx_store_group_history_valid_from ON store_group_history(valid_from DESC);

-- Partial unique index for current membership (valid_to IS NULL)
-- Ensures each store has exactly one current price group
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_group_history_current
    ON store_group_history(store_id)
    WHERE valid_to IS NULL;

-- Create store_price_exceptions table - Rare overrides that must expire
CREATE TABLE IF NOT EXISTS store_price_exceptions (
    store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    retailer_item_id text NOT NULL REFERENCES retailer_items(id) ON DELETE CASCADE,
    price integer NOT NULL, -- cents/lipa
    discount_price integer, -- NULL = no discount (distinct from 0!)
    reason text NOT NULL, -- why this exception exists
    expires_at timestamp with time zone NOT NULL, -- exceptions MUST expire
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    created_by text REFERENCES user(id) ON DELETE SET NULL,

    -- Composite primary key
    CONSTRAINT store_price_exceptions_pkey PRIMARY KEY (store_id, retailer_item_id)
);

-- Create indexes for store_price_exceptions table
CREATE INDEX IF NOT EXISTS idx_store_price_exceptions_store_id ON store_price_exceptions(store_id);
CREATE INDEX IF NOT EXISTS idx_store_price_exceptions_retailer_item_id ON store_price_exceptions(retailer_item_id);
CREATE INDEX IF NOT EXISTS idx_store_price_exceptions_expires_at ON store_price_exceptions(expires_at);

-- Add comment for documentation
COMMENT ON TABLE price_groups IS 'Content-addressable price groups for efficient storage of identical price sets across stores';
COMMENT ON TABLE group_prices IS 'Prices stored at group level - shared by all stores in the group';
COMMENT ON TABLE store_group_history IS 'Temporal history of store->group mappings with GiST exclusion constraint preventing overlaps';
COMMENT ON TABLE store_price_exceptions IS 'Rare price overrides that must have an expiration date for audit compliance';
COMMENT ON COLUMN group_prices.discount_price IS 'NULL = no discount (distinct from 0!) - critical for hash correctness';
COMMENT ON COLUMN store_price_exceptions.expires_at IS 'Exceptions MUST expire - this is non-negotiable for audit compliance';
