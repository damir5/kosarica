ALTER TABLE "products" ADD COLUMN "normalized_unit" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "normalized_quantity" real;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "normalized_name_hash" text;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "merged_into_id" text;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "category_override_by" text;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "unit_override_by" text;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "normalized_unit" text;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "normalized_quantity" real;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD CONSTRAINT "retailer_items_merged_into_id_retailer_items_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."retailer_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retailer_items_chain_name_hash_idx" ON "retailer_items" USING btree ("chain_slug","normalized_name_hash");--> statement-breakpoint
CREATE INDEX "retailer_items_merged_into_id_idx" ON "retailer_items" USING btree ("merged_into_id");--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_name_trgm_idx" ON "products" USING GIN (name gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_brand_trgm_idx" ON "products" USING GIN (brand gin_trgm_ops);