CREATE TABLE "ingestion_store_stats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"file_id" bigint NOT NULL,
	"store_id" text NOT NULL,
	"store_identifier" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"persisted_count" integer DEFAULT 0 NOT NULL,
	"price_changes" integer DEFAULT 0 NOT NULL,
	"failed_rows" integer DEFAULT 0 NOT NULL,
	"warning_rows" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "ingestion_store_stats" ADD CONSTRAINT "ingestion_store_stats_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_store_stats" ADD CONSTRAINT "ingestion_store_stats_file_id_ingestion_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."ingestion_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_store_stats" ADD CONSTRAINT "ingestion_store_stats_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_store_stats_run_idx" ON "ingestion_store_stats" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ingestion_store_stats_file_idx" ON "ingestion_store_stats" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "ingestion_store_stats_store_idx" ON "ingestion_store_stats" USING btree ("store_id");