-- Create retailer_items_failed table for storing failed ingestion rows

CREATE TABLE "retailer_items_failed" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
	"chain_slug" text NOT NULL,
	"run_id" bigint REFERENCES "ingestion_runs"("id") ON DELETE CASCADE,
	"file_id" bigint REFERENCES "ingestion_files"("id") ON DELETE CASCADE,
	"store_identifier" text,
	"row_number" integer,
	"raw_data" text NOT NULL,
	"validation_errors" jsonb NOT NULL,
	"failed_at" timestamp DEFAULT now(),
	"reviewed" boolean DEFAULT false,
	"reviewed_by" text,
	"review_notes" text,
	"reprocessable" boolean DEFAULT true,
	"reprocessed_at" timestamp
);