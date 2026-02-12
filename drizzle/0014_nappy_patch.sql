ALTER TABLE "stores" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "display_name_manual" boolean DEFAULT false;