# Architecture Transition Plan: Go → Node + ClickHouse

## Current State Summary

**Go price-service handles:**
- 11 chain adapters (Konzum, Lidl, Kaufland, etc.) with discovery/fetch/parse
- 5-phase ingestion pipeline (discover → fetch → parse → cluster → finalize)
- Task queue workers with parent-child orchestration
- In-memory price clustering/deduplication
- Basket optimization (single/multi-store)
- Price cache with warmup

**Node.js handles:**
- Cron scheduling (Postgres-coordinated)
- Task queue definitions
- Drizzle schema (source of truth)
- API layer (oRPC) proxying to Go
- Admin UI for ingestion monitoring

**Postgres stores:**
- `price_tiers` + `store_price_refs` (item-level dedup, ~millions rows)
- `retailer_items` + barcodes
- `stores` + `store_identifiers`
- `archives` (source file tracking)
- `ingestion_runs/files/errors`

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Node.js Service (unified)                                      │
├─────────────────────────────────────────────────────────────────┤
│  Ingestion Pipeline (Node)                                      │
│  ├─ Chain adapters (ported from Go)                             │
│  ├─ Download source files → LocalS3                             │
│  ├─ Archive: gzip if compressible, store original otherwise     │
│  └─ Convert to Parquet files (one per chain per day)            │
├─────────────────────────────────────────────────────────────────┤
│  Storage Layer                                                  │
│  ├─ LocalS3 (filesystem): source files (gzipped) + parquet      │
│  └─ Postgres: metadata (runs, archives, stores, items, parquet) │
├─────────────────────────────────────────────────────────────────┤
│  ClickHouse Sync (app-managed)                                  │
│  ├─ CLI/API: load ALL parquet → ClickHouse (full rebuild)       │
│  ├─ CLI/API: load MISSING parquet → ClickHouse (incremental)    │
│  └─ Auto-sync after ingestion (optional)                        │
├─────────────────────────────────────────────────────────────────┤
│  ClickHouse (locally installed, always available)               │
│  ├─ prices table (chain, store, item, date, prices)             │
│  └─ Optimized for cart optimization queries                     │
├─────────────────────────────────────────────────────────────────┤
│  Cart Optimization                                              │
│  └─ Node + ClickHouse queries (replaces Go optimizer)           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Infrastructure Setup

**Goal:** LocalS3 storage + ClickHouse client (ClickHouse optional for ingestion)

### 1.1 LocalS3 Storage Layer (filesystem-based)
```typescript
// src/lib/storage/index.ts
interface Storage {
  put(key: string, data: Buffer, metadata?: Record<string,string>): Promise<void>
  get(key: string): Promise<Buffer>
  list(prefix: string): Promise<string[]>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}

// src/lib/storage/local.ts - filesystem implementation
// Similar to Go's services/price-service/internal/storage/local.go
class LocalStorage implements Storage {
  constructor(private basePath: string) {}
  // Files stored at: {basePath}/{key}
  // Metadata stored as: {basePath}/{key}.meta.json
}
```

Storage structure:
```
data/storage/
├── sources/{chain}/{date}/{filename}.gz   # Original source files
└── parquet/{chain}/{date}/prices.parquet  # Processed Parquet
```

### 1.2 ClickHouse Schema (applied manually for dev)
```sql
-- Run manually: clickhouse-client < scripts/clickhouse-schema.sql
CREATE TABLE prices (
  target_date Date,
  chain_slug LowCardinality(String),
  store_id String,
  retailer_item_id String,
  external_id Nullable(String),
  name String,
  barcode Nullable(String),
  price_cents Int32,
  discount_price_cents Nullable(Int32),
  unit_price_cents Nullable(Int32),
  category Nullable(String),
  brand Nullable(String),
  imported_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(imported_at)
PARTITION BY (toYYYYMM(target_date), chain_slug)
ORDER BY (target_date, chain_slug, store_id, retailer_item_id)
```

