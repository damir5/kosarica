# ClickHouse Performance Fix Plan

## Problem Summary

The `prices` table (175M rows, 11 GiB, 110 parts) is the sole ClickHouse table. Most queries use `argMax(col, target_date) GROUP BY (chain, store, item)` to get "current prices" — this re-aggregates raw data on every request. The ORDER BY key `(target_date, chain_slug, store_id, retailer_item_id)` is optimized for date-first access, but the most common public queries filter by `retailer_item_id IN (...)` without a date prefix, forcing full scans.

**Observed symptoms:** queries scanning 123M rows / 4.6 GB for single-item lookups, 14-minute timeouts on catalog browsing, product page SSR blocked for minutes.

---

## Phase 1: Safety — Client Timeouts + Part Merging

### 1.1 Add ClickHouse client timeouts

**File:** `src/lib/clickhouse/index.ts` (line 240)

```typescript
rawClient = createClient({
  url,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  username: process.env.CLICKHOUSE_USERNAME,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 30_000,           // 30s HTTP timeout
  clickhouse_settings: {
    max_execution_time: 25,           // 25s server-side kill
  },
});
```

This ensures no query ever hangs for minutes. Queries that hit 25s are killed server-side; 30s on client side catches any stragglers.

### 1.2 Merge parts on server

Run once:
```sql
OPTIMIZE TABLE prices FINAL;
```

110 parts → fewer merged parts = faster reads. Schedule periodic optimization via the existing cron system.

### 1.3 Add `max_execution_time` per-query for SSR loaders

In `products-public.ts` and `catalog-prices.ts`, pass a per-query setting:
```typescript
clickhouse.query<T>(sql, params, { max_execution_time: 10 })
```

SSR-blocking queries should fail fast (10s) rather than hang.

---

## Phase 2: Materialized Table `prices_current`

### Rationale

6 out of 14 ClickHouse queries do the same pattern: "give me the latest price per (chain, store, item)". Instead of re-computing `argMax()` over millions of rows each time, maintain a pre-aggregated table.

### 2.1 Create the table

```sql
CREATE TABLE prices_current (
    retailer_item_id String,
    chain_slug LowCardinality(String),
    store_id String,
    name String,
    brand Nullable(String),
    category Nullable(String),
    external_id Nullable(String),
    barcode Nullable(String),
    price_cents Nullable(Int32),
    price_status Enum8('available' = 1, 'unavailable' = 2) DEFAULT 'available',
    price_unavailable_reason Nullable(Enum8('missing' = 1, 'invalid' = 2, 'non_positive' = 3)),
    discount_price_cents Nullable(Int32),
    unit_price_cents Nullable(Int32),
    target_date Date,
    imported_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(imported_at)
ORDER BY (retailer_item_id, chain_slug, store_id)
```

Key differences from `prices`:
- **ORDER BY starts with `retailer_item_id`** — enables fast lookups by item
- **One row per (item, chain, store)** — latest values only
- **No PARTITION BY** — small table (~1-5M rows), partitioning adds overhead

### 2.2 Cron job: full refresh

Add a cron handler (`src/jobs/cron/handlers/refresh-prices-current.ts`):

```sql
TRUNCATE TABLE prices_current;

INSERT INTO prices_current
SELECT
    retailer_item_id,
    chain_slug,
    store_id,
    argMax(name, target_date) AS name,
    argMax(brand, target_date) AS brand,
    argMax(category, target_date) AS category,
    argMax(external_id, target_date) AS external_id,
    argMax(barcode, target_date) AS barcode,
    argMax(price_cents, target_date) AS price_cents,
    argMax(price_status, target_date) AS price_status,
    argMax(price_unavailable_reason, target_date) AS price_unavailable_reason,
    argMax(discount_price_cents, target_date) AS discount_price_cents,
    argMax(unit_price_cents, target_date) AS unit_price_cents,
    max(target_date) AS target_date,
    now() AS imported_at
FROM prices
WHERE target_date >= today() - 30
    AND target_date <= today()
GROUP BY retailer_item_id, chain_slug, store_id;
```

Schedule: run after daily ingestion completes (or every 4 hours). The 30-day window keeps the source scan manageable. Full TRUNCATE+INSERT is simple and atomic enough for this use case.

