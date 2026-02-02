CREATE TABLE "active_ingestion_operations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::TEXT NOT NULL,
	"chain_slug" text NOT NULL,
	"target_date" date NOT NULL,
	"task_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "unique_active_op" ON "active_ingestion_operations" USING btree ("chain_slug","target_date");--> statement-breakpoint
CREATE INDEX "idx_active_ops_chain_date" ON "active_ingestion_operations" USING btree ("chain_slug","target_date");--> statement-breakpoint
CREATE INDEX "idx_active_ops_task_id" ON "active_ingestion_operations" USING btree ("task_id");