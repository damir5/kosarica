CREATE TABLE "task_queue" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::TEXT NOT NULL,
	"task_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"priority" integer DEFAULT 0,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp DEFAULT NOW(),
	"started_at" timestamp,
	"completed_at" timestamp,
	"failed_at" timestamp,
	"worker_id" text,
	"retry_count" integer DEFAULT 0,
	"max_retries" integer DEFAULT 3,
	"error_message" text,
	"created_at" timestamp DEFAULT NOW(),
	"updated_at" timestamp DEFAULT NOW()
);--> statement-breakpoint
-- Drop foreign key constraints that reference ingestion_runs.id
ALTER TABLE "ingestion_errors" DROP CONSTRAINT IF EXISTS "ingestion_errors_run_id_ingestion_runs_id_fk";--> statement-breakpoint
ALTER TABLE "ingestion_files" DROP CONSTRAINT IF EXISTS "ingestion_files_run_id_ingestion_runs_id_fk";--> statement-breakpoint
ALTER TABLE "retailer_items_failed" DROP CONSTRAINT IF EXISTS "retailer_items_failed_run_id_ingestion_runs_id_fk";--> statement-breakpoint
-- Drop the primary key constraint on ingestion_runs to allow type change
ALTER TABLE "ingestion_runs" DROP CONSTRAINT IF EXISTS "ingestion_runs_pkey";--> statement-breakpoint
-- Change column types (referenced column first, then referencing columns)
ALTER TABLE "ingestion_runs" ALTER COLUMN "id" SET DATA TYPE text USING id::text;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ALTER COLUMN "parent_run_id" SET DATA TYPE text USING parent_run_id::text;--> statement-breakpoint
ALTER TABLE "ingestion_errors" ALTER COLUMN "run_id" SET DATA TYPE text USING run_id::text;--> statement-breakpoint
ALTER TABLE "ingestion_files" ALTER COLUMN "run_id" SET DATA TYPE text USING run_id::text;--> statement-breakpoint
ALTER TABLE "retailer_items_failed" ALTER COLUMN "run_id" SET DATA TYPE text USING run_id::text;--> statement-breakpoint
-- Re-add the primary key constraint
ALTER TABLE "ingestion_runs" ADD PRIMARY KEY ("id");--> statement-breakpoint
-- Re-add foreign key constraints
ALTER TABLE "ingestion_errors" ADD CONSTRAINT "ingestion_errors_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "ingestion_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingestion_files" ADD CONSTRAINT "ingestion_files_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "ingestion_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "retailer_items_failed" ADD CONSTRAINT "retailer_items_failed_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "ingestion_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Create indexes for task_queue
CREATE INDEX "idx_task_queue_status" ON "task_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_task_queue_scheduled" ON "task_queue" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "idx_task_queue_worker" ON "task_queue" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "idx_task_queue_type_priority" ON "task_queue" USING btree ("task_type","priority","scheduled_for");--> statement-breakpoint
-- CHECK constraints for task_queue
ALTER TABLE task_queue ADD CONSTRAINT task_queue_status_check
  CHECK (status IN ('pending', 'claimed', 'processing', 'completed', 'failed', 'cancelled'));--> statement-breakpoint
ALTER TABLE task_queue ADD CONSTRAINT task_queue_priority_check
  CHECK (priority >= 0 AND priority <= 10);--> statement-breakpoint
