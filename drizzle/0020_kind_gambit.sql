ALTER TABLE "cluster_members" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cluster_relations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_clusters" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "cluster_members" CASCADE;--> statement-breakpoint
DROP TABLE "cluster_relations" CASCADE;--> statement-breakpoint
DROP TABLE "product_clusters" CASCADE;--> statement-breakpoint
ALTER TABLE "price_alerts" DROP CONSTRAINT "price_alerts_variant_cluster_id_product_clusters_id_fk";
--> statement-breakpoint
ALTER TABLE "price_alerts" DROP CONSTRAINT "price_alerts_base_cluster_id_product_clusters_id_fk";
--> statement-breakpoint
DROP INDEX "price_alerts_variant_cluster_id_idx";--> statement-breakpoint
DROP INDEX "price_alerts_base_cluster_id_idx";--> statement-breakpoint
DROP INDEX "price_alerts_user_variant_unique";--> statement-breakpoint
DROP INDEX "price_alerts_user_base_unique";--> statement-breakpoint
ALTER TABLE "price_alerts" ADD COLUMN "canonical_sku_id" text;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD COLUMN "base_product_id" text;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_canonical_sku_id_canonical_skus_id_fk" FOREIGN KEY ("canonical_sku_id") REFERENCES "public"."canonical_skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_base_product_id_canonical_skus_id_fk" FOREIGN KEY ("base_product_id") REFERENCES "public"."canonical_skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_alerts_canonical_sku_id_idx" ON "price_alerts" USING btree ("canonical_sku_id");--> statement-breakpoint
CREATE INDEX "price_alerts_base_product_id_idx" ON "price_alerts" USING btree ("base_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_alerts_user_sku_unique" ON "price_alerts" USING btree ("user_id","canonical_sku_id","direction");--> statement-breakpoint
CREATE UNIQUE INDEX "price_alerts_user_base_unique" ON "price_alerts" USING btree ("user_id","base_product_id","direction");--> statement-breakpoint
ALTER TABLE "price_alerts" DROP COLUMN "variant_cluster_id";--> statement-breakpoint
ALTER TABLE "price_alerts" DROP COLUMN "base_cluster_id";