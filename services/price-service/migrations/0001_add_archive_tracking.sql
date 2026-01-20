-- Migration: Add Archive Tracking
-- This migration creates the archives table and links it to ingestion_runs and retailer_items

-- Create archives table to track all downloaded files
CREATE TABLE IF NOT EXISTS archives (
    id text PRIMARY KEY,
    chain_slug text NOT NULL,
    source_url text NOT NULL,
    filename text NOT NULL,
    original_format text NOT NULL,
    archive_path text NOT NULL,
    archive_type text NOT NULL,
    content_type text,
    file_size bigint,
    compressed_size bigint,
    checksum text NOT NULL,
    downloaded_at timestamp with time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create indexes for archives table
CREATE INDEX IF NOT EXISTS idx_archives_chain_slug ON archives(chain_slug);
CREATE INDEX IF NOT EXISTS idx_archives_downloaded_at ON archives(downloaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_archives_checksum ON archives(checksum);
CREATE INDEX IF NOT EXISTS idx_archives_chain_downloaded ON archives(chain_slug, downloaded_at DESC);

-- Add archive_id column to ingestion_runs
ALTER TABLE ingestion_runs
ADD COLUMN IF NOT EXISTS archive_id text REFERENCES archives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_archive_id ON ingestion_runs(archive_id);

-- Add archive_id column to retailer_items for traceability
ALTER TABLE retailer_items
ADD COLUMN IF NOT EXISTS archive_id text REFERENCES archives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_retailer_items_archive_id ON retailer_items(archive_id);
