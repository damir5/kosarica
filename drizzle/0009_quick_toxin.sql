ALTER TABLE "price_alerts" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD COLUMN "variant_cluster_id" text;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD COLUMN "base_cluster_id" text;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD COLUMN "alert_scope" text DEFAULT 'variant' NOT NULL;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_variant_cluster_id_product_clusters_id_fk" FOREIGN KEY ("variant_cluster_id") REFERENCES "public"."product_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_base_cluster_id_product_clusters_id_fk" FOREIGN KEY ("base_cluster_id") REFERENCES "public"."product_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_alerts_variant_cluster_id_idx" ON "price_alerts" USING btree ("variant_cluster_id");--> statement-breakpoint
CREATE INDEX "price_alerts_base_cluster_id_idx" ON "price_alerts" USING btree ("base_cluster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_alerts_user_variant_unique" ON "price_alerts" USING btree ("user_id","variant_cluster_id","direction");--> statement-breakpoint
CREATE UNIQUE INDEX "price_alerts_user_base_unique" ON "price_alerts" USING btree ("user_id","base_cluster_id","direction");