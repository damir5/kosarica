# Raw SQL Migration Plan: SQLC and Drizzle

## Executive Summary

This codebase uses a polyglot architecture:
- **TypeScript/JavaScript**: Drizzle ORM + raw SQL via `db.execute(sql`...`)`
- **Go**: sqlc code generation + raw pgx queries

**Current Raw SQL Count:** ~60 statements across 13 files

---

## Current State Analysis

### TypeScript/JavaScript Raw SQL (~35 statements)

| File | Lines | Type | Complexity |
|------|-------|------|------------|
| `src/orpc/router/products.ts` | 97-545 | SELECT CTEs, JSON aggregation | High |
| `src/lib/taskqueue/index.ts` | 30-92 | Task queue ops | Medium |
| `src/jobs/cron/executor.ts` | 46-70 | FOR UPDATE SKIP LOCKED | High |
| `scripts/verify-test-data.ts` | 11-36 | Verification queries | Low |
| `scripts/seed-test-data.ts` | 10-119 | Seed INSERTs | Low |
| `src/test/globalSetup.ts` | 16-60 | Test cleanup (DROP) | Medium |

### Go Raw SQL (~25 statements)

| File | Lines | Type | Complexity |
|------|-------|------|------------|
| `internal/taskqueue/queue.go` | 82-177 | PL/pgSQL function calls | Medium |
| `internal/matching/barcode.go` | 42-300 | Streaming SELECT, advisory locks | High |
| `internal/matching/ai.go` | 276-424 | Similarity search, INSERT | High |
| `internal/matching/embedding.go` | 70-172 | Array operations | Medium |
| `internal/jobs/cleanup_audit.go` | 31-78 | DELETE, UPDATE | Low |
| `internal/handlers/task_cluster.go` | 595-1252 | Bulk ops, temp tables | High |

---

## Migration Strategy

### Guiding Principles

1. **Use ORM/Query Builder First**: Prefer Drizzle/sqlc generated queries
2. **PL/pgSQL for Complex Logic**: Move complex CTEs/functions to database functions
3. **Keep Advisory Locks**: Raw SQL for `pg_advisory_lock` is acceptable
4. **Temp Tables Acceptable**: Bulk operations with temp tables can remain raw SQL
5. **Test Scripts**: Low priority, can stay as-is

---

## Phase 1: TypeScript - Products Router (High Impact)

### File: `src/orpc/router/products.ts`

#### Query 1: `getPendingMatches` (lines 97-159)

**Current Pattern:**
```typescript
const result = await db.execute(sql`
  WITH pending AS (...)
  SELECT q.*, jsonb_build_object(...) as retailer_item,
         jsonb_agg(...) as candidates
  FROM pending q
  JOIN retailer_items ri ON ri.id = q.retailer_item_id
  ...
`);
```

**Migration Options:**

| Option | Description | Effort | Pros | Cons |
|--------|-------------|--------|------|------|
| A | Create PL/pgSQL function | Medium | Clean TS code, DB-side optimization | Schema migration needed |
| B | Use Drizzle query builder | High | Type-safe, pure TS | Complex for CTEs + JSON agg |
| C | Keep raw SQL | Low | Works now | Not type-safe |

**Recommended: Option A** - Create `get_pending_matches()` function

**Migration Steps:**
1. Add to `drizzle/0001_manual_functions.sql`:
```sql
CREATE OR REPLACE FUNCTION get_pending_matches(
  p_status_filter text[],
  p_chain_filter text[],
  p_limit integer
)
RETURNS TABLE(
  id text,
  status text,
  decision text,
  linked_product_id text,
  retailer_item jsonb,
  candidates jsonb
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH pending AS (
    SELECT q.*
    FROM product_match_queue q
    WHERE (p_status_filter IS NULL OR q.status = ANY(p_status_filter))
      AND (p_chain_filter IS NULL OR EXISTS (
        SELECT 1 FROM retailer_items ri
        WHERE ri.id = q.retailer_item_id
        AND ri.chain_slug = ANY(p_chain_filter)
      ))
    ORDER BY q.created_at
    LIMIT p_limit
  )
  SELECT
    q.id, q.status, q.decision, q.linked_product_id,
    jsonb_build_object(...) as retailer_item,
    COALESCE(jsonb_agg(...), '[]'::jsonb) as candidates
  FROM pending q
  JOIN retailer_items ri ON ri.id = q.retailer_item_id
  ...
END;
$$;
```

2. Replace in TypeScript:
```typescript
import { sql } from "drizzle-orm";

const result = await db.execute(sql`
  SELECT * FROM get_pending_matches(
    ${input.statusFilters}::text[],
    ${input.chainFilters}::text[],
    ${input.limit}
  )
`);
```