### 2.3 Rewrite queries to use `prices_current`

**Query: products-public.ts:110-123 (current prices for product page)**
Before:
```sql
SELECT retailer_item_id, chain_slug, store_id,
    argMax(price_cents, target_date) AS current_price,
    argMax(discount_price_cents, target_date) AS discount_price,
    max(target_date) AS last_seen_at
FROM prices
WHERE retailer_item_id IN ({itemIds:Array(String)})
    AND target_date <= today()
GROUP BY retailer_item_id, chain_slug, store_id
```
After:
```sql
SELECT retailer_item_id, chain_slug, store_id,
    price_cents AS current_price,
    discount_price_cents AS discount_price,
    target_date AS last_seen_at
FROM prices_current FINAL
WHERE retailer_item_id IN ({itemIds:Array(String)})
```
Scan: ~tens of rows (by item ID, indexed) vs 123M rows.

**Query: catalog-prices.ts:125-162 (catalog browsing)**
Before:
```sql
SELECT chain_slug, store_id, retailer_item_id,
    argMax(name, target_date) AS name, ...
FROM prices WHERE ... GROUP BY chain_slug, store_id, retailer_item_id
```
After:
```sql
SELECT chain_slug, store_id, retailer_item_id,
    name, brand, category, price_cents, ...
FROM prices_current FINAL
WHERE [same filters minus date range]
ORDER BY target_date DESC
LIMIT ... OFFSET ...
```
No GROUP BY needed — the table already has one row per combo.

**Query: products-public.ts:424-446 (similar variants best price)**
Before: nested argMax subquery
After:
```sql
SELECT
    retailer_item_id,
    min(if(discount_price_cents > 0, discount_price_cents, price_cents)) AS best_price,
    argMin(chain_slug, if(discount_price_cents > 0, discount_price_cents, price_cents)) AS chain_slug
FROM prices_current FINAL
WHERE retailer_item_id IN ({itemIds:Array(String)})
    AND target_date >= today() - 7
GROUP BY retailer_item_id
```

**Query: basket/optimizer.ts:281-294 (basket price load)**
Before: argMax over raw prices
After: direct SELECT from prices_current WHERE chain_slug AND retailer_item_id IN (...)

**Query: basket/optimizer.ts:304-322 (average prices)**
Keep on raw `prices` table — this genuinely needs historical data for averaging.

**Query: latest-prices.ts:9-19 (effective price)**
After:
```sql
SELECT retailer_item_id,
    if(discount_price_cents > 0, discount_price_cents, price_cents) AS effective_price
FROM prices_current FINAL
WHERE retailer_item_id IN ({itemIds:Array(String)})
    AND target_date >= today() - INTERVAL {days:UInt8} DAY
```

---

## Phase 3: Skipping Indexes for Catalog Browsing

The `catalogPrices.list` query filters on `category` and does text search on `name`/`brand`. These columns are NOT in the ORDER BY key.

### 3.1 Add indexes on `prices_current`

```sql
-- Bloom filter for category (exact match)
ALTER TABLE prices_current ADD INDEX idx_category category TYPE bloom_filter GRANULARITY 1;

-- Token bloom filter for text search on name/brand
ALTER TABLE prices_current ADD INDEX idx_name name TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1;
ALTER TABLE prices_current ADD INDEX idx_brand brand TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1;

-- Materialize indexes for existing data
ALTER TABLE prices_current MATERIALIZE INDEX idx_category;
ALTER TABLE prices_current MATERIALIZE INDEX idx_name;
ALTER TABLE prices_current MATERIALIZE INDEX idx_brand;
```

### 3.2 Replace `positionCaseInsensitiveUTF8` with `hasToken`

If possible, use `hasTokenCaseInsensitive(name, 'search')` which can use the `tokenbf_v1` index. Falls back to `positionCaseInsensitiveUTF8` for substring matches.

---

## Phase 4: Projection for Price History

The price history query (products-public.ts:173-186) needs raw time-series data sorted by `(retailer_item_id, target_date)`. The current ORDER BY starts with `target_date`, so ClickHouse can't efficiently read by item.

