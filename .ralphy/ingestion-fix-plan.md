# Ingestion System Fix - Detailed Implementation Plan

## Overview

This document provides a detailed implementation plan to fix three critical issues in the ingestion pipeline:
1. Infinite retry loops on duplicate key errors
2. Cluster phase variability (40s to 1000s)
3. Database lock timeouts on concurrent runs

---

## Issue 1: Infinite Retry Loop on Duplicate Key Errors

### Root Cause Analysis

**Primary Issue**: The `fail_task()` stored procedure retries tasks unconditionally based on `retry_count < max_retries`, regardless of error type. When a `duplicate key value violates unique constraint` error occurs on `idx_price_tiers_unique`, the same task reruns with identical input data, causing the same constraint violation repeatedly.

**Why This Happens**:
- `idx_price_tiers_unique` constraint: `(target_date, chain_slug, retailer_item_id, price, COALESCE(discount_price, '-1'))`
- The cluster phase generates price tiers with `cuid2.GeneratePrefixedId` (unique per run)
- After `swapPriceSnapshot()` deletes old tiers with `DELETE FROM price_tiers WHERE chain_slug=$1 AND target_date=$2`, the second retry still fails because it attempts to insert the same logical tier (same item_id, price, discount_price) again
- The retry loop: Task fails → `fail_task()` sets status=pending → Worker picks it up → Same error → Up to 4 total attempts (initial + 3 retries)

**Current Behavior**:
```
Worker.processTask() line 193:
  w.queue.FailTask(ctx, task.ID, handlerErr.Error(), true)  // Always passes true
                                                              // regardless of error type
```

### Fix: Error Type Detection + Smart Retry Logic

**File**: `/workspace/services/price-service/internal/workers/worker.go`

**Strategy**: Inspect error messages to determine if a retry is futile. For constraint violations and duplicate key errors, pass `shouldRetry=false` to `fail_task()` to mark as final failure immediately.

**Implementation**:

```go
// Add at top of worker.go
import (
	"strings"
	// ... existing imports
)

// isRetryableError checks if an error should be retried
// Returns false for data constraint violations that won't be fixed by retry
func isRetryableError(errMsg string) bool {
	// List of non-retryable database errors
	nonRetryablePatterns := []string{
		"duplicate key value violates unique constraint",
		"violates unique constraint",
		"violates check constraint",
		"violates not-null constraint",
		"violates foreign key constraint",
		"violates exclusion constraint",
	}

	errLower := strings.ToLower(errMsg)
	for _, pattern := range nonRetryablePatterns {
		if strings.Contains(errLower, strings.ToLower(pattern)) {
			return false
		}
	}

	return true
}

// In processTask() function, replace lines 192-200:
// OLD CODE:
//	if handlerErr != nil {
//		w.queue.FailTask(ctx, task.ID, handlerErr.Error(), true)
//		...
//	}

// NEW CODE:
	if handlerErr != nil {
		shouldRetry := isRetryableError(handlerErr.Error())
		w.queue.FailTask(ctx, task.ID, handlerErr.Error(), shouldRetry)

		logEvent := log.Error().
			Str("task_id", task.ID).
			Str("run_id", runID).
			Err(handlerErr).
			Bool("will_retry", shouldRetry)

		if !shouldRetry {
			logEvent.Msg("Task failed with non-retryable error (constraint violation)")
		} else {
			logEvent.Msg("Task failed and will retry")
		}
		return
	}
```

**Risk Assessment**:
- **Low**: Only affects retry behavior; doesn't change core logic
- **Testing**: Add unit tests for `isRetryableError()` with various constraint violation messages
- **Backward Compatibility**: Existing successfully retried tasks unaffected; constraint violations now fail faster instead of retrying futilely

---

## Issue 2: Cluster Phase Variability (40s to 1000s)

### Root Cause Analysis

**Problem**: Three sub-phases run without per-phase timing instrumentation:
1. Archive loading (Phase 1)
2. Data grouping (Phase 2)
3. Database writes (Phase 3)

Currently only total duration is logged. Need detailed breakdown to identify bottleneck.