### 1.3 ClickHouse Client
```typescript
// src/lib/clickhouse/index.ts
const clickhouse = createClient({ url: process.env.CLICKHOUSE_URL })

export async function importParquetFile(path: string): Promise<void>
export async function queryPrices(params: PriceQuery): Promise<Price[]>
export async function truncatePrices(): Promise<void>
```

**Test:** LocalS3 read/write works, ClickHouse queries work

---

## Phase 2: Port All Chain Adapters

**Goal:** All 11 chain adapters ported to Node.js

### 2.1 Adapter Interface
```typescript
// src/ingestion/adapters/types.ts
interface ChainAdapter {
  slug: string
  discover(targetDate: string): Promise<DiscoveredFile[]>
  fetch(file: DiscoveredFile): Promise<Buffer>
  parse(content: Buffer, filename: string): ParseResult
}

interface DiscoveredFile {
  url: string
  filename: string
  storeIdentifier?: string
  format: 'csv' | 'xml' | 'xlsx' | 'zip'
}

interface ParseResult {
  rows: NormalizedRow[]
  errors: ParseError[]
}
```

### 2.2 Port Chains (in order)
1. **Konzum** - Windows-1250 CSV, paginated portal
2. **Lidl** - ZIP containing CSVs
3. **Kaufland** - UTF-8 tab-delimited CSV, JSON API discovery
4. **Studenac** - XML format
5. **Plodine** - ZIP with semicolon CSV
6. **Interspar** - UTF-8 CSV, JSON API
7. **DM** - XLSX format
8. **Eurospin** - ZIP with CSV
9. **KTC** - Windows-1250 semicolon CSV
10. **Metro** - UTF-8 semicolon CSV
11. **Trgocentar** - XML format

### 2.3 Common Utilities
- Encoding detection (iconv-lite for Windows-1250)
- CSV parsing with delimiter detection
- XML parsing
- XLSX parsing (xlsx or exceljs)
- ZIP extraction
- Price format parsing (European: 1.234,56)

### 2.4 Rate Limiting
- Per-chain rate limits (token bucket)
- Retry with exponential backoff for 429/5xx

**Test:** Each adapter can discover + fetch + parse sample files

---

## Phase 3: Ingestion Pipeline + Parquet

**Goal:** Full ingestion pipeline: download → parse → archive → Parquet → ClickHouse

### 3.1 Task Queue Integration
```typescript
// src/lib/taskqueue/handlers/ingestion.ts
// Cron triggers task, worker executes

// Task payload
type IngestionTaskPayload = {
  type: 'ingestion'
  chainSlug: string
  targetDate: string
}

// Worker handler
async function handleIngestionTask(payload: IngestionTaskPayload) {
  const { chainSlug, targetDate } = payload
  await runIngestion(chainSlug, targetDate)
}
```

### 3.2 Ingestion Pipeline
```typescript
// src/ingestion/pipeline.ts
async function runIngestion(chain: string, targetDate: string) {
  // 1. Discover files
  const files = await adapter.discover(targetDate)

  // 2. For each file:
  for (const file of files) {
    // Download
    const content = await adapter.fetch(file)

    // Archive source (gzip if compressible)
    await archiveSource(chain, targetDate, file, content)

    // Parse to normalized rows
    const result = await adapter.parse(content, file.filename)

    // Resolve store_id from identifier
    const rows = await resolveStoreIds(result.rows)

    // Upsert retailer_items to Postgres
    await upsertRetailerItems(rows)

    // Accumulate for Parquet
    allRows.push(...rows)
  }

  // 3. Write Parquet file to LocalS3
  await writeParquet(chain, targetDate, allRows)

  // 4. Track in Postgres (for load-missing sync)
  await recordParquetFile(chain, targetDate)
}
```

### 3.3 Parquet Generation
- Use `parquetjs` or `@dsnp/parquetjs`
- Schema matching ClickHouse table
- SNAPPY compression
- Store to LocalS3: `parquet/{chain}/{YYYY-MM-DD}/prices.parquet`

