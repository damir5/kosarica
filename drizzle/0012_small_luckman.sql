-- Migration: Add target_date to price_tiers and store_price_refs for date-scoped snapshots
-- This is a breaking change: existing data will be deleted as it doesn't have date context

-- Delete existing data (no target_date context)
DELETE FROM store_price_refs;--> statement-breakpoint
DELETE FROM price_tiers;--> statement-breakpoint

-- Drop old unique indexes
DROP INDEX "idx_price_tiers_unique";--> statement-breakpoint
DROP INDEX "store_price_refs_pkey";--> statement-breakpoint

-- Add target_date columns
ALTER TABLE "price_tiers" ADD COLUMN "target_date" date NOT NULL;--> statement-breakpoint
ALTER TABLE "store_price_refs" ADD COLUMN "target_date" date NOT NULL;--> statement-breakpoint

-- Create new indexes
CREATE INDEX "idx_price_tiers_chain_date" ON "price_tiers" USING btree ("chain_slug",target_date DESC);--> statement-breakpoint
CREATE INDEX "idx_store_price_refs_date" ON "store_price_refs" USING btree ("target_date");--> statement-breakpoint

-- Create new unique indexes scoped by date
CREATE UNIQUE INDEX "idx_price_tiers_unique" ON "price_tiers" USING btree ("target_date","chain_slug","retailer_item_id","price",COALESCE(discount_price, -1));--> statement-breakpoint
CREATE UNIQUE INDEX "store_price_refs_pkey" ON "store_price_refs" USING btree ("target_date","store_id","retailer_item_id");