**Current Implementation** (task_cluster.go lines 120-223):
- Phase 1: `loadAndParseArchives()` - loads archives from storage
- Phase 2: `deduplicateItems()` + `groupByPriceTier()` - in-memory clustering
- Phase 3: `batchWriteToDatabase()` - batch inserts and atomic swap

Timing logs exist but are too coarse-grained to pinpoint which phase stalls.

### Fix: Add Sub-Phase Metrics + Memory Tracking

**File**: `/workspace/services/price-service/internal/handlers/task_cluster.go`

**Strategy**:
1. Add timing for each sub-operation within phases
2. Track memory usage per phase
3. Log detailed counts to identify data volume issues
4. Add optional instrumentation hooks for monitoring integration

**Implementation**:

```go
// Add new type for detailed phase metrics (after line 66)
type phaseMetrics struct {
	startTime      time.Time
	endTime        time.Time
	duration       time.Duration
	rowsProcessed  int
	objectsCreated int
	memoryMB       int64
	details        map[string]interface{}
}

func (pm *phaseMetrics) Record(name string, endTime time.Time, rowsProcessed int) {
	pm.endTime = endTime
	pm.duration = pm.endTime.Sub(pm.startTime)
	pm.rowsProcessed = rowsProcessed

	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)
	pm.memoryMB = int64(memStats.Alloc / 1024 / 1024)

	log.Info().
		Str("phase", name).
		Dur("duration", pm.duration).
		Int("rows_processed", pm.rowsProcessed).
		Int64("memory_mb", pm.memoryMB).
		Interface("details", pm.details).
		Msg("Phase metrics")
}

// Modify loadAndParseArchives to add sub-phase timing (starting line 247)
// ADD: Track per-archive parsing time and size

func loadAndParseArchives(
	ctx context.Context,
	adapter interface{},
	storageBackend storage.Storage,
	runID string,
) ([]storeRowData, []string, *loadStats, error) {
	stats := &loadStats{}
	var allData []storeRowData
	storeIdentifierSet := make(map[string]struct{})

	// Track parsing time per archive
	archiveTimes := make(map[string]time.Duration)
	archiveSizes := make(map[string]int)

	for i, archive := range archives {
		archiveStartTime := time.Now()

		// Load archive content from storage
		content, err := storageBackend.Get(ctx, archive.ArchivePath)
		if err != nil {
			log.Warn().Err(err).
				Str("archiveId", archive.ID).
				Str("archivePath", archive.ArchivePath).
				Int("sizeBytes", len(content)).
				Msg("Failed to load archive, skipping")
			stats.archivesSkipped++
			continue
		}

		archiveSizes[archive.ID] = len(content)

		// Parse archive content
		fileType := types.FileType(archive.OriginalFormat)
		var parseResult *types.ParseResult

		parseStartTime := time.Now()
		if fileType == types.FileTypeZIP {
			parseResult, err = parseZipArchive(ctx, adapter, content, archive.Filename)
		} else {
			parseResult, err = parseSingleFile(adapter, content, archive.Filename)
		}
		parseDuration := time.Since(parseStartTime)

		if err != nil {
			log.Warn().Err(err).
				Str("archiveId", archive.ID).
				Str("filename", archive.Filename).
				Dur("parse_duration", parseDuration).
				Msg("Failed to parse archive, skipping")
			stats.archivesSkipped++
			continue
		}

		// Convert parsed rows to storeRowData
		for _, row := range parseResult.Rows {
			if row.StoreIdentifier != "" {
				storeIdentifierSet[row.StoreIdentifier] = struct{}{}
			}
			allData = append(allData, storeRowData{
				StoreIdentifier: row.StoreIdentifier,
				Row:             row,
			})
		}

		stats.archivesLoaded++
		archiveTimes[archive.ID] = time.Since(archiveStartTime)

		if (i+1)%10 == 0 {
			log.Info().
				Str("runId", runID).
				Int("archivesLoaded", i+1).
				Int("totalArchives", len(archives)).
				Int("rowsLoaded", len(allData)).
				Msg("Archive loading progress")
		}
	}

	// Log per-archive timing for slow archives
	var slowestArchives []struct{id string; duration time.Duration}
	for id, dur := range archiveTimes {
		if dur > 5*time.Second {
			slowestArchives = append(slowestArchives, struct{id string; duration time.Duration}{id, dur})
		}
	}
	if len(slowestArchives) > 0 {
		log.Warn().
			Str("runId", runID).
			Int("slowArchiveCount", len(slowestArchives)).
			Interface("slowestArchives", slowestArchives).
			Msg("Some archives took >5s to parse")
	}

	// Convert store identifier set to slice
	storeIdentifiers := make([]string, 0, len(storeIdentifierSet))
	for id := range storeIdentifierSet {
		storeIdentifiers = append(storeIdentifiers, id)
	}

	return allData, storeIdentifiers, stats, nil
}

// Enhance deduplicateItems with timing (line 400)
func deduplicateItems(allData []storeRowData) map[itemKey]itemData {
	startTime := time.Now()
	items := make(map[itemKey]itemData)

	for _, sd := range allData {
		row := sd.Row
		externalID := ""
		if row.ExternalID != nil {
			externalID = *row.ExternalID
		}
		key := itemKey{
			ExternalID: externalID,
		}
		if len(row.Barcodes) > 0 {
			key.Barcode = row.Barcodes[0]
		}

		if key.ExternalID == "" && key.Barcode == "" {
			continue
		}

		if _, exists := items[key]; !exists {
			items[key] = itemData{
				Name:        row.Name,
				ExternalID:  externalID,
				Barcodes:    row.Barcodes,
				UnitPrice:   row.UnitPrice,
				AnchorPrice: row.AnchorPrice,
			}
		}
	}

	duration := time.Since(startTime)
	log.Info().
		Dur("dedup_duration", duration).
		Int("input_rows", len(allData)).
		Int("unique_items", len(items)).
		Float64("avg_duplication_ratio", float64(len(allData))/float64(len(items))).
		Msg("Item deduplication complete")

	return items
}

// Enhance groupByPriceTier with timing (line 436)
func groupByPriceTier(allData []storeRowData) (map[priceTierKey]struct{}, []storePriceRef) {
	startTime := time.Now()
	tiers := make(map[priceTierKey]struct{})
	var refs []storePriceRef

	for _, sd := range allData {
		row := sd.Row
		externalID := ""
		if row.ExternalID != nil {
			externalID = *row.ExternalID
		}
		iKey := itemKey{
			ExternalID: externalID,
		}
		if len(row.Barcodes) > 0 {
			iKey.Barcode = row.Barcodes[0]
		}

		if iKey.ExternalID == "" && iKey.Barcode == "" {
			continue
		}

		discountPrice := -1
		if row.DiscountPrice != nil {
			discountPrice = *row.DiscountPrice
		}

		ptKey := priceTierKey{
			ItemKey:       iKey,
			Price:         row.Price,
			DiscountPrice: discountPrice,
		}

		tiers[ptKey] = struct{}{}

		refs = append(refs, storePriceRef{
			StoreIdentifier: sd.StoreIdentifier,
			ItemKey:         iKey,
			PriceTierKey:    ptKey,
			InStock:         true,
		})
	}

	duration := time.Since(startTime)
	log.Info().
		Dur("grouping_duration", duration).
		Int("input_rows", len(allData)).
		Int("unique_tiers", len(tiers)).
		Int("store_refs", len(refs)).
		Float64("avg_refs_per_tier", float64(len(refs))/float64(len(tiers))).
		Msg("Price tier grouping complete")

	return tiers, refs
}

// Enhance swapPriceSnapshot with sub-operation timing (line 1117)
func swapPriceSnapshot(
	ctx context.Context,
	pool *pgxpool.Pool,
	chainSlug string,
	targetDate time.Time,
	tierRows []tierCopyRow,
	refRows []refCopyRow,
) (*swapStats, error) {
	txStartTime := time.Now()

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// ... existing session config code ...

	// LOCK ACQUISITION TIMING
	lockStartTime := time.Now()
	lockKey := fmt.Sprintf("%s:%s", chainSlug, targetDate.Format("2006-01-02"))
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, lockKey); err != nil {
		return nil, fmt.Errorf("failed to acquire advisory lock: %w", err)
	}
	lockDuration := time.Since(lockStartTime)
	log.Info().
		Dur("lock_duration", lockDuration).
		Str("lock_key", lockKey).
		Msg("Advisory lock acquired")

	// TIER COPY TIMING
	if len(tierRows) > 0 {
		tierCopyStartTime := time.Now()
		copyCount, err := tx.CopyFrom(
			ctx,
			pgx.Identifier{"staging_price_tiers"},
			// ... existing columns ...
		)
		tierCopyDuration := time.Since(tierCopyStartTime)
		if err != nil {
			return nil, fmt.Errorf("failed to COPY staging_price_tiers: %w", err)
		}
		log.Info().
			Int64("copied", copyCount).
			Dur("copy_duration", tierCopyDuration).
			Float64("rows_per_sec", float64(copyCount)/tierCopyDuration.Seconds()).
			Msg("COPY to staging_price_tiers complete")
	}

	// REF COPY TIMING
	if len(refRows) > 0 {
		refCopyStartTime := time.Now()
		copyCount, err := tx.CopyFrom(
			ctx,
			pgx.Identifier{"staging_store_price_refs"},
			// ... existing columns ...
		)
		refCopyDuration := time.Since(refCopyStartTime)
		if err != nil {
			return nil, fmt.Errorf("failed to COPY staging_store_price_refs: %w", err)
		}
		log.Info().
			Int64("copied", copyCount).
			Dur("copy_duration", refCopyDuration).
			Float64("rows_per_sec", float64(copyCount)/refCopyDuration.Seconds()).
			Msg("COPY to staging_store_price_refs complete")
	}

	// DELETE TIER TIMING
	deleteTierStartTime := time.Now()
	_, err = tx.Exec(ctx, `
		DELETE FROM price_tiers
		WHERE chain_slug = $1 AND target_date = $2
	`, chainSlug, targetDate)
	deleteTierDuration := time.Since(deleteTierStartTime)
	if err != nil {
		return nil, fmt.Errorf("failed to delete price_tiers: %w", err)
	}
	log.Info().
		Dur("delete_tier_duration", deleteTierDuration).
		Msg("DELETE price_tiers complete")

	// DELETE REF TIMING
	deleteRefStartTime := time.Now()
	_, err = tx.Exec(ctx, `
		DELETE FROM store_price_refs spr
		USING stores s
		WHERE spr.store_id = s.id
		  AND s.chain_slug = $1
		  AND spr.target_date = $2
	`, chainSlug, targetDate)
	deleteRefDuration := time.Since(deleteRefStartTime)
	if err != nil {
		return nil, fmt.Errorf("failed to delete store_price_refs: %w", err)
	}
	log.Info().
		Dur("delete_ref_duration", deleteRefDuration).
		Msg("DELETE store_price_refs complete")

	// INSERT TIER TIMING
	insertTierStartTime := time.Now()
	tag, err := tx.Exec(ctx, `
		INSERT INTO price_tiers (...)
		SELECT ... FROM staging_price_tiers
	`)
	insertTierDuration := time.Since(insertTierStartTime)
	if err != nil {
		return nil, fmt.Errorf("failed to insert price_tiers: %w", err)
	}
	tiersInserted := int(tag.RowsAffected())
	log.Info().
		Int("tiers_inserted", tiersInserted).
		Dur("insert_tier_duration", insertTierDuration).
		Float64("rows_per_sec", float64(tiersInserted)/insertTierDuration.Seconds()).
		Msg("INSERT price_tiers complete")

	// INSERT REF TIMING
	insertRefStartTime := time.Now()
	tag, err = tx.Exec(ctx, `
		INSERT INTO store_price_refs (...)
		SELECT ... FROM staging_store_price_refs
	`)
	insertRefDuration := time.Since(insertRefStartTime)
	if err != nil {
		return nil, fmt.Errorf("failed to insert store_price_refs: %w", err)
	}
	refsInserted := int(tag.RowsAffected())
	log.Info().
		Int("refs_inserted", refsInserted).
		Dur("insert_ref_duration", insertRefDuration).
		Float64("rows_per_sec", float64(refsInserted)/insertRefDuration.Seconds()).
		Msg("INSERT store_price_refs complete")

	// COMMIT TIMING
	commitStartTime := time.Now()
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit snapshot swap: %w", err)
	}
	commitDuration := time.Since(commitStartTime)

	totalDuration := time.Since(txStartTime)
	log.Info().
		Dur("lock_duration", lockDuration).
		Dur("total_copy_duration", time.Duration(0)). // Sum tier + ref copy
		Dur("total_delete_duration", deleteTierDuration.Add(deleteRefDuration)).
		Dur("total_insert_duration", insertTierDuration.Add(insertRefDuration)).
		Dur("commit_duration", commitDuration).
		Dur("total_transaction_duration", totalDuration).
		Msg("COPY + atomic swap complete")

	return &swapStats{tiersInserted: tiersInserted, refsInserted: refsInserted}, nil
}
```

