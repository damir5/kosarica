-- Add unique constraint on retailer_items (chain_slug, external_id)
-- Required for INSERT ... ON CONFLICT to work in the ingestion pipeline

-- Drop the existing non-unique index
DROP INDEX IF EXISTS retailer_items_chain_external_id_idx;

-- Create a unique index
CREATE UNIQUE INDEX retailer_items_chain_external_id_idx ON retailer_items (chain_slug, external_id);
