ALTER TABLE "ingestion_files" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "ingestion_files" ADD COLUMN "status_severity" text;--> statement-breakpoint
ALTER TABLE "ingestion_files" ADD COLUMN "status_type" text;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "status_severity" text;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "status_type" text;