**Risk Assessment**:
- **Very Low**: Only adds logging; no functional changes
- **Performance Impact**: Negligible; `runtime.ReadMemStats()` called only at phase boundaries
- **Testing**: Verify logs appear with expected structure; add test case with large data volume

---

## Issue 3: Database Lock Timeouts on Concurrent Runs

### Root Cause Analysis

**Problem**: `swapPriceSnapshot()` uses PostgreSQL advisory locks keyed by `(chain_slug, target_date)`. When multiple workers process the same chain/date simultaneously, lock contention occurs. The 30-second lock timeout is exceeded, causing:

```
Error: canceling statement due to lock timeout (delete price_tiers)
```

**Current Lock Mechanism** (task_cluster.go line 1141):
```sql
SELECT pg_advisory_xact_lock(hashtext($1))  -- where $1 = "chain_slug:YYYY-MM-DD"
```

**Why It's a Problem**:
- Multiple `HandleClusterTask()` calls for same chain/date run concurrently
- All wait for the same advisory lock
- Lock timeout (30s) is hit before lock can be acquired
- Task fails and is retried (see Issue 1)

### Fix: Queue-Based Serialization + Lock-Free Optimization

**Strategy**: Prevent concurrent cluster tasks for the same chain/date pair by implementing a task-level serialization mechanism.