### 4.1 Add projection on raw `prices` table

```sql
ALTER TABLE prices ADD PROJECTION prices_by_item (
    SELECT *
    ORDER BY retailer_item_id, target_date, chain_slug, store_id
);

ALTER TABLE prices MATERIALIZE PROJECTION prices_by_item;
```

This creates an alternate data arrangement sorted by item first. ClickHouse automatically uses it when the query filter matches. The history query would then only read the granules for the requested item IDs.

**Trade-off:** doubles storage (~11 GiB → ~22 GiB). With 22 GiB free, this is tight. Consider adding a date constraint:
```sql
-- Alternative: just constrain the history query to 90 days (already done)
-- and rely on partition pruning. Skip projection if disk is tight.
```

**Decision:** Skip projection for now if disk is tight (51/75 GB used). The 90-day constraint + partition pruning should be sufficient. Revisit when disk is expanded.

---

## Phase 5: SSR Loader Resilience

### 5.1 Don't block SSR on ClickHouse data

**File:** `src/routes/_public.product.$productId.tsx` (line 30)

Change from:
```typescript
loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(...);
    return data;
},
```

To:
```typescript
loader: ({ context, params }) => {
    // Prefetch but don't block SSR — data streams to client
    context.queryClient.prefetchQuery(
        orpc.products.get.queryOptions({
            input: { productId: params.productId },
        }),
    );
},
```

The page renders a skeleton immediately. Data fills in when ClickHouse responds. This prevents SSR from ever hanging.

**File:** `src/routes/_public.index.tsx` (line 14)

Same pattern — prefetch categories without blocking. The home page should render instantly.

---

## Phase 6: Chain Metadata Caching

### 6.1 Cache `max(target_date)` per chain

The basket optimizer queries `max(target_date)` per chain on every optimization. This scans millions of rows.

Add to `prices_current` refresh:
```sql
CREATE TABLE IF NOT EXISTS prices_chain_metadata (
    chain_slug LowCardinality(String),
    latest_date Date,
    updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY chain_slug;
```

Populated during the same cron refresh:
```sql
INSERT INTO prices_chain_metadata
SELECT chain_slug, max(target_date), now()
FROM prices WHERE target_date <= today()
GROUP BY chain_slug;
```

---

## Implementation Order

| Step | What | Impact | Risk |
|------|------|--------|------|
| 1.1 | Client timeouts | Prevents 14-min hangs | None |
| 1.2 | OPTIMIZE TABLE | Fewer parts = faster reads | Brief I/O spike |
| 1.3 | Per-query timeouts | SSR fails fast | Users see errors instead of hangs |
| 2.1-2.2 | prices_current table + cron | Eliminates argMax scans | New table to maintain |
| 2.3 | Rewrite queries | 100-1000x faster reads | Must test each query |
| 5.1 | SSR prefetch (not await) | Page never hangs | Brief flash of skeleton |
| 3.1-3.2 | Skipping indexes | Faster catalog filtering | Minimal |
| 6.1 | Chain metadata cache | Faster basket optimizer | Minimal |
| 4.1 | Projection (if disk allows) | Faster history queries | ~11 GiB extra storage |

---

## Files to Create/Modify

**New files:**
- `clickhouse/migrations/0002_prices_current.sql` — DDL for prices_current + chain_metadata
- `src/jobs/cron/handlers/refresh-prices-current.ts` — cron handler
- `src/lib/clickhouse/current-prices.ts` — query helpers for prices_current

**Modified files:**
- `src/lib/clickhouse/index.ts` — add timeouts, add query method with settings param
- `src/orpc/router/products-public.ts` — rewrite 3 queries to use prices_current
- `src/orpc/router/catalog-prices.ts` — rewrite catalog query to use prices_current
- `src/lib/clickhouse/latest-prices.ts` — rewrite to use prices_current
- `src/lib/basket/optimizer.ts` — rewrite price load + chain metadata queries
- `src/routes/_public.product.$productId.tsx` — prefetch instead of await
- `src/routes/_public.index.tsx` — prefetch instead of await
- `src/jobs/cron/jobs.ts` — register refresh-prices-current cron job