### 3.4 ClickHouse Sync (app-managed)
```typescript
// src/ingestion/clickhouse-sync.ts

// Load ALL parquet files (full rebuild)
async function loadAllToClickHouse() {
  // 1. Truncate prices table
  await clickhouse.exec({ query: 'TRUNCATE TABLE prices' })

  // 2. List all parquet files from LocalS3
  const files = await storage.list('parquet/')

  // 3. Import each
  for (const path of files) {
    await importParquetFile(path)
  }
}

// Load only MISSING parquet files (incremental)
async function loadMissingToClickHouse() {
  // 1. Get imported files from Postgres tracking table
  const imported = await getImportedParquetFiles()

  // 2. List all parquet files
  const all = await storage.list('parquet/')

  // 3. Import only missing
  const missing = all.filter(f => !imported.has(f))
  for (const path of missing) {
    await importParquetFile(path)
    await markParquetImported(path)
  }
}

// CLI commands:
// pnpm clickhouse:load-all      # Full rebuild
// pnpm clickhouse:load-missing  # Incremental sync

// API endpoints:
// POST /admin/clickhouse/load-all
// POST /admin/clickhouse/load-missing
// GET  /admin/clickhouse/status  # Show pending files count
```

### 3.5 Postgres Metadata Updates
- `ingestion_runs` - track run status
- `archives` - LocalS3 paths for source files
- `parquet_files` - track Parquet files + ClickHouse import status
- `retailer_items` - upsert items
- `stores` / `store_identifiers` - resolve identifiers

**Test:** Ingestion → Parquet in LocalS3 → load-missing → data in ClickHouse

---

## Phase 4: Cart Optimization + Product Matching

**Goal:** Cart optimization via ClickHouse, product matching in Node

### 4.1 Single-Store Optimization
```sql
-- Find best store for basket items
WITH basket AS (
  SELECT unnest(ARRAY['item1', 'item2']) as item_id
)
SELECT
  p.store_id,
  s.name as store_name,
  count(*) as items_found,
  sum(COALESCE(p.discount_price_cents, p.price_cents)) as total_cents
FROM prices p
JOIN basket b ON p.retailer_item_id = b.item_id
JOIN stores s ON p.store_id = s.id  -- Postgres join for name
WHERE p.target_date = today()
  AND p.chain_slug = ?
GROUP BY p.store_id, s.name
ORDER BY items_found DESC, total_cents ASC
LIMIT 10
```

### 4.2 Multi-Store Optimization
- Greedy set-cover: pick store with most missing items, repeat
- Use ClickHouse for price lookups, algorithm in Node

### 4.3 oRPC Handlers
```typescript
// src/orpc/router/basket.ts - replace Go proxy with direct implementation
basket: {
  optimizeSingle: async (input) => {
    const results = await clickhouse.query(singleStoreQuery, input)
    return formatResults(results)
  },
  optimizeMulti: async (input) => {
    return await multiStoreOptimizer(input)
  }
}
```

### 4.4 Product Matching (Port from Go)
- Barcode matching: exact GTIN lookup
- AI matching: trigram similarity only (pg_trgm)
- Local embeddings: placeholder for future phase
- Store in `product_match_candidates`, `product_links`

**Test:** Basket optimization returns correct stores + prices

---

## Phase 5: Cleanup & Migration

**Goal:** Remove Go service, clean up Postgres

### 5.1 Remove Go Service
- Delete `services/price-service/` directory
- Remove from docker-compose (if present)
- Remove mise tasks: `swag`, `sqlc-generate`, `test-service`
- Remove Go SDK generation: `generate:go-api`
- Delete `src/lib/go-api/`, `src/lib/go-service-client.ts`

### 5.2 Postgres Schema Cleanup
Drop tables (now in ClickHouse):
- `price_tiers`
- `store_price_refs`

Keep metadata tables:
- `chains`, `stores`, `store_identifiers`
- `retailer_items`, `retailer_item_barcodes`
- `archives` (now with S3 paths)
- `ingestion_runs`, `ingestion_files`, `ingestion_errors`
- `products`, `product_links`, `product_match_*`

### 5.3 Update Documentation
- AGENTS.md - remove Go service sections
- CHECKS.md - remove Go sync requirements
- README - update architecture diagram