#### Query 2: `bulkApprove` (lines 367-403)

**Current:** CTE with INSERT, UPDATE, ON CONFLICT

**Migration:** Create PL/pgSQL function `bulk_approve_matches(p_queue_ids text[], p_user_id text)`

#### Query 3: `searchProducts` (lines 480-494)

**Current:** pg_trgm similarity search

**Migration:**
- Can use Drizzle with raw fragment:
```typescript
import { sql } from "drizzle-orm";

const result = await db
  .select({
    id: products.id,
    name: products.name,
    // ...
    simScore: sql`similarity(lower(${products.name}), lower(${input.query}))`.as('sim_score')
  })
  .from(products)
  .where(sql`similarity(lower(${products.name}), lower(${input.query})) > 0.1`)
  .orderBy(sql`sim_score DESC`)
  .limit(input.limit);
```

#### Queries 4-6: `getStats` (lines 512-545)

**Migration:** Simple aggregations, use Drizzle:
```typescript
import { count, eq, sql } from "drizzle-orm";

const queueStats = await db
  .select({
    pending: count(sql`*`).filterWhere(eq(productMatchQueue.status, 'pending')),
    approved: count(sql`*`).filterWhere(eq(productMatchQueue.status, 'approved')),
    // ...
  })
  .from(productMatchQueue);
```

---

## Phase 2: TypeScript - Task Queue (Medium Impact)

### File: `src/lib/taskqueue/index.ts`

#### Current Issue: Using raw SQL for INSERT, UPDATE, function calls

**Queries:**
1. `scheduleTask` (lines 30-36) - INSERT with RETURNING
2. `claimTasks` (lines 50-52) - Calls PL/pgSQL function
3. `completeTask` (line 58) - Calls PL/pgSQL function
4. `failTask` (lines 77-79) - Calls PL/pgSQL function
5. `getTask` (lines 85-92) - SELECT

**Migration:**

**Keep as-is:** Function calls to `claim_tasks`, `complete_task`, `fail_task` are already PL/pgSQL

**Convert to Drizzle:**
```typescript
// scheduleTask - use Drizzle
const [task] = await db
  .insert(taskQueue)
  .values({
    taskType: options.taskType,
    payload: options.payload as any,
    priority: options.priority ?? 0,
    scheduledFor: options.scheduledFor ?? new Date(),
    maxRetries: options.maxRetries ?? 3,
  })
  .returning();

// getTask - use Drizzle
const [task] = await db
  .select()
  .from(taskQueue)
  .where(eq(taskQueue.id, taskId))
  .limit(1);

// startProcessing - use Drizzle
await db
  .update(taskQueue)
  .set({ status: 'processing', updatedAt: new Date() })
  .where(eq(taskQueue.id, taskId));
```

---

## Phase 3: TypeScript - Cron Executor (High Complexity)

### File: `src/jobs/cron/executor.ts`

#### Query: `claimDueJobs` (lines 46-70)

**Current:** UPDATE with FOR UPDATE SKIP LOCKED

```typescript
const result = await db.execute(sql`
  UPDATE cron_jobs
  SET next_run_at = NULL, updated_at = NOW()
  WHERE id IN (
    SELECT id FROM cron_jobs
    WHERE enabled = true
    AND next_run_at <= ${nowIso}::timestamptz
    FOR UPDATE SKIP LOCKED
  )
  RETURNING ...
`);
```

**Migration Options:**

| Option | Description | Verdict |
|--------|-------------|---------|
| Create PL/pgSQL function | `claim_due_cron_jobs()` | **Recommended** |
| Keep raw SQL | Drizzle doesn't support FOR UPDATE SKIP LOCKED | Acceptable |
| Use Drizzle + raw fragment | Hybrid approach | Partial solution |

**Recommended:** Create `claim_due_cron_jobs()` function

```sql
CREATE OR REPLACE FUNCTION claim_due_cron_jobs(p_cutoff timestamptz)
RETURNS TABLE(
  id text,
  name text,
  cron_expression text,
  timezone text,
  task_type text,
  task_payload jsonb,
  enabled boolean,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_status text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE cron_jobs
  SET next_run_at = NULL, updated_at = NOW()
  WHERE id IN (
    SELECT id FROM cron_jobs
    WHERE enabled = true
    AND next_run_at <= p_cutoff
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;
```

---

## Phase 4: TypeScript - Test/Seed Scripts (Low Priority)

### Files: `scripts/verify-test-data.ts`, `scripts/seed-test-data.ts`

**Recommendation:** Keep as-is

These are utility scripts with simple queries. Migration effort not justified.

---

## Phase 5: Go - Task Queue (Medium Impact)

### File: `services/price-service/internal/taskqueue/queue.go`

#### Current: Direct PL/pgSQL function calls via `pool.Query`

