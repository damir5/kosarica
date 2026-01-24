-- Task queue table for cross-service worker coordination
CREATE TABLE task_queue (
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
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT task_queue_status_check CHECK (
    status IN ('pending', 'claimed', 'processing', 'completed', 'failed', 'cancelled')
  ),
  CONSTRAINT task_queue_priority_check CHECK (priority >= 0 AND priority <= 10)
);

CREATE INDEX idx_task_queue_status ON task_queue(status);
CREATE INDEX idx_task_queue_scheduled ON task_queue(scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_task_queue_worker ON task_queue(worker_id) WHERE status = 'processing';
CREATE INDEX idx_task_queue_type_priority ON task_queue(task_type, priority DESC, scheduled_for) WHERE status = 'pending';

-- Functions for transaction-safe task operations
CREATE OR REPLACE FUNCTION claim_tasks(
  worker_id TEXT,
  task_types TEXT[],
  max_tasks INTEGER
)
RETURNS TABLE (
  id TEXT,
  task_type TEXT,
  payload JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT id, task_type, payload
  FROM task_queue
  WHERE status = 'pending'
    AND scheduled_for <= NOW()
    AND (task_types IS NULL OR task_type = ANY(task_types))
  ORDER BY priority DESC, scheduled_for ASC
  FOR UPDATE SKIP LOCKED
  LIMIT max_tasks;
  
  -- Update claimed tasks status
  UPDATE task_queue
  SET status = 'claimed',
      started_at = NOW(),
      worker_id = $1,
      updated_at = NOW()
  WHERE id IN (SELECT id FROM task_queue WHERE status = 'pending' FOR UPDATE SKIP LOCKED LIMIT max_tasks);
  
  RETURN;
END;
$$ LANGUAGE plpgsql;

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
  WHERE id = $1 AND status = 'processing';
  
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

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
        scheduled_for = NOW() + (retry_count * 60)::INTERVAL, -- Exponential backoff: 1min, 2min, 3min
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
$$ LANGUAGE plpgsql;

-- Cleanup function to remove old completed tasks
CREATE OR REPLACE FUNCTION cleanup_old_tasks(days_to_keep INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
BEGIN
  DELETE FROM task_queue
  WHERE status = 'completed'
    AND completed_at < NOW() - (days_to_keep || ' days')::INTERVAL;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;