**File 1**: `/workspace/services/price-service/schema.sql`

Add a new table and function to prevent concurrent cluster tasks:

```sql
-- Add new table for tracking active cluster operations (add to schema.sql)
CREATE TABLE IF NOT EXISTS active_ingestion_operations (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    chain_slug TEXT NOT NULL,
    target_date DATE NOT NULL,
    task_id TEXT NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    CONSTRAINT unique_active_op UNIQUE (chain_slug, target_date)
);

CREATE INDEX idx_active_ops_chain_date ON active_ingestion_operations(chain_slug, target_date);
CREATE INDEX idx_active_ops_task_id ON active_ingestion_operations(task_id);

-- Function to check and acquire operation lock atomically
CREATE FUNCTION acquire_cluster_lock(
    p_chain_slug TEXT,
    p_target_date DATE,
    p_task_id TEXT
) RETURNS BOOLEAN AS $$
BEGIN
    -- Try to insert; if unique constraint violation, another task has it
    INSERT INTO active_ingestion_operations (chain_slug, target_date, task_id)
    VALUES (p_chain_slug, p_target_date, p_task_id)
    ON CONFLICT (chain_slug, target_date) DO NOTHING;

    -- Check if we got the lock
    RETURN EXISTS(
        SELECT 1 FROM active_ingestion_operations
        WHERE chain_slug = p_chain_slug
          AND target_date = p_target_date
          AND task_id = p_task_id
    );
END;
$$ LANGUAGE plpgsql;

-- Function to release operation lock
CREATE FUNCTION release_cluster_lock(
    p_chain_slug TEXT,
    p_target_date DATE,
    p_task_id TEXT
) RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM active_ingestion_operations
    WHERE chain_slug = p_chain_slug
      AND target_date = p_target_date
      AND task_id = p_task_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;
```

