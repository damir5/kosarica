# Architecture Plan: Postgres + Golang Price Service

## Key Decisions

- **Single PostgreSQL database** (plain, no extensions)
- **Drizzle owns ALL schema/migrations** (both Node.js and Go tables)
- **Go uses sqlc + pgx** for type-safe DB access (reads Drizzle's schema)
- **Node.js as gateway** - Go internal only, Node proxies via oRPC
- **App-side ID generation** (keep existing `src/utils/id.ts`, no pgcrypto)
- **Integer/bigint keys** for high-volume tables
- **Change-only price storage** with auto-detected price groups
- **Greenfield** - no compatibility with old impl, remove unused immediately
- **Price groups in Go only** - no TS implementation, avoid double work

---

## Implementation Order

```
Phase 1: Port to Postgres
├── Remove SQLite deps (keep TS ingestion as Go reference)
├── Add postgres-js + Drizzle pg dialect
├── Schema: only tables needed NOW (auth, user data)
├── Delete old SQLite migrations
└── Test: TanStack auth works with Postgres

Phase 2: Go Service + All Scrapers
├── Create Go module (sqlc + pgx + chi)
├── Add tables for ingestion (retailer_items, etc)
├── Port ALL 15 scrapers (no job queue)
├── Scheduler (robfig/cron)
├── New stores → status='pending'
└── Test: all chains ingest successfully

Phase 3: Node.js → Go Integration
├── Go: internal REST API (not public)
├── Node.js: oRPC routes proxy to Go
├── Auth stays in Node.js
├── Delete TS ingestion code
└── Test: frontend fetches prices via Node proxy

Phase 4: Price Groups (Go only)
├── Detection algorithm
├── Group-level price storage
├── Exception handling
└── Test: storage reduced, prices correct

Phase 5: Basket Optimization
├── In-memory price cache
├── Single/multi-store algorithms
├── API via Node.js proxy
└── Test: basket optimization works

Phase 6: Store Enrichment UI
├── Admin UI for pending stores
├── Human approval workflow
├── Go marks approved stores
└── Test: new store → approve → active

Phase 7: Product Matching
├── Barcode auto-match
├── AI name matching
├── Admin review UI
└── Test: products linked across chains

Phase 8: Documentation
├── Update doc/planning/codebase/*
├── Architecture diagrams
├── API documentation
└── Deployment guide
```

---

## Schema Ownership

```
┌─────────────────────────────────────────────────────────────────┐
│                    Drizzle (Node.js)                            │
│                                                                  │
│  OWNS: All schema definitions and migrations                    │
│  - src/db/schema.ts defines ALL tables                          │
│  - drizzle-kit generates migrations                             │
│  - Migrations run from Node.js only                             │
│                                                                  │
│  Tables it USES:                                                 │
│  users, sessions, products, product_links,                      │
│  baskets, basket_items, shopping_lists, stores                  │
│                                                                  │
│  Tables it DEFINES but doesn't use directly:                    │
│  retailer_items, price_groups, group_prices,                    │
│  store_group_memberships, price_changes, ingestion_runs         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ drizzle-kit generate
┌─────────────────────────────────────────────────────────────────┐
│                    schema.sql (generated)                        │
│                                                                  │
│  - Extracted from Drizzle migrations                            │
│  - Committed to repo                                            │
│  - sqlc reads this for type generation                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ sqlc generate
┌─────────────────────────────────────────────────────────────────┐
│                    Go Service (sqlc + pgx)                       │
│                                                                  │
│  READ-ONLY for schema (never runs migrations)                   │
│  - Uses generated Go types from sqlc                            │
│  - Writes to: retailer_items, price_groups, group_prices,       │
│    store_group_memberships, price_changes, ingestion_runs       │
│  - Reads from: chains, stores, products, product_links          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema (Revised after Senior Review)

### Key Fixes Applied:
1. ✅ **Group Identity Crisis** - Groups are IMMUTABLE, reused by hash match
2. ✅ **Omnibus Write-Bomb** - Moved to separate `item_price_stats` table
3. ✅ **Group Membership History** - New `store_group_history` table
4. ✅ **Unique Constraint** - (chain_id, external_id) on retailer_items
5. ✅ **Proper Indexes** - For price_changes partitions

```typescript
// src/db/schema.ts - ALL tables defined here

import { pgTable, serial, smallserial, bigserial,
         varchar, integer, bigint, smallint, boolean,
         timestamp, real, jsonb, index, uniqueIndex,
         primaryKey, check } from 'drizzle-orm/pg-core';

// ============================================================================
// Core Tables
// ============================================================================

export const chains = pgTable('chains', {
  id: smallserial('id').primaryKey(),
  slug: varchar('slug', { length: 32 }).unique().notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  website: varchar('website', { length: 256 }),
  logoUrl: varchar('logo_url', { length: 256 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const stores = pgTable('stores', {
  id: serial('id').primaryKey(),
  chainId: smallint('chain_id').notNull().references(() => chains.id),
  externalId: varchar('external_id', { length: 64 }).notNull(),
  name: varchar('name', { length: 256 }).notNull(),
  address: varchar('address', { length: 256 }),
  city: varchar('city', { length: 64 }),
  postalCode: varchar('postal_code', { length: 16 }),
  lat: real('lat'),
  lon: real('lon'),
  status: varchar('status', { length: 16 }).default('pending'),
  discoveredBy: varchar('discovered_by', { length: 16 }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  chainStatusIdx: index('stores_chain_status_idx').on(table.chainId, table.status),
  uniqChainStore: uniqueIndex('stores_chain_external_idx').on(table.chainId, table.externalId),
}));

// ============================================================================
// Node.js Owned Tables (auth, products, user data)
// ============================================================================

export const users = pgTable('users', {
  id: varchar('id', { length: 32 }).primaryKey(),
  email: varchar('email', { length: 256 }).unique().notNull(),
  name: varchar('name', { length: 128 }),
  role: varchar('role', { length: 16 }).default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ... sessions, accounts, verification tables for Better Auth

// Canonical products (cross-chain)
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 256 }).notNull(),
  brand: varchar('brand', { length: 128 }),
  category: varchar('category', { length: 64 }),
  unit: varchar('unit', { length: 16 }),
  unitQuantity: varchar('unit_quantity', { length: 32 }),
  imageUrl: varchar('image_url', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Links canonical products to retailer-specific items
export const productLinks = pgTable('product_links', {
  productId: integer('product_id').notNull().references(() => products.id),
  retailerItemId: bigint('retailer_item_id', { mode: 'number' }).notNull(),
  matchType: varchar('match_type', { length: 16 }),  // 'barcode', 'ai', 'manual'
  confidence: real('confidence'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.productId, table.retailerItemId] }),
  itemIdx: index('product_links_item_idx').on(table.retailerItemId),
}));

export const baskets = pgTable('baskets', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 32 }).notNull().references(() => users.id),
  name: varchar('name', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const basketItems = pgTable('basket_items', {
  basketId: integer('basket_id').notNull().references(() => baskets.id, { onDelete: 'cascade' }),
  productId: integer('product_id').notNull().references(() => products.id),
  quantity: smallint('quantity').default(1),
}, (table) => ({
  pk: primaryKey({ columns: [table.basketId, table.productId] }),
}));

export const shoppingLists = pgTable('shopping_lists', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 32 }).notNull().references(() => users.id),
  name: varchar('name', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const shoppingListItems = pgTable('shopping_list_items', {
  listId: integer('list_id').notNull().references(() => shoppingLists.id, { onDelete: 'cascade' }),
  productId: integer('product_id').notNull().references(() => products.id),
  quantity: smallint('quantity').default(1),
  checked: boolean('checked').default(false),
}, (table) => ({
  pk: primaryKey({ columns: [table.listId, table.productId] }),
}));

// ============================================================================
// Go Owned Tables (prices, ingestion) - defined here, used by Go
// ============================================================================

export const retailerItems = pgTable('retailer_items', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  chainId: smallint('chain_id').notNull().references(() => chains.id),
  externalId: varchar('external_id', { length: 64 }).notNull(),  // NOT NULL!
  barcode: varchar('barcode', { length: 32 }),
  name: varchar('name', { length: 256 }).notNull(),
  category: varchar('category', { length: 128 }),  // Raw from retailer
  brand: varchar('brand', { length: 128 }),
  unit: varchar('unit', { length: 16 }),
  unitQuantity: varchar('unit_quantity', { length: 32 }),
  imageUrl: varchar('image_url', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  // CRITICAL: Prevents duplicate items per chain
  uniqChainItem: uniqueIndex('retailer_items_chain_external_idx')
    .on(table.chainId, table.externalId),
  barcodeIdx: index('retailer_items_barcode_idx').on(table.barcode),
}));

// Price groups are IMMUTABLE - same hash = same group reused
export const priceGroups = pgTable('price_groups', {
  id: serial('id').primaryKey(),
  chainId: smallint('chain_id').notNull().references(() => chains.id),
  // SHA256 of canonical price vector (see HASH SPEC below)
  priceHash: varchar('price_hash', { length: 64 }).notNull(),
  hashVersion: smallint('hash_version').notNull().default(1),  // For future changes
  storeCount: smallint('store_count').default(0),
  itemCount: integer('item_count').default(0),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  // Unique per chain+version - same hash = reuse group
  uniqChainHash: uniqueIndex('price_groups_chain_hash_idx')
    .on(table.chainId, table.priceHash, table.hashVersion),
}));

// HISTORY of store-to-group assignments (not just current)
export const storeGroupHistory = pgTable('store_group_history', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  storeId: integer('store_id').notNull().references(() => stores.id),
  priceGroupId: integer('price_group_id').notNull().references(() => priceGroups.id),
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
  validTo: timestamp('valid_to', { withTimezone: true }),  // NULL = current
}, (table) => ({
  // Query: "what group was store X in on date Y?"
  storeTimeIdx: index('store_group_history_store_time_idx')
    .on(table.storeId, table.validFrom),
  // Query: "current membership" (valid_to IS NULL)
  currentIdx: index('store_group_history_current_idx')
    .on(table.storeId).where(sql`valid_to IS NULL`),
}));
// NOTE: Add exclusion constraint via raw SQL migration:
// EXCLUDE USING gist (store_id WITH =, tstzrange(valid_from, coalesce(valid_to, 'infinity')) WITH &&)

