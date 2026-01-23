-- Add unique constraint on retailer_items (chain_slug, external_id)
-- This is required for INSERT ... ON CONFLICT to work in the ingestion pipeline

-- First drop the existing non-unique index
DROP INDEX IF EXISTS idx_retailer_items_chain_external_id;

-- Create a unique index
CREATE UNIQUE INDEX retailer_items_chain_external_id_idx ON retailer_items (chain_slug, external_id);
