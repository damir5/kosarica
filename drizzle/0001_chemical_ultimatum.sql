ALTER TABLE "retailer_items" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "subcategory" text;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "unit_quantity" text;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "chain_slug" text;