-- Drop existing functions if they exist (to handle parameter name changes)
DROP FUNCTION IF EXISTS claim_tasks(TEXT, TEXT[], INTEGER);--> statement-breakpoint
DROP FUNCTION IF EXISTS complete_task(TEXT, JSONB);--> statement-breakpoint
DROP FUNCTION IF EXISTS fail_task(TEXT, TEXT, BOOLEAN);--> statement-breakpoint
DROP FUNCTION IF EXISTS cleanup_old_tasks(INTEGER);--> statement-breakpoint
DROP FUNCTION IF EXISTS recover_orphaned_tasks();--> statement-breakpoint
-- claim_tasks function: atomically claim pending tasks for a worker
CREATE OR REPLACE FUNCTION claim_tasks(
  p_worker_id TEXT,
  p_task_types TEXT[],
  p_max_tasks INTEGER
) RETURNS TABLE (id TEXT, task_type TEXT, payload JSONB) AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT tq.id, tq.task_type, tq.payload
    FROM task_queue tq
    WHERE tq.status = 'pending'
      AND tq.scheduled_for <= NOW()
      AND (p_task_types IS NULL OR tq.task_type = ANY(p_task_types))
    ORDER BY tq.priority DESC, tq.scheduled_for ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_max_tasks
  )
  UPDATE task_queue tq
  SET status = 'claimed',
      started_at = NOW(),
      worker_id = p_worker_id,
      updated_at = NOW()
  FROM claimed c
  WHERE tq.id = c.id
  RETURNING tq.id, tq.task_type, tq.payload;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- complete_task function: mark a task as completed
CREATE OR REPLACE FUNCTION complete_task(p_task_id TEXT, p_result JSONB DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE task_queue
  SET status = 'completed', completed_at = NOW(), updated_at = NOW()
  WHERE id = p_task_id AND status = 'processing';
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- fail_task function: mark task as failed with optional retry
CREATE OR REPLACE FUNCTION fail_task(p_task_id TEXT, p_error_message TEXT, p_retry BOOLEAN DEFAULT TRUE)
RETURNS BOOLEAN AS $$
DECLARE
  should_retry BOOLEAN;
BEGIN
  SELECT retry_count < max_retries INTO should_retry FROM task_queue WHERE id = p_task_id;
  IF p_retry AND should_retry THEN
    UPDATE task_queue
    SET status = 'pending',
        retry_count = retry_count + 1,
        scheduled_for = NOW() + ((retry_count + 1) * INTERVAL '1 minute'),
        error_message = p_error_message,
        updated_at = NOW()
    WHERE id = p_task_id;
    RETURN TRUE;
  ELSE
    UPDATE task_queue
    SET status = 'failed',
        failed_at = NOW(),
        error_message = p_error_message,
        updated_at = NOW()
    WHERE id = p_task_id;
    RETURN FALSE;
  END IF;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- cleanup_old_tasks function: delete old completed tasks
CREATE OR REPLACE FUNCTION cleanup_old_tasks(p_days_to_keep INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM task_queue
  WHERE status = 'completed'
    AND completed_at < NOW() - (p_days_to_keep || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- recover_orphaned_tasks function: recover tasks stuck in claimed/processing
CREATE OR REPLACE FUNCTION recover_orphaned_tasks()
RETURNS TABLE (recovered_count INTEGER, failed_count INTEGER) AS $$
DECLARE
  _recovered INTEGER := 0;
  _failed INTEGER := 0;
BEGIN
  -- Recover tasks stuck in 'claimed' status (worker never started processing)
  WITH recovered AS (
    UPDATE task_queue
    SET status = 'pending',
        worker_id = NULL,
        started_at = NULL,
        updated_at = NOW()
    WHERE status = 'claimed'
      AND started_at < NOW() - INTERVAL '15 minutes'
    RETURNING id
  )
  SELECT COUNT(*) INTO _recovered FROM recovered;

  -- Handle tasks stuck in 'processing' status (worker crashed)
  WITH failed AS (
    UPDATE task_queue
    SET status = CASE WHEN retry_count < max_retries THEN 'pending' ELSE 'failed' END,
        retry_count = CASE WHEN retry_count < max_retries THEN retry_count + 1 ELSE retry_count END,
        scheduled_for = CASE WHEN retry_count < max_retries THEN NOW() + ((retry_count + 1) * INTERVAL '1 minute') ELSE scheduled_for END,
        failed_at = CASE WHEN retry_count >= max_retries THEN NOW() ELSE NULL END,
        error_message = 'Recovered from orphaned processing state',
        worker_id = NULL,
        updated_at = NOW()
    WHERE status = 'processing'
      AND started_at < NOW() - INTERVAL '15 minutes'
    RETURNING id
  )
  SELECT COUNT(*) INTO _failed FROM failed;

  RETURN QUERY SELECT _recovered, _failed;
END;
$$ LANGUAGE plpgsql;