**File 2**: `/workspace/services/price-service/internal/handlers/task_cluster.go`

Modify `HandleClusterTask()` to use application-level queue instead of advisory lock:

```go
// Add near top of HandleClusterTask function (after payload extraction, line 87)
import (
	"time"
	"fmt"
	// ... existing imports
)

// Attempt to acquire cluster lock before proceeding
lockAcquired, err := acquireClusterLock(ctx, database.Pool(), chainSlug, targetDate, taskID)
if err != nil {
	return fmt.Errorf("failed to check cluster lock: %w", err)
}

if !lockAcquired {
	// Another task is already processing this chain/date
	// Re-queue this task after a delay
	log.Warn().
		Str("chain", chainSlug).
		Time("targetDate", targetDate).
		Str("taskId", taskID).
		Msg("Another cluster task already processing this chain/date; re-queueing")

	// Re-queue with 30 second delay
	return requeueClusterTask(ctx, tq, taskID, 30*time.Second)
}

// Ensure lock is released when done
defer func() {
	if err := releaseClusterLock(ctx, database.Pool(), chainSlug, targetDate, taskID); err != nil {
		log.Error().Err(err).Msg("Failed to release cluster lock")
	}
}()

log.Info().
	Str("chain", chainSlug).
	Time("targetDate", targetDate).
	Str("taskId", taskID).
	Msg("Acquired cluster operation lock")

// ... rest of HandleClusterTask proceeds ...
```

