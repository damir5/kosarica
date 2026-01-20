-- Migration: Add source_url to ingestion_runs
-- This migration adds source_url column to track the source URL for each ingestion run

ALTER TABLE ingestion_runs
ADD COLUMN IF NOT EXISTS source_url text;