// Current prices per group (WRITE-ONCE per ingestion)
export const groupPrices = pgTable('group_prices', {
  priceGroupId: integer('price_group_id').notNull().references(() => priceGroups.id),
  itemId: bigint('item_id', { mode: 'number' }).notNull(),
  price: integer('price').notNull(),           // Cents/lipa
  discountPrice: integer('discount_price'),    // NULL = no discount
  unitPrice: integer('unit_price'),            // Per kg/L
  anchorPrice: integer('anchor_price'),        // "Was" price from retailer
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.priceGroupId, table.itemId] }),
  itemIdx: index('group_prices_item_idx').on(table.itemId),
}));
// NOTE: No updated_at - groups are immutable, prices recreated with new group

// Omnibus stats computed ASYNC (not in hot path)
export const itemPriceStats = pgTable('item_price_stats', {
  chainId: smallint('chain_id').notNull().references(() => chains.id),
  itemId: bigint('item_id', { mode: 'number' }).notNull(),
  lowest30d: integer('lowest_30d'),
  highest30d: integer('highest_30d'),
  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.chainId, table.itemId] }),
}));

// Store-specific price exceptions (MUST BE RARE, < 1%)
// Rule: Overrides are explicit, short-lived, and auto-expire
export const storePriceExceptions = pgTable('store_price_exceptions', {
  storeId: integer('store_id').notNull().references(() => stores.id),
  itemId: bigint('item_id', { mode: 'number' }).notNull(),
  price: integer('price').notNull(),
  discountPrice: integer('discount_price'),
  reason: varchar('reason', { length: 32 }).notNull(),  // NOT NULL - must explain
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),  // NOT NULL - must expire
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.storeId, table.itemId] }),
  expiryIdx: index('store_price_exceptions_expiry_idx').on(table.expiresAt),
}));
// Cron job: DELETE FROM store_price_exceptions WHERE expires_at < now()