Add helper functions:

```go
// Add after HandleClusterTask function definition

// acquireClusterLock attempts to acquire an operation lock for this chain/date
func acquireClusterLock(
	ctx context.Context,
	pool *pgxpool.Pool,
	chainSlug string,
	targetDate time.Time,
	taskID string,
) (bool, error) {
	var acquired bool
	err := pool.QueryRow(ctx, `
		SELECT acquire_cluster_lock($1, $2, $3)
	`, chainSlug, targetDate.Format("2006-01-02"), taskID).Scan(&acquired)

	if err != nil {
		return false, err
	}

	return acquired, nil
}

// releaseClusterLock releases the operation lock for this chain/date
func releaseClusterLock(
	ctx context.Context,
	pool *pgxpool.Pool,
	chainSlug string,
	targetDate time.Time,
	taskID string,
) error {
	_, err := pool.Exec(ctx, `
		SELECT release_cluster_lock($1, $2, $3)
	`, chainSlug, targetDate.Format("2006-01-02"), taskID)

	return err
}

// requeueClusterTask re-schedules a cluster task after a delay
func requeueClusterTask(
	ctx context.Context,
	tq *taskqueue.TaskQueue,
	taskID string,
	delay time.Duration,
) error {
	// Update task's scheduled_for to delay from now
	pool := tq.GetPool()
	scheduledFor := time.Now().Add(delay)

	_, err := pool.Exec(ctx, `
		UPDATE task_queue
		SET status = 'pending',
		    scheduled_for = $1,
		    updated_at = NOW()
		WHERE id = $2
	`, scheduledFor, taskID)

	return err
}
```

**File 3**: Modify `swapPriceSnapshot()` to remove advisory lock requirement

In `/workspace/services/price-service/internal/handlers/task_cluster.go`, line 1142:

```go
// REMOVE this advisory lock call (line 1142):
// if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, lockKey); err != nil {
//     return nil, fmt.Errorf("failed to acquire advisory lock: %w", err)
// }

// Instead, rely on application-level clustering lock acquired above
// The lock has already been acquired before calling swapPriceSnapshot
log.Info().
	Str("chain", chainSlug).
	Time("targetDate", targetDate).
	Msg("Using application-level cluster lock (no advisory lock needed)")

// ALSO: Reduce lock_timeout since we're only holding lock briefly for deletes/inserts
if _, err := tx.Exec(ctx, `SET LOCAL lock_timeout = '10s'`); err != nil {
	return nil, fmt.Errorf("failed to set lock_timeout: %w", err)
}
```

