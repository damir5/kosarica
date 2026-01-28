CREATE TABLE "cron_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cron_expression" text NOT NULL,
	"timezone" text DEFAULT 'UTC',
	"task_type" text NOT NULL,
	"task_payload" jsonb,
	"enabled" boolean DEFAULT true,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_run_status" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cron_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"error_details" text,
	"tasks_enqueued" integer DEFAULT 0,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "cron_runs" ADD CONSTRAINT "cron_runs_job_id_cron_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."cron_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cron_jobs_next_run_idx" ON "cron_jobs" USING btree ("next_run_at") WHERE enabled = true;--> statement-breakpoint
CREATE INDEX "cron_jobs_enabled_idx" ON "cron_jobs" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "cron_runs_idempotency_idx" ON "cron_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "cron_runs_job_id_idx" ON "cron_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "cron_runs_status_idx" ON "cron_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cron_runs_job_created_idx" ON "cron_runs" USING btree ("job_id","created_at");