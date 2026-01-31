ALTER TABLE "ingestion_runs" ADD COLUMN "target_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "is_forced" boolean DEFAULT false;--> statement-breakpoint
CREATE INDEX "idx_ingestion_runs_chain_date" ON "ingestion_runs" USING btree ("chain_slug","target_date");--> statement-breakpoint
CREATE INDEX "idx_ingestion_runs_active" ON "ingestion_runs" USING btree ("chain_slug","target_date","status");