### 5.4 Environment Cleanup
- Remove GO_SERVICE_URL from .env files
- Remove INTERNAL_API_KEY (if Go-only)
- Add CLICKHOUSE_URL (default: http://localhost:8123)
- Add STORAGE_PATH (default: ./data/storage)

**Test:** Full system works without Go service

---

## Decisions Made

| Decision | Choice |
|----------|--------|
| S3 Provider | LocalS3 (filesystem-based, like Go implementation) |
| Parquet Organization | One per chain per day (~11 files/day) |
| ClickHouse | Installed locally (no docker-compose management) |
| ClickHouse Sync | App-managed: load-all (rebuild) or load-missing (incremental) |
| Store ID Resolution | Resolve during parse (lookup store_id from identifier) |
| History Retention | All history in ClickHouse |
| Product Matching | Port to Node now |
| Migration Approach | **POC - remove Go, port all chains immediately** |
| First Chain | Konzum (then all others) |
| AI Embeddings | Defer - trigram only for now, local embeddings later |
| Ingestion Mode | Task queue (async via existing cron + worker system) |

---

## Key Files to Create/Modify

### New Files
```
src/lib/storage/              # LocalS3 abstraction (filesystem-based)
  index.ts                    # Storage interface
  local.ts                    # Filesystem implementation

src/lib/clickhouse/           # ClickHouse client
  index.ts                    # Client wrapper
  sync.ts                     # load-all / load-missing logic

src/ingestion/                # Ingestion pipeline (port from Go)
  adapters/
    types.ts
    konzum.ts
    lidl.ts
    kaufland.ts
    ... (8 more)
    registry.ts
  parsers/
    csv.ts
    xml.ts
    xlsx.ts
    zip.ts
    price.ts
  pipeline.ts
  parquet.ts

src/cli/                      # CLI commands
  clickhouse.ts               # pnpm clickhouse:load-all, load-missing

scripts/
  clickhouse-schema.sql       # Run manually for dev setup
```

### Files to Delete (Phase 5)
```
services/price-service/       # Entire Go service
src/lib/go-api/               # Generated SDK
src/lib/go-service-client.ts
src/lib/go-api-utils.ts
```

### Files to Modify
```
src/orpc/router/basket.ts     # Direct ClickHouse instead of Go proxy
src/orpc/router/prices.ts     # Query ClickHouse
src/jobs/cron/handlers/       # Trigger Node ingestion
src/db/schema.ts              # Drop price_tiers, store_price_refs
```

---

## Verification Steps

### Phase 1 Verification
```bash
# LocalS3 test
pnpm test:storage

# ClickHouse (install locally first)
# macOS: brew install clickhouse
# Then: clickhouse-client < scripts/clickhouse-schema.sql
clickhouse-client -q "SELECT 1"
```

### Phase 2 Verification
```bash
# Test each adapter
pnpm test:adapter konzum
pnpm test:adapter lidl
# etc.
```

### Phase 3 Verification
```bash
# Run ingestion
pnpm ingest konzum 2024-01-15

# Check LocalS3
ls -la data/storage/parquet/konzum/

# Load to ClickHouse (incremental)
pnpm clickhouse:load-missing

# Or full rebuild
pnpm clickhouse:load-all

# Verify in ClickHouse
clickhouse-client -q "SELECT count(*) FROM prices WHERE chain_slug = 'konzum'"

# Check sync status via API
curl http://localhost:3000/admin/clickhouse/status
```

### Phase 4 Verification
```bash
# Test basket optimization
curl -X POST http://localhost:3000/api/basket/optimize \
  -d '{"chainSlug":"konzum","items":[...]}'
```

### Phase 5 Verification
```bash
# Full E2E without Go
pnpm dev  # Node only
# Test all API endpoints work
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Chain API changes | Keep Go adapters as reference, match behavior exactly |
| Parquet schema mismatch | Validate schema matches ClickHouse before import |
| Memory issues (large files) | Stream parsing, don't load entire file |
| ClickHouse query perf | Add appropriate indices, test with real data volume |
| Missing edge cases | Port Go tests to Node, add integration tests |
