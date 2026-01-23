# Database

## Schema Authority

**Drizzle ORM is the source of truth for ALL database tables.**

- Schema defined in `src/db/schema.ts`
- Go service reads schema, never writes migrations
- Both Node.js and Go connect to the same PostgreSQL database

### Migration Workflow

```bash
# 1. Modify schema definition
vim src/db/schema.ts

# 2. Generate migration (creates SQL in drizzle/)
pnpm db:generate

# 3. Review generated migration
cat drizzle/000X_*.sql

# 4. Apply migration to database
pnpm db:migrate
```

After migration is applied, Go service auto-reads the updated schema on next query.

### Migration Safety

- Always backup before migrating
- Test migrations on staging first
- No automatic rollback (manual SQL if needed)
- For concurrent deploys: use advisory locks

## Core Entities (ERD)

```mermaid
erDiagram
    chains ||--o{ stores : has
    stores ||--o{ store_group_history : "price snapshots"
    price_groups ||--o{ store_group_history : "stores with this price set"
    price_groups ||--o{ group_prices : contains
    retailer_items ||--o{ group_prices : "priced in group"
    retailer_items ||--o{ product_links : "linked to"
    products ||--o{ product_links : "linked from items"

    chains {
        id pk
        slug uk
        name
    }

    stores {
        id pk
        chain_id fk
        external_id
        name
        address
        latitude
        longitude
        status
    }

    price_groups {
        id pk
        hash uk "SHA-256 of all prices"
        valid_from
        valid_to
    }

    store_group_history {
        id pk
        store_id fk
        price_group_id fk
        valid_from
        valid_to
    }

    retailer_items {
        id pk
        chain_id fk
        external_id uk
        name
    }

    group_prices {
        id pk
        price_group_id fk
        retailer_item_id fk
        price_cents
    }

    products {
        id pk
        name
        category
    }

    product_links {
        id pk
        retailer_item_id fk
        product_id fk
        verified
    }
```

## Table Relationships

```
chains 1───* stores 1───* store_group_history *───1 price_groups
                                                    │
retailer_items 1───* group_prices ─────────────────┘
      │
      └───* product_links *───1 products
```

## Price Groups (Content-Addressable Storage)

### Concept

Instead of storing price per store per item, we group identical price sets:

- Compute SHA-256 hash of all (item_id, price) pairs
- Stores with same prices share the same `price_group`
- New prices = new group (immutable)

### Benefits

- ~50% storage reduction (most stores have identical prices)
- Easy historical queries (point-in-time via `store_group_history`)
- Efficient diffing between time periods

### Schema

```sql
CREATE TABLE price_groups (
    id TEXT PRIMARY KEY,
    hash TEXT UNIQUE NOT NULL,           -- SHA-256 of sorted prices
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ                 -- NULL = current
);

CREATE TABLE store_group_history (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id),
    price_group_id TEXT REFERENCES price_groups(id),
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ                 -- NULL = current
);

CREATE TABLE group_prices (
    id TEXT PRIMARY KEY,
    price_group_id TEXT REFERENCES price_groups(id),
    retailer_item_id TEXT REFERENCES retailer_items(id),
    price_cents INTEGER NOT NULL
);
```

## Query Examples

### Current Price for Item in Store

```sql
SELECT gp.price_cents
FROM store_group_history sgh
JOIN price_groups pg ON sgh.price_group_id = pg.id
JOIN group_prices gp ON gp.price_group_id = pg.id
JOIN retailer_items ri ON gp.retailer_item_id = ri.id
WHERE sgh.store_id = $1
  AND ri.external_id = $2
  AND sgh.valid_to IS NULL
  AND pg.valid_to IS NULL;
```

### Price History for Item

```sql
SELECT sgh.valid_from, gp.price_cents
FROM store_group_history sgh
JOIN price_groups pg ON sgh.price_group_id = pg.id
JOIN group_prices gp ON gp.price_group_id = pg.id
JOIN retailer_items ri ON gp.retailer_item_id = ri.id
WHERE sgh.store_id = $1
  AND ri.external_id = $2
ORDER BY sgh.valid_from DESC;
```

## Index Strategy

Key indexes for performance:

- `stores(chain_id, status)` - Filter stores by chain
- `store_group_history(store_id, valid_from DESC)` - Time-series queries
- `price_groups(hash)` - Deduplication lookup
- `product_links(retailer_item_id)` - Reverse lookup for matching
- `retailer_items(chain_id, external_id)` - Unique lookups

## Connection Pools

### Node.js (Drizzle + postgres-js)
```typescript
// src/db/index.ts
const pool = postgres(process.env.DATABASE_URL!, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});
```

### Go (pgx)
```go
// services/price-service/internal/database/db.go
config.MaxConns = 25
config.MinConns = 5
config.MaxConnLifetime = time.Hour
config.MaxConnIdleTime = 30 * time.Minute
```

## Backup Strategy

- **Daily**: `pg_dump` compressed backup
- **WAL Archiving**: Enable for point-in-time recovery
- **Retention**: 30 days local, offsite for longer

```bash
# Manual backup
pg_dump $DATABASE_URL | gzip > backup_$(date +%Y%m%d).sql.gz

# Restore
gunzip < backup_20240121.sql.gz | psql $DATABASE_URL
```

## Schema Export for sqlc (Alternative Workflow)

While the project uses hand-written SQL with pgx (per ADR-001), here's how to maintain sqlc compatibility if needed:

### Automated Schema Sync Process

```bash
# 1. Modify schema definition
vim src/db/schema.ts

# 2. Generate and apply migration
pnpm db:generate
pnpm db:migrate

# 3. Export current schema from database
pg_dump --schema-only --no-owner --no-privileges $DATABASE_URL > src/db/tasks/schema.sql

# 4. Generate sqlc code (if using sqlc)
cd services/price-service && sqlc generate
```

### Schema Export Details

- **Source**: `src/db/schema.ts` (Drizzle ORM definition)
- **Migrations**: `drizzle/` directory (generated SQL files)
- **Exported Schema**: `src/db/tasks/schema.sql` (pg_dump output)
- **sqlc Config**: `services/price-service/sqlc.yaml` (if implemented)

This ensures the sqlc schema file stays in sync with database changes automatically.
