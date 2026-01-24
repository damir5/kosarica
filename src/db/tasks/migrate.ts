import { sql } from "drizzle-orm";

export async function up(db: import("postgres").Sql) {
	await db.execute(sql`
    CREATE TABLE IF NOT EXISTS task_queue (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      task_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      priority INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      scheduled_for TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
      started_at TIMESTAMP WITHOUT TIME ZONE,
      completed_at TIMESTAMP WITHOUT TIME ZONE,
      failed_at TIMESTAMP WITHOUT TIME ZONE,
      worker_id TEXT,
      leased_until TIMESTAMP WITHOUT TIME ZONE,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      error_message TEXT,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),

      CONSTRAINT task_queue_status_check CHECK (
        status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')
      ),
      CONSTRAINT task_queue_priority_check CHECK (priority >= 0 AND priority <= 10)
    )
  `);

	await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status)
  `);

	await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_task_queue_scheduled ON task_queue(scheduled_for) 
    WHERE status = 'pending'
  `);

	await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_task_queue_worker ON task_queue(worker_id) 
    WHERE status = 'processing'
  `);

	await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_task_queue_type_priority 
    ON task_queue(task_type, priority DESC, scheduled_for) 
    WHERE status = 'pending'
  `);

	await db.execute(sql`
    CREATE OR REPLACE FUNCTION claim_tasks(
      worker_id TEXT,
      task_types TEXT[],
      max_tasks INTEGER,
      lease_duration_minutes INTEGER DEFAULT 30
    )
    RETURNS TABLE (
      id TEXT,
      task_type TEXT,
      payload JSONB
    ) AS $$
    BEGIN
      WITH claimed AS (
        SELECT id, task_type, payload
        FROM task_queue
        WHERE status = 'pending'
          AND scheduled_for <= NOW()
          AND (task_types IS NULL OR task_type = ANY(task_types))
        ORDER BY priority DESC, scheduled_for ASC
        FOR UPDATE SKIP LOCKED
        LIMIT max_tasks
      )
      RETURN QUERY SELECT claimed.id, claimed.task_type, claimed.payload;

      UPDATE task_queue
      SET status = 'processing',
          started_at = NOW(),
          worker_id = worker_id,
          leased_until = NOW() + (lease_duration_minutes || ' minutes')::INTERVAL,
          updated_at = NOW()
      WHERE id IN (
        SELECT id FROM task_queue
        WHERE status = 'pending'
          AND scheduled_for <= NOW()
          AND (task_types IS NULL OR task_type = ANY(task_types))
        ORDER BY priority DESC, scheduled_for ASC
        FOR UPDATE SKIP LOCKED
        LIMIT max_tasks
      );
    END;
    $$ LANGUAGE plpgsql
  `);

	await db.execute(sql`
    CREATE OR REPLACE FUNCTION complete_task(
      task_id TEXT,
      result JSONB DEFAULT NULL
    )
    RETURNS BOOLEAN AS $$
    BEGIN
      UPDATE task_queue
      SET status = 'completed',
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1 AND status IN ('claimed', 'processing');
      
      IF NOT FOUND THEN
        RETURN FALSE;
      END IF;
      
      RETURN TRUE;
    END;
    $$ LANGUAGE plpgsql
  `);

	await db.execute(sql`
    CREATE OR REPLACE FUNCTION fail_task(
      task_id TEXT,
      error_message TEXT,
      retry BOOLEAN DEFAULT TRUE
    )
    RETURNS BOOLEAN AS $$
    DECLARE
      should_retry BOOLEAN;
    BEGIN
      SELECT retry_count < max_retries INTO should_retry
      FROM task_queue
      WHERE id = $1;
      
      IF retry AND should_retry THEN
        UPDATE task_queue
        SET status = 'pending',
            retry_count = retry_count + 1,
            scheduled_for = NOW() + (retry_count * 60)::INTERVAL,
            error_message = $2,
            updated_at = NOW()
        WHERE id = $1;
        RETURN TRUE;
      ELSE
        UPDATE task_queue
        SET status = 'failed',
            failed_at = NOW(),
            error_message = $2,
            updated_at = NOW()
        WHERE id = $1;
        RETURN FALSE;
      END IF;
    END;
    $$ LANGUAGE plpgsql
  `);

	await db.execute(sql`
    CREATE OR REPLACE FUNCTION cleanup_old_tasks(days_to_keep INTEGER DEFAULT 7)
    RETURNS INTEGER AS $$
    BEGIN
      DELETE FROM task_queue
      WHERE status = 'completed'
        AND completed_at < NOW() - (days_to_keep || ' days')::INTERVAL;

      RETURN FOUND;
    END;
    $$ LANGUAGE plpgsql
  `);

	await db.execute(sql`
    CREATE OR REPLACE FUNCTION recover_orphaned_tasks()
    RETURNS TABLE (
      recovered_count INTEGER,
      failed_count INTEGER
    ) AS $$
    DECLARE
      recovered_tasks INTEGER := 0;
      failed_tasks INTEGER := 0;
    BEGIN
      -- Requeue tasks whose lease has expired
      UPDATE task_queue
      SET status = 'pending',
          worker_id = NULL,
          leased_until = NULL,
          started_at = NULL,
          retry_count = retry_count + 1,
          error_message = 'Task lease expired, requeued',
          updated_at = NOW()
      WHERE status = 'processing'
        AND leased_until IS NOT NULL
        AND leased_until < NOW()
        AND retry_count < max_retries;

      GET DIAGNOSTICS recovered_tasks = ROW_COUNT;

      -- Mark tasks as failed if retry count is exhausted
      UPDATE task_queue
      SET status = 'failed',
          error_message = error_message || ' (lease expired after max retries)',
          failed_at = NOW(),
          updated_at = NOW()
      WHERE status = 'processing'
        AND leased_until IS NOT NULL
        AND leased_until < NOW()
        AND retry_count >= max_retries;

      GET DIAGNOSTICS failed_tasks = ROW_COUNT;

      RETURN QUERY SELECT recovered_tasks, failed_tasks;
    END;
    $$ LANGUAGE plpgsql
  `);
}

export async function down(db: import("postgres").Sql) {
	await db.execute(sql`DROP FUNCTION IF EXISTS recover_orphaned_tasks`);
	await db.execute(sql`DROP FUNCTION IF EXISTS cleanup_old_tasks`);
	await db.execute(sql`DROP FUNCTION IF EXISTS fail_task`);
	await db.execute(sql`DROP FUNCTION IF EXISTS complete_task`);
	await db.execute(sql`DROP FUNCTION IF EXISTS claim_tasks`);
	await db.execute(sql`DROP INDEX IF EXISTS idx_task_queue_type_priority`);
	await db.execute(sql`DROP INDEX IF EXISTS idx_task_queue_worker`);
	await db.execute(sql`DROP INDEX IF EXISTS idx_task_queue_scheduled`);
	await db.execute(sql`DROP INDEX IF EXISTS idx_task_queue_status`);
	await db.execute(sql`DROP TABLE IF EXISTS task_queue`);
}