```go
rows, err := q.pool.Query(ctx, `
  SELECT * FROM claim_tasks($1, $2, $3)
`, input.WorkerID, input.TaskTypes, input.MaxTasks)
```

**Issue:** These functions have complex return types that sqlc cannot infer

**Solution:** Already using sqlc where possible, these raw calls are justified

**Recommendation:** Keep as-is, add comments explaining why sqlc isn't used

---

## Phase 6: Go - Barcode Matching (High Complexity)

### File: `services/price-service/internal/matching/barcode.go`

#### Query 1: AutoMatchByBarcode (lines 42-62)

**Current:** Streaming SELECT with DISTINCT, JOINs, NOT EXISTS

```go
rows, err := db.Query(ctx, `
  SELECT DISTINCT rib.barcode, ri.id, ri.name, ...
  FROM retailer_item_barcodes rib
  JOIN retailer_items ri ON ri.id = rib.retailer_item_id
  JOIN chains c ON c.slug = ri.chain_slug
  WHERE rib.barcode IS NOT NULL ...
  AND NOT EXISTS (
    SELECT 1 FROM product_links pl WHERE pl.retailer_item_id = ri.id
  )
  ORDER BY rib.barcode
`)
```

**Migration:** Create sqlc query

**New file:** `internal/database/queries/matching.sql`

```sql
-- name: GetBarcodesForMatching :many
SELECT DISTINCT
  rib.barcode,
  ri.id, ri.name, ri.brand, ri.unit, ri.unit_quantity, ri.category, ri.image_url,
  c.slug as chain_slug, ri.external_id
FROM retailer_item_barcodes rib
JOIN retailer_items ri ON ri.id = rib.retailer_item_id
JOIN chains c ON c.slug = ri.chain_slug
WHERE rib.barcode IS NOT NULL AND rib.barcode != ''
AND NOT EXISTS (
  SELECT 1 FROM product_links pl WHERE pl.retailer_item_id = ri.id
)
ORDER BY rib.barcode;
```

#### Advisory Lock (line 117)

**Recommendation:** Keep raw SQL - postgres-specific feature

```go
// Advisory lock to prevent concurrent processing of same barcode
if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, barcode); err != nil {
  return err
}
```

#### INSERT statements (lines 151-312)

**Migration:** Convert to sqlc queries

```sql
-- name: InsertProductBarcodeMapping :one
INSERT INTO product_barcode_mapping (barcode, product_id)
VALUES ($1, $2)
RETURNING barcode, product_id, created_at;

-- name: InsertProductFromRetailerItem :one
INSERT INTO products (id, name, brand, category, unit, unit_quantity, image_url, created_at, updated_at)
VALUES (gen_random_text(), $1, $2, $3, $4, $5, $6, now(), now())
RETURNING *;

-- name: InsertProductLink :one
INSERT INTO product_links (id, product_id, retailer_item_id, confidence, is_primary, rank, image_url, created_at)
VALUES (gen_random_text(), $1, $2, $3, $4, $5, $6, now(), now())
RETURNING *;
```

---

## Phase 7: Go - AI Matching (High Complexity)

### File: `services/price-service/internal/matching/ai.go`

#### Similarity Search (lines 276-277)

**Current:** Raw SQL with pg_trgm

**Migration:** Create sqlc query

```sql
-- name: SearchProductsBySimilarity :many
SELECT
  p.id, p.name, p.brand, p.category, p.unit, p.unit_quantity,
  p.image_url, p.description, p.subcategory,
  similarity(lower(p.name), lower($1)) as sim_score
FROM products p
WHERE similarity(lower(p.name), lower($1)) > 0.1
ORDER BY sim_score DESC, p.name
LIMIT $2;
```

#### INSERT Candidate (lines 340, 357)

**Migration:** Create sqlc query

```sql
-- name: InsertProductMatchCandidate :one
INSERT INTO product_match_candidates (
  id, retailer_item_id, candidate_product_id, similarity, match_type,
  rank, flags, matching_run_id, model_version, normalized_text_hash, created_at
)
VALUES (gen_random_text(), $1, $2, $3::real, $4, $5, $6, $7, $8, $9, now())
ON CONFLICT (retailer_item_id, rank) DO UPDATE SET
  candidate_product_id = EXCLUDED.candidate_product_id,
  similarity = EXCLUDED.similarity,
  flags = EXCLUDED.flags,
  matching_run_id = EXCLUDED.matching_run_id,
  model_version = EXCLUDED.model_version,
  normalized_text_hash = EXCLUDED.normalized_text_hash
RETURNING *;
```

---

## Phase 8: Go - Cleanup Jobs (Low Complexity)

### File: `services/price-service/internal/jobs/cleanup_audit.go`

