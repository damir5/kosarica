# Ingestion System Redesign Plan

**Date:** 2026-01-31  
**Status:** Ready for Implementation  
**Goal:** Redesign ingestion to be fully managed by Go service with Node.js as thin proxy

**Key Principles:**
- ✅ Use existing mechanisms (task queue, workers)
- ✅ Simple FIFO queue (no complex priority handling needed now)
- ✅ Idempotent operations (no FORCE flag)
- ✅ Exact date matching only
- ✅ Keep all runs forever, filter from default view

---

## Architecture Principle

**Go Service owns everything. Node.js just proxies.**

- ✅ Go: Queue management, duplicate detection, scheduling, execution
- ✅ Go: Database state, status tracking, error handling
- ✅ Node: Forward requests, return responses, minimal validation
- ❌ No shared business logic between Node and Go
- ❌ No duplicate checks in Node

---

## Current State Analysis

### What Go Already Has (Working Well)

1. **Task Queue System** (`internal/taskqueue/`)
   - PostgreSQL-backed with `claim_tasks()` stored procedure
   - Priority support (0=normal, higher=urgent)
   - Retry logic with max_retries
   - Worker-based processing with polling
   - Orphaned task recovery via sweeper

2. **Semaphore Concurrency** 
   - Global: 10 concurrent ingestion runs (`ingestionSem`)
   - Per-run: 40% of DB pool for parallel file processing

3. **Status Tracking**
   - `ingestion_runs` table with full lifecycle
   - Status: pending → running → completed/failed
   - Progress tracking: files, entries, errors

4. **Async Processing**
   - HTTP returns 202 immediately
   - Goroutine handles actual work
   - No blocking of API requests

### Current Limitations

1. **No Duplicate Detection**: Can trigger same chain+date multiple times
2. **No Scheduling**: All ingestions start immediately via goroutines
3. **UI Blocking**: Node waits for Go response (though Go returns 202 quickly)
4. **No Queue Management**: Direct goroutine spawning, no ordering guarantees

---

## Proposed Architecture

### Flow Overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────────┐
│   UI/User   │────▶│  Node.js     │────▶│   Go Service        │
│             │     │  (Proxy)     │     │   (Owner)           │
└─────────────┘     └──────────────┘     └─────────────────────┘
                                                │
                       ┌────────────────────────┘
                       ▼
              ┌─────────────────┐
              │  Task Queue     │
              │  (PostgreSQL)   │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │  Workers        │
              │  (Poll & Exec)  │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │  Ingestion      │
              │  Pipeline       │
              └─────────────────┘
```

### Request Flow

**1. Schedule Ingestion (UI → Node → Go)**

```http
POST /internal/admin/ingest/:chain
Content-Type: application/json

{
  "targetDate": "2026-01-31",      // Optional, defaults to today
  "force": false,                   // Optional, default false
  "priority": 0                     // Optional, default 0 (normal)
}
```

**2. Go Service Response (Immediate)**

```json
// Success - New ingestion scheduled
{
  "runId": "run_abc123",
  "status": "scheduled",
  "message": "Ingestion scheduled for 2026-01-31",
  "pollUrl": "/internal/ingestion/runs/run_abc123",
  "estimatedStart": "2026-01-31T10:30:00Z"
}

// Success - Existing completed ingestion found
{
  "runId": "run_xyz789",
  "status": "completed",
  "message": "Ingestion already completed for 2026-01-31",
  "pollUrl": "/internal/ingestion/runs/run_xyz789",
  "completedAt": "2026-01-31T08:15:00Z"
}

// Success - Existing running ingestion found
{
  "runId": "run_def456",
  "status": "running",
  "message": "Ingestion already in progress for 2026-01-31",
  "pollUrl": "/internal/ingestion/runs/run_def456",
  "startedAt": "2026-01-31T09:00:00Z"
}