**Risk Assessment**:
- **Medium**: Introduces new table and requires database migration
- **Testing**:
  - Unit test: Verify only one task acquires lock for a (chain_slug, target_date) pair
  - Integration test: Run multiple cluster tasks concurrently, verify proper queuing
  - Verify cleanup: Ensure locks are released on both success and error paths
- **Concurrency**: Uses UNIQUE constraint for atomic lock (PostgreSQL constraint enforcement is atomic)
- **Cleanup**: Add a cleanup job to remove stale locks older than 2 hours (in case of crashed workers)

**Add Cleanup Job** (add to `schema.sql` or migration):

```sql
-- Cleanup function for stale cluster locks
CREATE FUNCTION cleanup_stale_cluster_locks(p_max_age INTERVAL DEFAULT '2 hours') RETURNS integer AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM active_ingestion_operations
    WHERE started_at < NOW() - p_max_age;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Run cleanup every 30 minutes via cron job or background worker
-- INSERT INTO cron_jobs (id, name, cron_expression, task_type, task_payload, enabled)
-- VALUES ('cleanup_cluster_locks', 'Cleanup stale cluster locks', '*/30 * * * *',
--         'cleanup_task', '{"type":"cleanup_stale_cluster_locks"}', true);
```

---

## Summary Table

| Issue | Root Cause | Fix Type | File | Risk | Effort |
|-------|-----------|----------|------|------|--------|
| Infinite Retries | Always retry regardless of error type | Smart retry logic | `worker.go` | Low | Low |
| Cluster Slowness | No per-phase timing | Add detailed metrics | `task_cluster.go` | Very Low | Low |
| Lock Timeouts | Advisory lock contention | Queue-based serialization | `schema.sql`, `task_cluster.go` | Medium | Medium |

---

## Implementation Order

1. **Phase 1 (Immediate)**: Fix infinite retries
   - Implement error type detection in `worker.go`
   - Add unit tests
   - Reduces wasted retries immediately

2. **Phase 2 (Short-term)**: Add timing instrumentation
   - Add sub-phase metrics to `task_cluster.go`
   - Deploy and collect baseline data
   - Identifies actual bottlenecks before further optimization

3. **Phase 3 (Medium-term)**: Fix lock timeouts
   - Create database migration for new table
   - Implement application-level queue in `task_cluster.go`
   - Add integration tests
   - Verifies concurrent cluster operations work correctly

---

## Testing Strategy

### Unit Tests
- `TestIsRetryableError()`: Various constraint violation messages
- `TestAcquireClusterLock()`: Single task acquires, second task blocked
- `TestReleaseClusterLock()`: Lock properly released

### Integration Tests
- Run 5 concurrent cluster tasks for same chain/date
- Verify only one runs at a time (via lock acquisition log)
- Verify others are re-queued with proper delay
- Verify all eventually complete successfully

### Load Test
- Process 20,605 items with timing
- Verify Phase 1-3 breakdown
- Identify if archive parsing is bottleneck (expected: 40-200s normal, 400-1000s indicates lock contention or storage latency)

---

## Monitoring/Alerting

After fixes, add alerts for:
1. **Constraint violation failures**: Count non-retryable failures (should be near zero if data clean)
2. **Cluster phase duration**: Alert if Phase 1 > 5 min, Phase 3 > 2 min
3. **Lock wait queue**: Alert if cluster lock held > 5 minutes
4. **Re-queue rate**: Alert if >10% of cluster tasks are re-queued

---

## Files Modified Summary

1. `/workspace/services/price-service/schema.sql` - Add active_ingestion_operations table + functions
2. `/workspace/services/price-service/internal/workers/worker.go` - Smart retry logic
3. `/workspace/services/price-service/internal/handlers/task_cluster.go` - Timing instrumentation + lock management
4. Migration file - Database schema changes (if using migration tool)
