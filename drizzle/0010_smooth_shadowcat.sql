ALTER TABLE "canonical_barcodes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_aliases" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_links" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_match_audit" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_match_candidates" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_match_queue" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_match_rejections" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_relations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "canonical_barcodes" CASCADE;--> statement-breakpoint
DROP TABLE "product_aliases" CASCADE;--> statement-breakpoint
DROP TABLE "product_links" CASCADE;--> statement-breakpoint
DROP TABLE "product_match_audit" CASCADE;--> statement-breakpoint
DROP TABLE "product_match_candidates" CASCADE;--> statement-breakpoint
DROP TABLE "product_match_queue" CASCADE;--> statement-breakpoint
DROP TABLE "product_match_rejections" CASCADE;--> statement-breakpoint
DROP TABLE "product_relations" CASCADE;--> statement-breakpoint
DROP TABLE "products" CASCADE;--> statement-breakpoint
ALTER TABLE "price_alerts" DROP CONSTRAINT IF EXISTS "price_alerts_product_id_products_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "price_alerts_product_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "price_alerts_user_product_unique";--> statement-breakpoint
ALTER TABLE "price_alerts" DROP COLUMN IF EXISTS "product_id";
