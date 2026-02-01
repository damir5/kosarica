-- Manual PostgreSQL functions for task queue operations
-- These are not managed by Drizzle ORM

-- Function: claim_tasks
-- Claims pending tasks for a worker
CREATE OR REPLACE FUNCTION claim_tasks(p_worker_id text, p_task_types text[], p_max_tasks integer)
RETURNS TABLE(id text, task_type text, payload jsonb)
LANGUAGE plpgsql
AS $$
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
$$;

-- Function: cleanup_old_tasks
-- Removes old completed tasks
CREATE OR REPLACE FUNCTION cleanup_old_tasks(p_days_to_keep integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM task_queue
  WHERE status = 'completed'
    AND completed_at < NOW() - (p_days_to_keep || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Function: complete_task
-- Marks a task as completed
CREATE OR REPLACE FUNCTION complete_task(p_task_id text, p_result jsonb DEFAULT NULL::jsonb)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE task_queue
  SET status = 'completed', completed_at = NOW(), updated_at = NOW()
  WHERE id = p_task_id AND status = 'processing';
  RETURN FOUND;
END;
$$;

-- Function: fail_task
-- Handles task failure with retry logic
CREATE OR REPLACE FUNCTION fail_task(p_task_id text, p_error_message text, p_retry boolean DEFAULT true)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  should_retry BOOLEAN;
BEGIN
  SELECT retry_count < max_retries INTO should_retry FROM task_queue WHERE id = p_task_id;
  IF p_retry AND should_retry THEN
    UPDATE task_queue
    SET status = 'pending',
        retry_count = retry_count + 1,
        scheduled_for = NOW() + ((retry_count + 2) * INTERVAL '1 minute'),
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
$$;

-- Function: on_subtask_complete
-- Trigger function for subtask completion
CREATE OR REPLACE FUNCTION on_subtask_complete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'completed' AND NEW.parent_task_id IS NOT NULL THEN
    UPDATE task_queue
    SET completed_children = completed_children + 1,
        updated_at = NOW()
    WHERE id = NEW.parent_task_id;

    UPDATE task_queue
    SET status = 'pending', scheduled_for = NOW()
    WHERE id = NEW.parent_task_id
      AND status = 'waiting_for_children'
      AND completed_children >= expected_children;
  END IF;
  RETURN NEW;
END;
$$;

-- Function: recover_orphaned_tasks
-- Recovers tasks stuck in claimed/processing status
CREATE OR REPLACE FUNCTION recover_orphaned_tasks()
RETURNS TABLE(recovered_count integer, failed_count integer)
LANGUAGE plpgsql
AS $$
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
        scheduled_for = CASE WHEN retry_count < max_retries THEN NOW() + ((retry_count + 2) * INTERVAL '1 minute') ELSE scheduled_for END,
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
$$;

-- Trigger: subtask_completion_trigger
-- Fires when a task is completed to update parent task
CREATE TRIGGER subtask_completion_trigger
  AFTER UPDATE OF status ON task_queue
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION on_subtask_complete();
