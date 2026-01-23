-- Drop existing tables
DROP TABLE IF EXISTS store_item_price_periods CASCADE;
DROP TABLE IF EXISTS store_item_state CASCADE;
DROP TABLE IF EXISTS ingestion_errors CASCADE;
DROP TABLE IF EXISTS ingestion_files CASCADE;
DROP TABLE IF EXISTS ingestion_runs CASCADE;
DROP TABLE IF EXISTS product_match_audit CASCADE;

-- Create tables with bigint primary keys

CREATE TABLE ingestion_runs (
    id bigserial PRIMARY KEY,
    chain_slug text NOT NULL REFERENCES chains(slug) ON DELETE CASCADE,
    source text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    started_at timestamp,
    completed_at timestamp,
    total_files integer DEFAULT 0,
    processed_files integer DEFAULT 0,
    total_entries integer DEFAULT 0,
    processed_entries integer DEFAULT 0,
    error_count integer DEFAULT 0,
    metadata text,
    -- Rerun support - bigint IDs reference same table
    parent_run_id bigint REFERENCES ingestion_runs(id) ON DELETE CASCADE,
    rerun_type text,
    rerun_target_id bigint
);

CREATE TABLE ingestion_files (
    id bigserial PRIMARY KEY,
    run_id bigint NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
    filename text NOT NULL,
    file_type text NOT NULL,
    file_size integer,
    file_hash text,
    status text NOT NULL DEFAULT 'pending',
    entry_count integer DEFAULT 0,
    processed_at timestamp,
    metadata text,
    -- Chunking support
    total_chunks integer DEFAULT 0,
    processed_chunks integer DEFAULT 0,
    chunk_size integer,
    created_at timestamp DEFAULT NOW()
);

CREATE TABLE ingestion_errors (
    id bigserial PRIMARY KEY,
    run_id bigint NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
    file_id text REFERENCES ingestion_files(id) ON DELETE SET NULL,
    chunk_id text REFERENCES ingestion_chunks(id) ON DELETE SET NULL,
    entry_id text REFERENCES ingestion_file_entries(id) ON DELETE SET NULL,
    error_type text NOT NULL,
    error_message text NOT NULL,
    error_details text,
    severity text NOT NULL DEFAULT 'error',
    created_at timestamp DEFAULT NOW()
);

CREATE TABLE store_item_state (
    id bigserial PRIMARY KEY,
    store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    retailer_item_id text NOT NULL REFERENCES retailer_items(id) ON DELETE CASCADE,
    current_price integer,
    previous_price integer,
    discount_price integer,
    discount_start timestamp,
    discount_end timestamp,
    in_stock boolean DEFAULT true,
    unit_price integer,
    unit_price_base_quantity text,
    unit_price_base_unit text,
    lowest_price_30d integer,
    anchor_price integer,
    anchor_price_as_of timestamp,
    price_signature text,
    last_seen_at timestamp DEFAULT NOW(),
    updated_at timestamp DEFAULT NOW()
);

CREATE TABLE store_item_price_periods (
    id bigserial PRIMARY KEY,
    store_item_state_id bigint NOT NULL REFERENCES store_item_state(id) ON DELETE CASCADE,
    price integer NOT NULL,
    discount_price integer,
    started_at timestamp NOT NULL,
    ended_at timestamp,
    created_at timestamp DEFAULT NOW()
);

CREATE TABLE product_match_audit (
    id bigserial PRIMARY KEY,
    queue_id text NOT NULL REFERENCES product_match_queue(id) ON DELETE CASCADE,
    action text NOT NULL,
    user_id text REFERENCES user(id),
    previous_state text,
    new_state text,
    created_at timestamp with time zone DEFAULT NOW()
);