// Ingestion run tracking
export const ingestionRuns = pgTable('ingestion_runs', {
  id: serial('id').primaryKey(),
  chainId: smallint('chain_id').notNull().references(() => chains.id),
  status: varchar('status', { length: 16 }).default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  filesCount: smallint('files_count').default(0),
  itemsCount: integer('items_count').default(0),
  changesCount: integer('changes_count').default(0),
  errors: jsonb('errors'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

### Raw SQL for Partitioned Tables

```sql
-- price_changes: Partitioned by month, store-aware for history queries
CREATE TABLE price_changes (
  id BIGSERIAL,
  item_id BIGINT NOT NULL,
  store_id INTEGER REFERENCES stores(id),  -- Which store saw the change
  price_group_id INTEGER,                   -- Context only (debugging)
  old_price INTEGER,
  new_price INTEGER NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (changed_at, id)
) PARTITION BY RANGE (changed_at);

-- Create monthly partitions (auto-create via pg_partman or manually)
CREATE TABLE price_changes_2025_01 PARTITION OF price_changes
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- Per-partition indexes for common queries
CREATE INDEX ON price_changes (store_id, item_id, changed_at DESC);
CREATE INDEX ON price_changes (item_id, changed_at DESC);

-- Exclusion constraint for store_group_history (no overlapping ranges)
ALTER TABLE store_group_history
ADD CONSTRAINT store_group_no_overlap
EXCLUDE USING gist (
  store_id WITH =,
  tstzrange(valid_from, coalesce(valid_to, 'infinity')) WITH &&
);

-- Partial unique index: only one current membership per store
CREATE UNIQUE INDEX store_group_current_uniq
ON store_group_history (store_id)
WHERE valid_to IS NULL;
```

### Price Hash Specification (CRITICAL)

**One bug in hash = catastrophic group duplication.** This spec is canonical.

```go
// services/price-service/internal/pricegroups/hash.go

const HashVersion = 1  // Increment if algorithm changes

// ComputePriceHash generates deterministic hash for a store's price vector.
// MUST be called identically by all scrapers.
func ComputePriceHash(prices []ItemPrice) string {
    // 1. Sort by item_id (ascending, deterministic)
    sort.Slice(prices, func(i, j int) bool {
        return prices[i].ItemID < prices[j].ItemID
    })

    // 2. Build canonical string: "item_id:price:discount\n"
    //    - price in cents (integer)
    //    - discount = 0 if NULL (not omitted!)
    //    - NO anchor_price, NO unit_price (they don't define "same prices")
    var buf bytes.Buffer
    for _, p := range prices {
        discount := p.DiscountPrice
        if discount == nil {
            discount = ptr(0)  // NULL → 0
        }
        fmt.Fprintf(&buf, "%d:%d:%d\n", p.ItemID, p.Price, *discount)
    }

    // 3. SHA256, hex-encoded
    hash := sha256.Sum256(buf.Bytes())
    return hex.EncodeToString(hash[:])
}

type ItemPrice struct {
    ItemID        int64
    Price         int     // cents, NOT NULL
    DiscountPrice *int    // cents, nullable
}
```

**Rules:**
1. **Sort by item_id** - deterministic order
2. **NULL discount → 0** - not omitted, explicit zero
3. **Exclude anchor_price, unit_price** - these don't define price equality
4. **Integer cents only** - no floats, no formatting differences
5. **One implementation** - all scrapers call this function
6. **Version column** - if algorithm changes, bump `hash_version`

**Testing Requirements:**
```go
func TestHashDeterminism(t *testing.T) {
    prices := []ItemPrice{{1, 1299, ptr(999)}, {2, 500, nil}}

    // Same input, 1000 times = same hash
    hash1 := ComputePriceHash(prices)
    for i := 0; i < 1000; i++ {
        assert.Equal(t, hash1, ComputePriceHash(prices))
    }

    // Different order = same hash (sorted internally)
    shuffled := []ItemPrice{{2, 500, nil}, {1, 1299, ptr(999)}}
    assert.Equal(t, hash1, ComputePriceHash(shuffled))

    // NULL vs 0 discount = SAME hash
    withZero := []ItemPrice{{1, 1299, ptr(999)}, {2, 500, ptr(0)}}
    assert.Equal(t, hash1, ComputePriceHash(withZero))
}
```

---

### Schema Design Rationale

| Issue | Solution | Trade-off |
|-------|----------|-----------|
| **Group Identity Crisis** | Groups immutable, identified by `(chain_id, price_hash)`. Same hash = reuse ID. | Group count grows but bounded by actual price variations |
| **Omnibus Write-Bomb** | `item_price_stats` computed async, not in hot table | Slight staleness (computed nightly) |
| **History Tracking** | `store_group_history` with validity ranges | More storage, but enables "price at store X on date Y" |
| **Membership Overlap** | GiST exclusion constraint + partial unique | Prevents bugs, slight insert overhead |
| **Duplicate Items** | `UNIQUE (chain_id, external_id)` | Requires upsert logic in Go |

**Query Patterns Enabled:**
```sql
-- "What was price of item X at store Y on Jan 15?"
SELECT gp.price FROM store_group_history sgh
JOIN group_prices gp ON gp.price_group_id = sgh.price_group_id
WHERE sgh.store_id = $1 AND gp.item_id = $2
  AND sgh.valid_from <= '2025-01-15'
  AND (sgh.valid_to IS NULL OR sgh.valid_to > '2025-01-15');

-- "Current price at store"
SELECT gp.price FROM store_group_history sgh
JOIN group_prices gp ON gp.price_group_id = sgh.price_group_id
WHERE sgh.store_id = $1 AND gp.item_id = $2
  AND sgh.valid_to IS NULL;

-- "Omnibus: lowest price in 30d" (async computed)
SELECT lowest_30d FROM item_price_stats
WHERE chain_id = $1 AND item_id = $2;
```

---

### Known Risks & Future Considerations

**⚠️ Risk 1: Price Group Explosion (Long-term)**
- Minor price changes → new groups
- 1-store, 1-day groups accumulate
- **Mitigation (NOT now):** Similarity-based reuse (99% match), garbage collection, archive to DuckDB

**⚠️ Risk 2: price_hash Stability (ADDRESSED)**
- One canonical hash function in Go
- `hash_version` column for future changes
- Heavy testing required (see spec above)
- All scrapers call same function

**⚠️ Risk 3: store_price_exceptions Complexity**
- Every query: group price + override if exists
- Rule: **Overrides must be rare, explicit, short-lived**
- Expire old exceptions via cron job
- Don't let overrides become the norm

**⚠️ Risk 4: Drizzle + Raw SQL Split Brain**
- Partitions & exclusion constraints in raw SQL
- **Mitigations:**
  - Keep raw SQL minimal (only what Drizzle can't do)
  - Document in `drizzle/README.md`
  - Never casually recreate history tables
  - CI check: `pg_dump --schema-only` matches expected

---

## sqlc Configuration

```yaml
# services/price-service/sqlc.yaml
version: "2"
sql:
  - engine: "postgresql"
    schema: "../../db/schema.sql"  # Generated from Drizzle
    queries: "queries/"
    gen:
      go:
        package: "db"
        out: "internal/db"
        sql_package: "pgx/v5"
        emit_json_tags: true
        emit_empty_slices: true
```

**Workflow:**
```bash
# After Drizzle migration
pnpm drizzle-kit generate
pnpm drizzle-kit migrate

# Generate schema.sql for sqlc
pg_dump --schema-only -d kosarica > db/schema.sql

# Generate Go types
cd services/price-service && sqlc generate
```

---

## Golang Service Structure

```
services/price-service/
├── cmd/server/main.go
├── internal/
│   ├── db/                      # sqlc generated
│   │   ├── db.go
│   │   ├── models.go
│   │   └── queries.sql.go
│   ├── api/
│   │   ├── router.go            # chi
│   │   ├── prices.go
│   │   ├── basket.go
│   │   ├── stores.go
│   │   └── admin.go
│   ├── ingestion/
│   │   ├── scheduler.go         # robfig/cron
│   │   ├── pipeline.go
│   │   └── persist.go
│   ├── scrapers/
│   │   ├── adapter.go
│   │   ├── dm.go
│   │   ├── konzum.go
│   │   └── ... (15 total)
│   ├── pricegroups/
│   │   ├── detector.go
│   │   └── updater.go
│   └── optimizer/
│       ├── engine.go
│       ├── cache.go
│       └── multi.go
├── queries/                     # sqlc queries
│   ├── chains.sql
│   ├── stores.sql
│   ├── items.sql
│   ├── prices.sql
│   └── ingestion.sql
├── go.mod
└── Dockerfile
```

---

## sqlc Queries Example

```sql
-- queries/prices.sql

-- name: GetGroupPrices :many
SELECT * FROM group_prices
WHERE price_group_id = $1;

-- name: UpsertGroupPrice :exec
INSERT INTO group_prices (price_group_id, item_id, price, discount_price, unit_price, updated_at)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (price_group_id, item_id)
DO UPDATE SET
  price = EXCLUDED.price,
  discount_price = EXCLUDED.discount_price,
  unit_price = EXCLUDED.unit_price,
  updated_at = now();

-- name: GetPriceForStore :one
SELECT
  COALESCE(e.price, gp.price) as price,
  COALESCE(e.discount_price, gp.discount_price) as discount_price,
  e.price IS NOT NULL as is_exception
FROM store_group_memberships sgm
JOIN group_prices gp ON gp.price_group_id = sgm.price_group_id
LEFT JOIN store_price_exceptions e ON e.store_id = sgm.store_id AND e.item_id = gp.item_id
WHERE sgm.store_id = $1 AND gp.item_id = $2;

-- name: InsertPriceChange :exec
INSERT INTO price_changes (item_id, price_group_id, store_id, old_price, new_price, changed_at)
VALUES ($1, $2, $3, $4, $5, $6);
```

---

## Simplified Ingestion (No Job Queue)

```go
// internal/ingestion/pipeline.go

type Pipeline struct {
    db       *pgxpool.Pool
    scrapers map[string]scraper.Adapter
    cron     *cron.Cron
}

func (p *Pipeline) Start() {
    // Daily at 6 AM
    p.cron.AddFunc("0 6 * * *", func() {
        p.RunAll(context.Background())
    })
    p.cron.Start()
}

func (p *Pipeline) RunAll(ctx context.Context) {
    for chainSlug, adapter := range p.scrapers {
        if err := p.RunChain(ctx, chainSlug, adapter); err != nil {
            log.Error("ingestion failed", "chain", chainSlug, "error", err)
            // Continue with other chains
        }
    }
}

func (p *Pipeline) RunChain(ctx context.Context, chainSlug string, adapter scraper.Adapter) error {
    run := p.createRun(ctx, chainSlug)
    defer p.completeRun(ctx, run)

    // 1. Discover files
    files, err := adapter.Discover(ctx, time.Now())
    if err != nil {
        return fmt.Errorf("discover: %w", err)
    }

    for _, file := range files {
        // 2. Fetch
        data, err := adapter.Fetch(ctx, file)
        if err != nil {
            run.AddError("fetch", file.Filename, err)
            continue
        }

        // 3. Parse
        rows, err := adapter.Parse(ctx, data, file.Filename)
        if err != nil {
            run.AddError("parse", file.Filename, err)
            continue
        }

        // 4. Persist (idempotent upserts)
        if err := p.persist(ctx, chainSlug, file, rows); err != nil {
            run.AddError("persist", file.Filename, err)
            continue
        }

        run.FilesCount++
        run.ItemsCount += len(rows)
    }

    // 5. Detect price groups after all files processed
    if err := pricegroups.Detect(ctx, p.db, chainSlug); err != nil {
        run.AddError("pricegroups", "", err)
    }

    return nil
}
```

---

## Implementation Phases (Detailed)

### Phase 1: Port to Postgres

**Remove SQLite, add Postgres:**
```bash
pnpm remove better-sqlite3 @types/better-sqlite3
pnpm add postgres
```

**Files to modify:**
- `src/db/index.ts` - postgres-js connection
- `src/db/schema.ts` - convert to pg (auth tables only for now)
- `src/db/custom-types.ts` - update for pg-core
- `drizzle.config.ts` - pg dialect
- `package.json` - deps
- `.env.example` - DATABASE_URL

**Keep as reference (delete in Phase 3):**
- `src/ingestion/` - reference for Go scrapers

**Test:**
- TanStack starts
- Auth flow works
- User can login/signup

---

### Phase 2: Go Service + All 15 Scrapers

**Setup:**
```bash
mkdir -p services/price-service
cd services/price-service
go mod init github.com/fluximus-prime/kosarica-prices
```

**Add tables via Drizzle migration:**
- chains, stores, retailer_items, ingestion_runs

**Go deps:**
- github.com/jackc/pgx/v5
- github.com/go-chi/chi/v5
- github.com/robfig/cron/v3
- github.com/air-verse/air (hot reload in dev, like Vite)

**Dev config:**
```toml
# services/price-service/.air.toml
root = "."
tmp_dir = "tmp"

[build]
cmd = "go build -o ./tmp/main ./cmd/server"
bin = "./tmp/main"
args = ["-port", "3003"]
include_ext = ["go", "sql"]
exclude_dir = ["tmp", "vendor"]
delay = 1000

[misc]
clean_on_exit = true
```

**Dev workflow:**
```bash
# Install air
go install github.com/air-verse/air@latest

# Run with hot reload (like Vite)
cd services/price-service && air

# Or use make
make dev  # runs air with port 3003
```

**Port ALL scrapers at once** (use TS as reference):
- DM, Lidl, Kaufland, Spar, Interspar, Konzum, Plodine,
- Studenac, Tommy, Eurospin, KTC, Ribola, Metro, Trgocentar, NTL

**New store handling:**
- Go discovers new store → insert with status='pending'
- Only 'approved' stores shown to users

**Test:**
- `go build ./cmd/server`
- Manual trigger: all 15 chains ingest
- DB has retailer_items populated

---

### Phase 3: Node.js → Go Integration

**Go internal API** (not public, localhost:8081):
```
GET  /internal/prices/:chainSlug/:storeId
GET  /internal/items/search?q=...
POST /internal/admin/ingest/:chainSlug
GET  /internal/health
```

**Node.js oRPC proxy:**
```typescript
// src/server/api/prices.ts
export const pricesRouter = router({
  getByStore: publicProcedure
    .input(z.object({ chainSlug: z.string(), storeId: z.number() }))
    .query(async ({ input }) => {
      // Call Go service internally
      const res = await fetch(`http://localhost:8081/internal/prices/${input.chainSlug}/${input.storeId}`);
      return res.json();
    }),
});
```

**Delete TS ingestion:**
- `rm -rf src/ingestion/`

**Test:**
- Frontend → Node.js → Go → DB
- Prices display correctly

---

### Phase 4: Price Groups (Go only)

**Add tables via Drizzle:**
- price_groups, group_prices, store_group_memberships, store_price_exceptions

**IMPORTANT: Price groups are DYNAMIC**
- Groups can change daily (stores may join/leave groups)
- Each ingestion run re-detects groups
- Store membership tracked with timestamp
- Historical group membership NOT preserved (only current)

**Detection algorithm:**
1. After ingestion, hash prices per store
2. Group stores with identical hashes
3. Compare to previous groups:
   - Same hash → keep group, update prices
   - New hash → create new group OR reassign store
   - Store changed → update store_group_memberships
4. Store prices at group level
5. Handle exceptions (store-specific promos)

**Test:**
- Run detection after ingestion
- Verify storage reduction
- Verify price lookups still correct
- Run again next day → groups may change

---

### Phase 5: Basket Optimization

**Go service additions:**
- In-memory price cache (refresh on ingestion)
- Single-store optimizer
- Multi-store optimizer (greedy/optimal)

**API:**
```
POST /internal/optimize/single  {basket_items, location}
POST /internal/optimize/multi   {basket_items, location, max_stores}
```

**Test:**
- Optimize basket returns cheapest store
- Multi-store returns valid split

---

### Phase 6: Store Enrichment UI

**Node.js/Frontend:**
- Admin page listing pending stores
- Form to enrich: address, lat/lon, city
- Approve/reject actions

**Go:**
- `PATCH /internal/stores/:id/approve`
- Updates status, sets approvedAt

**Test:**
- New store appears in admin
- Approve → visible to users

---

### Phase 7: Product Matching

**Tables (Drizzle):**
- products, product_links already defined

**Matching pipeline (Go):**
1. Barcode exact match
2. AI name similarity (OpenAI embeddings)
3. Queue uncertain matches for review

**Admin UI:**
- Review uncertain matches
- Manual link/unlink

**Test:**
- Products linked across chains
- Search by product shows all chain prices

---

### Phase 8: Documentation

**Update:**
- `doc/planning/codebase/ARCHITECTURE.md` - new system design
- `doc/planning/codebase/STRUCTURE.md` - Go service structure
- `doc/planning/codebase/STACK.md` - add Go, sqlc, pgx
- `doc/planning/API.md` - internal Go API, oRPC routes

**Create:**
- `doc/planning/DEPLOYMENT.md` - Hetzner setup
- `services/price-service/README.md` - Go service docs

---

## Files Summary

### Create
| Path | Purpose |
|------|---------|
| `services/price-service/` | Go service |
| `db/schema.sql` | Generated for sqlc |
| `doc/planning/DEPLOYMENT.md` | Hetzner setup guide |
| `doc/planning/API.md` | API documentation |

### Modify
| Path | Changes |
|------|---------|
| `src/db/schema.ts` | Convert to pg, add tables incrementally |
| `src/db/index.ts` | postgres-js connection |
| `src/db/custom-types.ts` | pg-core imports |
| `drizzle.config.ts` | postgresql dialect |
| `package.json` | Remove sqlite deps |
| `.env.example` | DATABASE_URL |
| `doc/planning/codebase/*.md` | Architecture updates |

### Delete (Phase 3, after Go works)
| Path | Reason |
|------|--------|
| `src/ingestion/` | Replaced by Go |
| `drizzle/*.sql` | Old SQLite migrations |

---

## Verification (per phase)

**Phase 1:**
- `psql $DATABASE_URL -c "\\dt"` - tables exist
- `pnpm dev` - TanStack starts
- Login/signup works

**Phase 2:**
- `cd services/price-service && go build ./cmd/server`
- `curl localhost:8081/internal/health`
- `curl -X POST localhost:8081/internal/admin/ingest/dm`
- All 15 chains ingest without errors

**Phase 3:**
- Frontend price display works
- `src/ingestion/` deleted
- No direct Go access from browser (internal only)

**Phase 4:**
- Price groups detected after ingestion
- `SELECT COUNT(*) FROM group_prices` < `SELECT COUNT(*) FROM retailer_items`
- Price lookups return correct values

**Phase 5:**
- `POST /api/basket/optimize` returns cheapest store
- Multi-store optimization works

**Phase 6:**
- New store from ingestion → appears in admin
- Approve → visible to users

**Phase 7:**
- Products linked across chains
- Search shows all chain prices

**Phase 8:**
- `doc/planning/` updated
- `services/price-service/README.md` complete