// Error - Duplicate without FORCE
{
  "error": "Ingestion already exists for 2026-01-31",
  "existingRunId": "run_xyz789",
  "status": "completed",
  "resolution": "Set force=true to re-ingest"
}
```

**3. Background Processing (Go Workers)**

Workers poll task queue and execute:
```
1. Claim task from queue (atomic)
2. Update run status: scheduled → running
3. Execute ingestion pipeline
4. Update run status: running → completed/failed
5. Mark task as complete
```

---

## Implementation Plan

### Phase 1: Database Schema (30 min)

**Add to `ingestion_runs` table:**

```sql
-- Track target date for duplicate detection
ALTER TABLE ingestion_runs ADD COLUMN target_date DATE;

-- Track if this was a forced re-ingestion
ALTER TABLE ingestion_runs ADD COLUMN is_forced BOOLEAN DEFAULT FALSE;

-- Index for fast duplicate lookups
CREATE INDEX idx_ingestion_runs_chain_date_status 
ON ingestion_runs(chain_slug, target_date, status);

-- Partial index for active runs only (faster lookups)
CREATE INDEX idx_ingestion_runs_active 
ON ingestion_runs(chain_slug, target_date) 
WHERE status IN ('pending', 'running');
```

**Migration:**
- Backfill `target_date` from `created_at::date` for existing runs
- Set `is_forced = FALSE` for all existing

### Phase 2: Go Service - Duplicate Detection (1 hour)

**New function: `CheckExistingIngestion()`**

```go
// CheckExistingIngestion looks for active or completed ingestion for chain+date
// Returns: (existingRun, status, error)
func CheckExistingIngestion(ctx context.Context, chainSlug string, targetDate string) (*IngestionRun, string, error) {
    queries := sqlcgen.New(database.Pool())
    
    // Look for any run (active or completed) for this chain+date
    run, err := queries.GetIngestionRunByChainAndDate(ctx, sqlcgen.GetIngestionRunByChainAndDateParams{
        ChainSlug: chainSlug,
        TargetDate: targetDate,
    })
    
    if err == pgx.ErrNoRows {
        return nil, "none", nil // No existing ingestion
    }
    if err != nil {
        return nil, "", err
    }
    
    return &run, run.Status, nil
}
```

**New SQL query:**
```sql
-- name: GetIngestionRunByChainAndDate :one
SELECT * FROM ingestion_runs 
WHERE chain_slug = $1 
  AND target_date = $2
  AND status IN ('pending', 'running', 'completed')
ORDER BY 
  CASE status 
    WHEN 'running' THEN 1 
    WHEN 'pending' THEN 2 
    ELSE 3 
  END,
  created_at DESC
LIMIT 1;
```

### Phase 3: Go Service - Task Queue Integration (2 hours)

**Modify `IngestChain` handler:**

```go
func IngestChain(c *gin.Context) {
    chainID := c.Param("chain")
    
    // Parse request
    var req IngestChainRequest
    c.BindJSON(&req)
    
    // Default target date to today
    targetDate := req.TargetDate
    if targetDate == "" {
        targetDate = time.Now().Format("2006-01-02")
    }
    
    // Check for existing ingestion
    existingRun, status, err := CheckExistingIngestion(ctx, chainID, targetDate)
    if err != nil {
        c.JSON(500, gin.H{"error": err.Error()})
        return
    }
    
    // Handle duplicates (idempotent - return existing if found)
    if existingRun != nil {
        // Return existing run info without creating new one
        c.JSON(200, ExistingIngestionResponse{
            RunID: existingRun.ID,
            Status: status,
            Message: fmt.Sprintf("Ingestion already %s for %s", status, targetDate),
            PollURL: fmt.Sprintf("/internal/ingestion/runs/%s", existingRun.ID),
        })
        return
    }
    
    // Create new run record
    runID := cuid2.GeneratePrefixedId("run", cuid2.PrefixedIdOptions{})
    queries.CreateIngestionRun(ctx, sqlcgen.CreateIngestionRunParams{
        ID: runID,
        ChainSlug: chainID,
        Source: "api",
        Status: "pending", // Note: pending, not running
        TargetDate: targetDate,
        // ... other fields
    })
    
    // Schedule task in queue (instead of spawning goroutine directly)
    taskQueue := taskqueue.New(database.Pool())
    taskResult := taskQueue.ScheduleTask(ctx, taskqueue.ScheduleTaskInput{
        TaskType: "ingestion",
        Payload: jsonb.TaskQueuePayload{
            "runId": runID,
            "chainSlug": chainID,
            "targetDate": targetDate,
        },
        Priority: req.Priority, // 0=normal, higher=urgent
        MaxRetries: 3,
    })
    
    if taskResult.Err != nil {
        c.JSON(500, gin.H{"error": "Failed to schedule ingestion"})
        return
    }
    
    // Return immediately with scheduled status
    c.JSON(202, IngestChainScheduledResponse{
        RunID: runID,
        Status: "scheduled",
        Message: fmt.Sprintf("Ingestion scheduled for %s", targetDate),
        PollURL: fmt.Sprintf("/internal/ingestion/runs/%s", runID),
    })
}
```

**Create Ingestion Task Handler:**

```go
// Register in worker setup
worker.RegisterHandler("ingestion", handleIngestionTask)