**Current:** Simple DELETE and UPDATE statements

**Migration:** Convert all to sqlc

```sql
-- name: DeleteOldMatchCandidates :execrows
DELETE FROM product_match_candidates
WHERE created_at < $1;

-- name: DeleteOldMatchAudit :execrows
DELETE FROM product_match_audit
WHERE created_at < $1;

-- name: SkipOldPendingQueueItems :execrows
UPDATE product_match_queue
SET status = 'skipped', reviewed_at = now()
WHERE status = 'pending'
AND created_at < $1;
```

---

## Phase 9: Go - Task Cluster (High Complexity)

### File: `services/price-service/internal/handlers/task_cluster.go`

**Current:** Complex bulk operations with temp tables, advisory locks

**Recommendation:** Keep most raw SQL, convert simple queries to sqlc

**Keep as raw SQL:**
- Lines 1131-1137: SET LOCAL statements (session config)
- Line 1142: Advisory lock
- Lines 1147-1283: Bulk operations with temp tables

**Convert to sqlc:**
- Simple INSERT statements for stores, items, barcodes

---

## Migration Priority Matrix

| Phase | File | Impact | Complexity | Priority |
|-------|------|--------|------------|----------|
| 1 | `src/orpc/router/products.ts` | High | High | **P0** |
| 3 | `src/jobs/cron/executor.ts` | High | Medium | **P0** |
| 2 | `src/lib/taskqueue/index.ts` | Medium | Low | **P1** |
| 6 | `internal/matching/barcode.go` | High | High | **P1** |
| 7 | `internal/matching/ai.go` | High | Medium | **P1** |
| 8 | `internal/jobs/cleanup_audit.go` | Low | Low | **P2** |
| 9 | `internal/handlers/task_cluster.go` | Medium | High | **P2** |
| 4 | `scripts/*.ts` | Low | Low | **P3** |
| 5 | `internal/taskqueue/queue.go` | Medium | N/A | **N/A** |

---

## Implementation Checklist

### TypeScript (Drizzle)

- [ ] Create PL/pgSQL function `get_pending_matches()`
- [ ] Create PL/pgSQL function `bulk_approve_matches()`
- [ ] Convert `searchProducts` to Drizzle with raw fragment
- [ ] Convert `getStats` queries to Drizzle aggregations
- [ ] Convert `taskqueue/index.ts` INSERT/UPDATE to Drizzle
- [ ] Create PL/pgSQL function `claim_due_cron_jobs()`

### Go (sqlc)

- [ ] Add `internal/database/queries/matching.sql`
- [ ] Add query: `GetBarcodesForMatching`
- [ ] Add query: `InsertProductBarcodeMapping`
- [ ] Add query: `InsertProductFromRetailerItem`
- [ ] Add query: `InsertProductLink`
- [ ] Add query: `SearchProductsBySimilarity`
- [ ] Add query: `InsertProductMatchCandidate`
- [ ] Add `internal/database/queries/cleanup.sql`
- [ ] Add query: `DeleteOldMatchCandidates`
- [ ] Add query: `DeleteOldMatchAudit`
- [ ] Add query: `SkipOldPendingQueueItems`
- [ ] Run `sqlc generate` to regenerate code

### Database Functions

- [ ] Add all new functions to `drizzle/0001_manual_functions.sql`
- [ ] Create migration for new functions
- [ ] Test all functions with edge cases

---

## Acceptable Raw SQL Patterns

The following raw SQL patterns are acceptable and should NOT be migrated:

1. **Advisory Locks:** `pg_advisory_lock()`, `pg_advisory_xact_lock()`
2. **Session Settings:** `SET LOCAL ...`
3. **Complex Temp Tables:** Multi-step bulk operations
4. **Test Utilities:** Simple verification/seed scripts
5. **PL/pgSQL Function Calls:** When sqlc cannot infer return types

---

## Testing Strategy

### Unit Tests
- Mock database responses for new function calls
- Test edge cases (empty results, null values)

### Integration Tests
- Verify function results match old raw SQL
- Test concurrent operations (advisory locks)

### Performance Tests
- Benchmark before/after for complex queries
- Check query plans remain optimal

---

## Rollback Plan

If issues arise:
1. Revert code changes
2. Keep new PL/pgSQL functions (harmless)
3. Document issues for future migration

---

## Summary

| Metric | Before | After |
|--------|--------|-------|
| Raw SQL statements (TS) | ~35 | ~15 |
| Raw SQL statements (Go) | ~25 | ~18 |
| PL/pgSQL functions | 6 | ~10 |
| Type safety | Partial | Improved |

**Key Benefits:**
- Better type safety in TypeScript
- Centralized complex logic in PL/pgSQL
- Reduced SQL scattered in code
- Easier testing and maintenance
