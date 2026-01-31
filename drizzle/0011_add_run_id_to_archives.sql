-- Add run_id to archives table to link archives to ingestion runs
-- This enables Load+Cluster to query which archives to process for a given run

ALTER TABLE "archives" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "archives" ADD CONSTRAINT "archives_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_archives_run_id" ON "archives" USING btree ("run_id") WHERE run_id IS NOT NULL;