func handleIngestionTask(ctx context.Context, payload jsonb.TaskQueuePayload) error {
    runID := payload["runId"].(string)
    chainSlug := payload["chainSlug"].(string)
    targetDate := payload["targetDate"].(string)
    
    // Update status to running
    queries.UpdateIngestionRunStatus(ctx, sqlcgen.UpdateIngestionRunStatusParams{
        ID: runID,
        Status: "running",
        StartedAt: pgtype.Timestamp{Time: time.Now(), Valid: true},
    })
    
    // Execute actual ingestion (existing pipeline)
    result, err := pipeline.Run(ctx, chainSlug, targetDate, runID)
    
    // Update final status
    if err != nil {
        markRunFailed(ctx, runID, err.Error())
        return err // Return error to trigger retry
    }
    
    markRunCompleted(ctx, runID, result)
    return nil
}
```

### Phase 4: Go Service - Worker Configuration (30 min)

**Dedicated Ingestion Workers:**

```go
// Start dedicated ingestion workers
ingestionWorker := workers.NewWorker(taskQueue, workers.WorkerConfig{
    WorkerID:   "ingestion-worker",
    TaskTypes:  []string{"ingestion"},
    MaxTasks:   1, // Process one ingestion at a time per worker
    NumWorkers: 5, // 5 concurrent ingestion workers
    PollDelay:  5 * time.Second,
})

ingestionWorker.RegisterHandler("ingestion", handleIngestionTask)
ingestionWorker.Start(ctx)
```

**Why separate workers?**
- Isolation: Ingestion doesn't block other task types
- Resource control: Separate concurrency limits
- Monitoring: Track ingestion-specific metrics

### Phase 5: Node.js - Simplify to Proxy (30 min)

**Current:** Complex logic with retries, error handling, timeout management

**New:** Simple proxy with minimal validation

```typescript
// src/orpc/router/price-service.ts
export const triggerChain = procedure
  .input(
    z.object({
      chain: z.string(),
      targetDate: z.string().optional(),
      force: z.boolean().optional().default(false),
      priority: z.number().optional().default(0),
    })
  )
  .handler(async ({ input }) => {
    // Simple validation only
    if (!input.chain) {
      throw new Error("Chain is required");
    }
    
    // Forward to Go service - no timeout, no retries
    // Go handles everything: duplicate detection, queueing, execution
    const response = await goFetch(
      `/internal/admin/ingest/${input.chain}`,
      {
        method: "POST",
        body: JSON.stringify({
          targetDate: input.targetDate,
          priority: input.priority,
        }),
        // No timeout - let Go respond immediately
      }
    );
    
    // Return whatever Go returns (200 or 202)
    return unwrapResponse(response);
  });
