-- Migration for pgvector and pg_trgm extensions + embedding tables
-- This adds support for AI-based product matching using vector similarity

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add unique constraint to product_links (enforces 1:1 mapping)
-- Note: This is already done by 0002 migration, but documenting here for completeness
-- ALTER TABLE product_links ADD CONSTRAINT product_links_item_uniq UNIQUE (retailer_item_id);

-- Embedding cache for retailer items
CREATE TABLE retailer_item_embeddings (
    retailer_item_id TEXT PRIMARY KEY REFERENCES retailer_items(id) ON DELETE CASCADE,
    embedding vector(1536),
    model_version TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    normalized_text_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Embedding cache for products
CREATE TABLE product_embeddings (
    product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    embedding vector(1536),
    model_version TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    normalized_text_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- HNSW indexes for better recall on growing corpus (vs ivfflat)
-- HNSW is better for:
-- - Higher recall (especially important for matching)
-- - Dynamic datasets (we'll be adding embeddings continuously)
-- - Smaller memory footprint for updates
CREATE INDEX ON retailer_item_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON product_embeddings USING hnsw (embedding vector_cosine_ops);

-- GIN index for text similarity search with pg_trgm
CREATE INDEX ON retailer_items USING gin (name gin_trgm_ops);
CREATE INDEX ON products USING gin (name gin_trgm_ops);

-- Analyze for query planner optimization
ANALYZE retailer_item_embeddings;
ANALYZE product_embeddings;
ANALYZE retailer_items;
ANALYZE products;
