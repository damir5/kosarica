CREATE TABLE "archives" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_slug" text NOT NULL,
	"source_url" text NOT NULL,
	"filename" text NOT NULL,
	"original_format" text NOT NULL,
	"archive_path" text NOT NULL,
	"archive_type" text NOT NULL,
	"content_type" text,
	"file_size" bigint,
	"compressed_size" bigint,
	"checksum" text NOT NULL,
	"downloaded_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "archive_id" text;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD COLUMN "archive_id" text;--> statement-breakpoint
CREATE INDEX "idx_archives_chain_slug" ON "archives" USING btree ("chain_slug");--> statement-breakpoint
CREATE INDEX "idx_archives_downloaded_at" ON "archives" USING btree ("downloaded_at");--> statement-breakpoint
CREATE INDEX "idx_archives_checksum" ON "archives" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "idx_archives_chain_downloaded" ON "archives" USING btree ("chain_slug","downloaded_at");--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_archive_id_archives_id_fk" FOREIGN KEY ("archive_id") REFERENCES "public"."archives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_items" ADD CONSTRAINT "retailer_items_archive_id_archives_id_fk" FOREIGN KEY ("archive_id") REFERENCES "public"."archives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ingestion_runs_archive_id" ON "ingestion_runs" USING btree ("archive_id");--> statement-breakpoint
CREATE INDEX "idx_retailer_items_archive_id" ON "retailer_items" USING btree ("archive_id");--> statement-breakpoint
-- Seed valid retail chains
INSERT INTO chains (slug, name, website, logo_url) VALUES
  ('konzum', 'Konzum', 'https://www.konzum.hr', NULL),
  ('lidl', 'Lidl', 'https://www.lidl.hr', NULL),
  ('plodine', 'Plodine', 'https://www.plodine.hr', NULL),
  ('interspar', 'Interspar', 'https://www.interspar.hr', NULL),
  ('studenac', 'Studenac', 'https://www.studenac.hr', NULL),
  ('kaufland', 'Kaufland', 'https://www.kaufland.hr', NULL),
  ('eurospin', 'Eurospin', 'https://www.eurospin.hr', NULL),
  ('dm', 'DM', 'https://www.dm.hr', NULL),
  ('ktc', 'KTC', 'https://www.ktc.hr', NULL),
  ('metro', 'Metro', 'https://www.metro.hr', NULL),
  ('trgocentar', 'Trgocentar', 'https://www.trgocentar.hr', NULL)
ON CONFLICT (slug) DO NOTHING;