```

**Remove from Node:**
- ❌ Retry logic (handled by Go task queue)
- ❌ Timeout handling (Go returns immediately)
- ❌ Duplicate checks (Go handles this)
- ❌ Complex error handling (Go returns clear responses)

### Phase 6: UI Updates (1 hour)

**New Interface Elements:**

1. **Priority Selector**
   ```
   Priority: [Normal ▼]
             [Low - Background]
             [Normal - Standard]
             [High - Urgent]
   ```

3. **Status Display**
   ```
   Chain: konzum
   Date: 2026-01-31
   Status: scheduled → running → completed
   Position in queue: #3
   Estimated start: 2 minutes
   ```

4. **Queue Overview**
   ```
   Active Ingestions:
   - konzum (2026-01-31) - running - 45% complete
   - lidl (2026-01-31) - scheduled - #2 in queue
   - plodine (2026-01-31) - scheduled - #3 in queue
   ```

**Error Handling:**
- Duplicate without force: Show existing run details, offer "Force Re-ingest" button
- Queue full: Show estimated wait time
- Failed: Show error details, offer "Retry" button

---

## API Contract

### Request

```typescript
POST /internal/admin/ingest/:chain

{
  targetDate?: string;     // ISO date (YYYY-MM-DD), defaults to today
  priority?: number;       // 0=normal (default), higher=more urgent (optional)
}
```

**Note**: No `force` flag needed - repeated runs are idempotent. If same chain+date already exists, return existing run info.

### Response Scenarios

**202 Accepted - New ingestion scheduled**
```json
{
  "runId": "run_abc123",
  "status": "scheduled",
  "message": "Ingestion scheduled for 2026-01-31",
  "pollUrl": "/internal/ingestion/runs/run_abc123",
  "taskId": "task_xyz789"
}
```

**200 OK - Existing ingestion found (idempotent)**
```json
{
  "runId": "run_existing456",
  "status": "completed", // or "running", "pending"
  "message": "Ingestion already completed for 2026-01-31",
  "pollUrl": "/internal/ingestion/runs/run_existing456",
  "completedAt": "2026-01-31T08:15:00Z"
}
```

**400 Bad Request**
```json
{
  "error": "Invalid chain ID: invalid_chain"
}
```

**200 OK - Existing ingestion found (no force)**
```json
{
  "runId": "run_existing456",
  "status": "completed", // or "running", "pending"
  "message": "Ingestion already completed for 2026-01-31",
  "pollUrl": "/internal/ingestion/runs/run_existing456",
  "completedAt": "2026-01-31T08:15:00Z",
  "isForced": false
}
```

**202 Accepted - Forced re-ingestion**
```json
{
  "runId": "run_new789",
  "status": "scheduled",
  "message": "Forced re-ingestion scheduled for 2026-01-31",
  "pollUrl": "/internal/ingestion/runs/run_new789",
  "previousRunId": "run_existing456",
  "isForced": true
}
```

**400 Bad Request**
```json
{
  "error": "Invalid chain ID: invalid_chain"
}
```

**409 Conflict - Duplicate without force**
```json
{
  "error": "Ingestion already exists for 2026-01-31",
  "existingRunId": "run_existing456",
  "status": "completed",
  "resolution": "Set force=true to re-ingest"
}
```

---

## Database Changes

### New Columns

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `target_date` | DATE | NULL | Date being ingested |

### New Indexes

```sql
-- Fast duplicate detection
CREATE INDEX idx_ingestion_runs_chain_date 
ON ingestion_runs(chain_slug, target_date);

-- Active runs only (partial index for speed)
CREATE INDEX idx_ingestion_runs_active 
ON ingestion_runs(chain_slug, target_date, status) 
WHERE status IN ('pending', 'running');
```

### Migration Script

```sql
-- Backfill target_date from created_at
UPDATE ingestion_runs 
SET target_date = created_at::date 
WHERE target_date IS NULL;

