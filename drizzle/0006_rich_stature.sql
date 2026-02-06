CREATE TABLE "price_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"target_price" integer NOT NULL,
	"direction" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_alerts_user_id_idx" ON "price_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "price_alerts_product_id_idx" ON "price_alerts" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "price_alerts_status_idx" ON "price_alerts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "price_alerts_user_product_unique" ON "price_alerts" USING btree ("user_id","product_id","direction");