# Task Queue Implementation

## Overview
PostgreSQL-based task queue supporting workers in both Go and Node.js, using transaction-safe operations with `SELECT FOR UPDATE SKIP LOCKED`.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   PostgreSQL Task Queue                     │
│  ┌───────────────────────────────────────────────────┐  │
│  │  task_queue table                           │  │  │
│  │  - id, task_type, payload, status         │  │  │
│  │  - worker_id, priority, retry_count         │  │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
          ┌──────────────┴──────────────┐
          │                             │
     ┌────▼────┐              ┌────────▼────────┐
     │Go Worker │              │Node.js Worker  │
     │(internal/│              │(src/lib/)     │
     │workers/) │              │taskqueue/)    │
     └───────────┘              └────────────────┘
```

## SQL Schema

### Table: `task_queue`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (PK) | Task UUID |
| task_type | TEXT | Task type (ingestion, rerun, cleanup) |
| payload | JSONB | Task payload |
| priority | INTEGER | Task priority (0-10, higher = more important) |
| status | TEXT | pending, claimed, processing, completed, failed, cancelled |
| scheduled_for | TIMESTAMP | When to execute task |
| started_at | TIMESTAMP | When processing started |
| completed_at | TIMESTAMP | When task completed |
| failed_at | TIMESTAMP | When task failed |
| worker_id | TEXT | Worker instance ID |
| retry_count | INTEGER | Number of retries |
| max_retries | INTEGER | Max retry attempts |
| error_message | TEXT | Error details |
| created_at | TIMESTAMP | Task creation time |
| updated_at | TIMESTAMP | Last update time |

### PostgreSQL Functions

#### `claim_tasks(worker_id, task_types[], max_tasks)`
- Returns tasks for worker with `FOR UPDATE SKIP LOCKED`
- Atomic: selects AND updates in single transaction
- Multiple workers won't claim same tasks

#### `complete_task(task_id, result_jsonb)`
- Marks task as completed
- Returns FALSE if task wasn't in 'processing' state

#### `fail_task(task_id, error_message, retry)`
- Retries task if `retry_count < max_retries`
- Marks as failed if retries exhausted
- Exponential backoff: `scheduled_for = NOW() + (retry_count * 60) seconds`

#### `cleanup_old_tasks(days_to_keep)`
- Removes completed tasks older than N days

## Usage Examples

### Go Service

#### Schedule a task (from API handler):
```go
queue := taskqueue.New(database.Pool())

result := queue.ScheduleTask(ctx, taskqueue.ScheduleTaskInput{
    TaskType:   taskqueue.TaskTypeIngestion,
    Payload:     map[string]interface{}{"chainId": "konzum", "targetDate": "2026-01-23"},
    Priority:    5,
    ScheduledAt: time.Now(),
    MaxRetries: 3,
})

log.Printf("Scheduled task: %s\n", result.ID)
```

#### Worker integration (in main.go):
```go
import "github.com/kosarica/price-service/internal/workers"

func main() {
    ctx := context.Background()
    
    // Start worker goroutine
    go func() {
        if err := workers.StartIngestionWorker(ctx); err != nil {
            log.Printf("[ERROR] Worker failed: %v", err)
        }
    }()
    
    // Start HTTP server...
    srv.ListenAndServe()
}
```

### Node.js Service

#### Schedule a task:
```typescript
import { scheduleTask, TaskType } from '@/lib/taskqueue';

const { id } = await scheduleTask({
  taskType: 'ingestion' as TaskType,
  payload: { chainId: 'konzum', targetDate: '2026-01-23' },
  priority: 5,
  maxRetries: 3,
});

console.log('Scheduled task:', id);
```

#### Worker integration:
```typescript
import { createIngestionWorker } from '@/lib/taskqueue/ingestion-worker';

// In your app startup:
const worker = createIngestionWorker();
worker.start(); // Runs forever

// On graceful shutdown:
worker.stop();
```

## Transaction Safety

### What `FOR UPDATE SKIP LOCKED` does:

1. **SELECT**: Find pending tasks ordered by priority and scheduled time
2. **FOR UPDATE**: Lock selected rows for this transaction
3. **SKIP LOCKED**: Skip rows already locked by other workers
4. **UPDATE**: Mark tasks as 'claimed' with worker_id
5. **RETURN**: Return claimed tasks to worker

### Why this works:

- Multiple workers can run same code
- Database ensures only one worker gets each task
- If worker crashes, tasks become available again (after lock timeout)
- No race conditions between SELECT and UPDATE

## Testing Transaction Safety

### Test 1: Concurrent claiming
```sql
-- Terminal 1
BEGIN;
SELECT * FROM claim_tasks('worker-1', ARRAY['ingestion'], 1);
-- Returns: task_123
COMMIT;

-- Terminal 2 (simultaneous)
BEGIN;
SELECT * FROM claim_tasks('worker-2', ARRAY['ingestion'], 1);
-- Returns: task_456 (different task!)
COMMIT;
```

### Test 2: Worker crash recovery
```sql
-- Worker crashes while processing
BEGIN;
SELECT * FROM claim_tasks('worker-1', ARRAY['ingestion'], 1);
-- Returns: task_789
-- Worker crashes here (no COMMIT)

-- After crash, locks are released
-- Task is still 'claimed' but worker is gone

-- Recovery: mark orphaned 'claimed' tasks back to 'pending'
UPDATE task_queue
SET status = 'pending',
    worker_id = NULL
WHERE status = 'claimed'
  AND started_at < NOW() - INTERVAL '10 minutes';
```

## Migration

Run migration to create tables and functions:

```bash
cd /workspace
pnpm db:migrate
```

Or apply SQL directly:

```bash
psql -U kosarica -d kosarica -f /workspace/src/db/tasks/migrate.ts
```

## Files

| File | Description |
|------|-------------|
| `/workspace/src/db/tasks/migrate.ts` | TypeScript migration for Drizzle |
| `/workspace/src/db/tasks/schema.sql` | Pure SQL version |
| `/workspace/src/lib/taskqueue/index.ts` | Node.js task queue API |
| `/workspace/src/lib/taskqueue/worker.ts` | Node.js worker class |
| `/workspace/src/lib/taskqueue/ingestion-worker.ts` | Node.js ingestion worker |
| `/workspace/services/price-service/internal/taskqueue/types.go` | Go task queue types |
| `/workspace/services/price-service/internal/taskqueue/queue.go` | Go task queue implementation |
| `/workspace/services/price-service/internal/workers/worker.go` | Go worker base class |
| `/workspace/services/price-service/internal/workers/integration.go` | Go worker integration |

## Monitoring

### Query task queue stats:
```sql
SELECT 
    status,
    COUNT(*) as count
FROM task_queue
GROUP BY status;

SELECT 
    task_type,
    AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds
FROM task_queue
WHERE status = 'completed'
  AND completed_at > NOW() - INTERVAL '1 hour'
GROUP BY task_type;
```

### Check for orphaned tasks:
```sql
SELECT COUNT(*)
FROM task_queue
WHERE status = 'claimed'
  AND started_at < NOW() - INTERVAL '10 minutes';
```