-- Set default for new records
ALTER TABLE ingestion_runs 
ALTER COLUMN target_date SET DEFAULT CURRENT_DATE;
```

---

## Worker Architecture

### Task Queue Schema

Uses existing `task_queue` table with payload:

```json
{
  "type": "ingestion",
  "payload": {
    "runId": "run_abc123",
    "chainSlug": "konzum",
    "targetDate": "2026-01-31"
  },
  "priority": 0,
  "maxRetries": 3
}
```

### Worker Pools

| Pool | Workers | Task Types | Purpose |
|------|---------|------------|---------|
| Ingestion | 5 | `ingestion` | Chain ingestion jobs |
| Default | 10 | `cleanup`, `maintenance` | Background tasks |

### Concurrency Limits

| Level | Limit | Mechanism |
|-------|-------|-----------|
| Global ingestions | 10 | Handler semaphore |
| Per-ingestion files | 40% of DB pool | Pipeline semaphore |
| Queue workers | 5 | Worker pool size |

---

## Error Handling & Retries

### Automatic Retries

- **Transient errors** (network, DB): Retry up to 3 times with backoff
- **Permanent errors** (invalid data, auth): Fail immediately
- **Timeout**: Mark as failed, allow manual retry

### Manual Retry

```http
POST /internal/ingestion/runs/:runId/retry
```

Creates new task with same parameters, increments retry count.

### Failed Run Recovery

On startup, Go service checks for:
- Runs stuck in "running" > 30 minutes → mark as failed
- Pending tasks with no worker → reclaim and requeue

---

## Monitoring & Observability

### Metrics to Track

| Metric | Type | Alert Threshold |
|--------|------|-----------------|
| Queue depth | Gauge | > 10 |
| Ingestion duration | Histogram | > 30 min |
| Failed ingestions | Counter | > 5/hour |
| Worker utilization | Gauge | > 80% |
| Duplicate detection rate | Counter | N/A |

### Logs

```
# Scheduling
INFO  Ingestion scheduled  runId=run_abc123 chain=konzum date=2026-01-31 force=false

# Duplicate detected
INFO  Duplicate ingestion detected  chain=konzum date=2026-01-31 existingRun=run_xyz789

# Starting
INFO  Ingestion started  runId=run_abc123 worker=ingestion-worker-3

# Progress
INFO  Ingestion progress  runId=run_abc123 files=50/100 entries=25000/50000

# Completion
INFO  Ingestion completed  runId=run_abc123 duration=15m files=100 entries=50000

# Failure
ERROR Ingestion failed  runId=run_abc123 error="connection timeout" retry=1/3
```

---

## Migration Strategy

### Phase 1: Schema (Day 1)
- Add columns and indexes
- Backfill existing data
- Deploy to production

### Phase 2: Go Service (Day 2)
- Implement duplicate detection
- Add task queue integration
- Deploy alongside existing code (feature flag)

### Phase 3: Testing (Day 3)
- Test duplicate detection
- Test force flag
- Test queue processing
- Verify no regression

### Phase 4: Node.js (Day 4)
- Simplify to proxy
- Update UI
- Deploy

### Phase 5: Cleanup (Day 5)
- Remove old goroutine-based spawning
- Remove feature flag
- Update documentation

---

## Rollback Plan

If issues occur:

1. **Feature flag**: Disable new queue-based processing
2. **Revert Node**: Restore retry/timeout logic temporarily
3. **Database**: New columns are nullable, safe to ignore
4. **Go service**: Keep both code paths for 1 week

---

## Clarifications (Answered)

✅ **1. Priority handling**: Use existing mechanisms. High priority not needed for now but keep the capability.

✅ **2. Queue ordering**: Just schedule one after another (FIFO). No FORCE flag needed - repeated runs are idempotent.

✅ **3. Date granularity**: Exact date only (YYYY-MM-DD).

✅ **4. Retention**: Keep forever, but filter superseded/failed runs from default view.

✅ **5. Notifications**: None for now.

---

## Success Criteria

- [ ] UI returns in < 500ms for all ingestion requests
- [ ] Duplicate chain+date combinations return existing run (idempotent)
- [ ] Queue processes ingestions in order (FIFO)
- [ ] Failed ingestions auto-retry up to 3 times
- [ ] Workers isolated from pricing/management API stability
- [ ] Zero data loss during migration
- [ ] Can handle 50+ concurrent ingestion requests

---

## Estimated Timeline

| Phase | Duration | Owner |
|-------|----------|-------|
| Schema changes | 30 min | Go team |
| Duplicate detection | 1 hour | Go team |
| Task queue integration | 2 hours | Go team |
| Worker configuration | 30 min | Go team |
| Node.js simplification | 30 min | Node team |
| UI updates | 1 hour | Frontend team |
| Testing & QA | 4 hours | All teams |
| **Total** | **~10 hours** | |

---

*Document version: 1.1*  
*Last updated: 2026-01-31*  
*Status: Approved - Ready for Implementation*
