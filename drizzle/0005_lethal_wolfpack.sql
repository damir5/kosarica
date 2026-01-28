CREATE TABLE "retailer_item_barcodes" (
	"id" text PRIMARY KEY NOT NULL,
	"retailer_item_id" text NOT NULL,
	"barcode" text NOT NULL,
	"is_primary" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DROP INDEX "store_item_state_store_retailer_idx";--> statement-breakpoint
ALTER TABLE "retailer_items" ALTER COLUMN "retailer_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "retailer_items" ALTER COLUMN "barcode" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "retailer_item_barcodes" ADD CONSTRAINT "retailer_item_barcodes_retailer_item_id_retailer_items_id_fk" FOREIGN KEY ("retailer_item_id") REFERENCES "public"."retailer_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retailer_item_barcodes_retailer_item_id_idx" ON "retailer_item_barcodes" USING btree ("retailer_item_id");--> statement-breakpoint
CREATE INDEX "retailer_item_barcodes_barcode_new_idx" ON "retailer_item_barcodes" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "retailer_item_barcodes_item_barcode_unique" ON "retailer_item_barcodes" USING btree ("retailer_item_id","barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "retailer_items_chain_slug_external_id_unique" ON "retailer_items" USING btree ("chain_slug","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_item_state_store_retailer_unique" ON "store_item_state" USING btree ("store_id","retailer_item_id");