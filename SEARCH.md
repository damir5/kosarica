# MASTER BLUEPRINT: PostgreSQL Full-Text Search for Kosarica

> **Do not simplify, optimize, or "improve" anything. Follow exactly.**

---

## 1. THE MANIFESTO

### 1.1 One-Line Goal

A unified PostgreSQL Full-Text Search system for products, retailer items, and stores with Croatian language support, typo tolerance, and autocomplete functionality.

### 1.2 Explicit Non-Goals (NO-GO LIST)

- Do NOT add Redis or external caching layer
- Do NOT use Elasticsearch, Typesense, or Meilisearch
- Do NOT create frontend components (API only in this blueprint)
- Do NOT modify ClickHouse schema or queries
- Do NOT add stock/availability filtering logic
- Do NOT add facet count aggregations

### 1.3 Deferred (Future Enhancement)

**Croatian Hunspell Dictionaries** - Evaluated with Codex review:
- Hunspell helps with multi-word inflected queries (`bijelog kruha`, `svježeg mlijeka`)
- Requires ops work: install `hr_HR.aff`/`hr_HR.dic` in Postgres `tsearch_data/`
- **Decision:** Start with `simple + trigram`, add Hunspell if eval shows need
- **Schema designed for dual-channel upgrade** (see Appendix A)

### 1.4 Locked Tech Stack

| Component | Version/Tool |
|-----------|-------------|
| Database | PostgreSQL 16 |
| ORM | Drizzle ORM 0.45.x |
| Extensions | `pg_trgm` (existing), `unaccent` (add) |
| Runtime | Node.js (existing) |
| API | oRPC (existing) |
| Validation | Zod (existing) |

### 1.5 Locked Assumptions

- ASSUMPTION: <100 searches/min (user confirmed) → no caching needed
- ASSUMPTION: Unified search across all entity types (user confirmed)
- ASSUMPTION: No stock-based ranking (user confirmed "always include equally")
- ASSUMPTION: Search index updates in ingestion pipeline (user confirmed)
- ASSUMPTION: Prices fetched separately from ClickHouse after search (user confirmed)

---

## 2. PROJECT SKELETON (FILE TREE)

```
/src
  /db
    schema.ts                    # MODIFY: add searchIndex table
  /lib
    /search
      index.ts                   # CREATE: indexing service
      queries.ts                 # CREATE: search query functions
      types.ts                   # CREATE: shared type definitions
  /orpc
    /router
      index.ts                   # MODIFY: add search namespace
      search.ts                  # CREATE: oRPC search endpoints
  /ingestion
    pipeline.ts                  # MODIFY: add search indexing step
/scripts
  backfill-search-index.ts       # CREATE: backfill script
/drizzle
  XXXX_add_search_index.sql      # GENERATED: migration file
```

---

## 3. DATA MODELS & CONTRACTS

### 3.1 Database Schema

**Table: `search_index`**

```sql
CREATE TABLE search_index (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('product', 'item', 'store')),
  entity_id TEXT NOT NULL,
  chain_slug TEXT,
  category TEXT,
  subcategory TEXT,

  title TEXT NOT NULL,
  subtitle TEXT,
  body TEXT,

  title_normalized TEXT GENERATED ALWAYS AS (hr_normalize(title)) STORED,
  body_normalized TEXT GENERATED ALWAYS AS (
    hr_normalize(COALESCE(title, '') || ' ' || COALESCE(subtitle, '') || ' ' || COALESCE(body, ''))
  ) STORED,

  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', hr_normalize(COALESCE(title, ''))), 'A') ||
    setweight(to_tsvector('simple', hr_normalize(COALESCE(subtitle, ''))), 'B') ||
    setweight(to_tsvector('simple', hr_normalize(COALESCE(body, ''))), 'C')
  ) STORED,

  autocomplete_text TEXT GENERATED ALWAYS AS (LEFT(hr_normalize(title), 50)) STORED,

  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT search_index_entity_unique UNIQUE (entity_type, entity_id)
);
```

**Required SQL Functions:**

```sql
-- Immutable wrapper for unaccent (required for generated columns)
CREATE OR REPLACE FUNCTION immutable_unaccent(TEXT)
RETURNS TEXT AS $$
  SELECT public.unaccent('public.unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- Croatian normalization
CREATE OR REPLACE FUNCTION hr_normalize(input TEXT)
RETURNS TEXT AS $$
  SELECT LOWER(
    TRANSLATE(
      immutable_unaccent(COALESCE(input, '')),
      'čćđšžČĆĐŠŽ',
      'ccdjszCCDJSZ'
    )
  )
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;
```

**Indexes:**

```sql
CREATE INDEX search_index_fts_idx ON search_index USING GIN (search_vector);
CREATE INDEX search_index_trgm_title_idx ON search_index USING GIN (title_normalized gin_trgm_ops);
CREATE INDEX search_index_trgm_body_idx ON search_index USING GIN (body_normalized gin_trgm_ops);
CREATE INDEX search_index_autocomplete_idx ON search_index USING GIN (autocomplete_text gin_trgm_ops);
CREATE INDEX search_index_entity_type_idx ON search_index (entity_type);
CREATE INDEX search_index_chain_slug_idx ON search_index (chain_slug) WHERE chain_slug IS NOT NULL;
CREATE INDEX search_index_category_idx ON search_index (category) WHERE category IS NOT NULL;
```

### 3.2 TypeScript Types

**File: `/src/lib/search/types.ts`**

```typescript
export type SearchEntityType = "product" | "item" | "store";

export interface IndexedEntity {
  entityType: SearchEntityType;
  entityId: string;
  chainSlug: string | null;
  category: string | null;
  subcategory: string | null;
  title: string;
  subtitle: string | null;
  body: string | null;
  imageUrl: string | null;
}

export interface AutocompleteResult {
  id: string;
  entityType: SearchEntityType;
  entityId: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
}

export interface FullSearchResult extends AutocompleteResult {
  chainSlug: string | null;
  category: string | null;
  body: string | null;
  score: number;
  highlights: {
    title: string | null;
    body: string | null;
  };
}

export interface SearchFilters {
  entityTypes?: SearchEntityType[];
  chainSlug?: string;
  category?: string;
}
```

### 3.3 API Contracts

**Autocomplete Endpoint:**

```
search.autocomplete(input) -> AutocompleteResult[]

Input:
  query: string (min 2 chars)
  limit: number (1-20, default 10)
  filters?: { entityTypes?, chainSlug?, category? }

Output: AutocompleteResult[]

Errors:
  - ZodValidationError if query < 2 chars
```

**Full Search Endpoint:**

```
search.search(input) -> { results, total, query }

Input:
  query: string (min 2 chars)
  limit: number (1-100, default 20)
  offset: number (min 0, default 0)
  filters?: { entityTypes?, chainSlug?, category? }

Output:
  results: FullSearchResult[]
  total: number
  query: string

Errors:
  - ZodValidationError if query < 2 chars
```

---

## 4. ATOMIC IMPLEMENTATION STEPS

### Step 1: Create Migration for unaccent Extension and Functions

**Objective:** Enable unaccent extension and create hr_normalize function.

**Files Touched:**
- `drizzle/XXXX_add_search_fts.sql` (generated via `pnpm db:generate`)

**Instructions to Coding Agent:**

1. Create a new SQL migration file manually at `drizzle/migrations/XXXX_add_search_fts.sql`
2. Add the following SQL exactly:

```sql
-- Enable unaccent extension
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Immutable wrapper for unaccent (required for generated columns)
CREATE OR REPLACE FUNCTION immutable_unaccent(TEXT)
RETURNS TEXT AS $$
  SELECT public.unaccent('public.unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- Croatian normalization function
CREATE OR REPLACE FUNCTION hr_normalize(input TEXT)
RETURNS TEXT AS $$
  SELECT LOWER(
    TRANSLATE(
      immutable_unaccent(COALESCE(input, '')),
      'čćđšžČĆĐŠŽ',
      'ccdjszCCDJSZ'
    )
  )
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;
```

3. Do NOT run the migration yet - it will be combined with Step 2.

---

### Step 2: Add search_index Table to Drizzle Schema

**Objective:** Define the search_index table in Drizzle schema.

**Files Touched:**
- `/src/db/schema.ts`

**Instructions to Coding Agent:**

1. Open `/src/db/schema.ts`
2. Add the following import if not present: `import { uniqueIndex, index } from "drizzle-orm/pg-core";`
3. Add the following table definition after the existing tables (around line 800):

```typescript
// Search index for unified FTS
export const searchIndex = pgTable(
  "search_index",
  {
    id: cuid2("six").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    chainSlug: text("chain_slug"),
    category: text("category"),
    subcategory: text("subcategory"),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    body: text("body"),
    // Generated columns are read-only - omit from Drizzle, they exist in DB
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("search_index_entity_unique").on(table.entityType, table.entityId),
    index("search_index_entity_type_idx").on(table.entityType),
    index("search_index_chain_slug_idx").on(table.chainSlug),
    index("search_index_category_idx").on(table.category),
  ],
);
```

4. Run `pnpm db:generate` to generate the migration.
5. **IMPORTANT:** Manually edit the generated migration to:
   - Add the SQL from Step 1 at the TOP
   - Add the generated columns and GIN indexes AFTER the table creation

The final migration should have this structure:
```sql
-- 1. Extension and functions (from Step 1)
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE OR REPLACE FUNCTION immutable_unaccent...
CREATE OR REPLACE FUNCTION hr_normalize...

-- 2. Table creation (from Drizzle generate)
CREATE TABLE search_index (
  ...columns from Drizzle...
);

-- 3. Add generated columns (manual)
ALTER TABLE search_index
ADD COLUMN title_normalized TEXT GENERATED ALWAYS AS (hr_normalize(title)) STORED,
ADD COLUMN body_normalized TEXT GENERATED ALWAYS AS (
  hr_normalize(COALESCE(title, '') || ' ' || COALESCE(subtitle, '') || ' ' || COALESCE(body, ''))
) STORED,
ADD COLUMN search_vector TSVECTOR GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', hr_normalize(COALESCE(title, ''))), 'A') ||
  setweight(to_tsvector('simple', hr_normalize(COALESCE(subtitle, ''))), 'B') ||
  setweight(to_tsvector('simple', hr_normalize(COALESCE(body, ''))), 'C')
) STORED,
ADD COLUMN autocomplete_text TEXT GENERATED ALWAYS AS (LEFT(hr_normalize(title), 50)) STORED;

-- 4. GIN indexes (manual)
CREATE INDEX search_index_fts_idx ON search_index USING GIN (search_vector);
CREATE INDEX search_index_trgm_title_idx ON search_index USING GIN (title_normalized gin_trgm_ops);
CREATE INDEX search_index_trgm_body_idx ON search_index USING GIN (body_normalized gin_trgm_ops);
CREATE INDEX search_index_autocomplete_idx ON search_index USING GIN (autocomplete_text gin_trgm_ops);
```

6. Run `pnpm db:migrate` to apply the migration.

---

### Step 3: Create Search Types File

**Objective:** Define shared TypeScript types for search functionality.

**Files Touched:**
- `/src/lib/search/types.ts` (CREATE)

**Instructions to Coding Agent:**

1. Create directory `/src/lib/search/` if it doesn't exist
2. Create file `/src/lib/search/types.ts` with this exact content:

```typescript
export type SearchEntityType = "product" | "item" | "store";

export interface IndexedEntity {
  entityType: SearchEntityType;
  entityId: string;
  chainSlug: string | null;
  category: string | null;
  subcategory: string | null;
  title: string;
  subtitle: string | null;
  body: string | null;
  imageUrl: string | null;
}

export interface AutocompleteResult {
  id: string;
  entityType: SearchEntityType;
  entityId: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
}

export interface FullSearchResult extends AutocompleteResult {
  chainSlug: string | null;
  category: string | null;
  body: string | null;
  score: number;
  highlights: {
    title: string | null;
    body: string | null;
  };
}

export interface SearchFilters {
  entityTypes?: SearchEntityType[];
  chainSlug?: string;
  category?: string;
}
```

---

### Step 4: Create Search Indexing Service

**Objective:** Implement functions to index entities into search_index table.

**Files Touched:**
- `/src/lib/search/index.ts` (CREATE)

**Instructions to Coding Agent:**

1. Create file `/src/lib/search/index.ts`
2. Import from existing codebase patterns:
   - Use `getDb()` from `@/utils/bindings` (matches existing pattern in `/src/lib/matching/index.ts`)
   - Use `generatePrefixedId()` from `@/utils/id`
   - Use `createLogger()` from `@/utils/logger`
3. Implement these functions exactly:

```typescript
import { eq, sql, inArray } from "drizzle-orm";
import {
  searchIndex,
  products,
  retailerItems,
  stores,
  chains,
} from "@/db/schema";
import { getDb } from "@/utils/bindings";
import { generatePrefixedId } from "@/utils/id";
import { createLogger } from "@/utils/logger";
import type { IndexedEntity, SearchEntityType } from "./types";

const log = createLogger("search");

export { type SearchEntityType, type IndexedEntity } from "./types";

async function upsertSearchIndex(entity: IndexedEntity): Promise<void> {
  const db = getDb();

  await db
    .insert(searchIndex)
    .values({
      id: generatePrefixedId("six"),
      entityType: entity.entityType,
      entityId: entity.entityId,
      chainSlug: entity.chainSlug,
      category: entity.category,
      subcategory: entity.subcategory,
      title: entity.title,
      subtitle: entity.subtitle,
      body: entity.body,
      imageUrl: entity.imageUrl,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [searchIndex.entityType, searchIndex.entityId],
      set: {
        chainSlug: entity.chainSlug,
        category: entity.category,
        subcategory: entity.subcategory,
        title: entity.title,
        subtitle: entity.subtitle,
        body: entity.body,
        imageUrl: entity.imageUrl,
        updatedAt: new Date(),
      },
    });
}

export async function indexProduct(productId: string): Promise<void> {
  const db = getDb();

  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  if (!product) {
    log.warn("Product not found for indexing", { productId });
    return;
  }

  await upsertSearchIndex({
    entityType: "product",
    entityId: product.id,
    chainSlug: null,
    category: product.category ?? null,
    subcategory: product.subcategory ?? null,
    title: product.name,
    subtitle: product.brand ?? null,
    body: [product.description, product.category, product.subcategory]
      .filter(Boolean)
      .join(" ") || null,
    imageUrl: product.imageUrl ?? null,
  });
}

export async function indexRetailerItem(itemId: string): Promise<void> {
  const db = getDb();

  const [item] = await db
    .select()
    .from(retailerItems)
    .where(eq(retailerItems.id, itemId))
    .limit(1);

  if (!item) {
    log.warn("Retailer item not found for indexing", { itemId });
    return;
  }

  await upsertSearchIndex({
    entityType: "item",
    entityId: item.id,
    chainSlug: item.chainSlug ?? null,
    category: item.category ?? null,
    subcategory: item.subcategory ?? null,
    title: item.name,
    subtitle: item.brand ?? null,
    body: [item.description, item.category, item.subcategory, item.brand]
      .filter(Boolean)
      .join(" ") || null,
    imageUrl: item.imageUrl ?? null,
  });
}

export async function indexStore(storeId: string): Promise<void> {
  const db = getDb();

  const result = await db
    .select({
      store: stores,
      chainName: chains.name,
    })
    .from(stores)
    .innerJoin(chains, eq(chains.slug, stores.chainSlug))
    .where(eq(stores.id, storeId))
    .limit(1);

  const row = result[0];
  if (!row) {
    log.warn("Store not found for indexing", { storeId });
    return;
  }

  const store = row.store;
  await upsertSearchIndex({
    entityType: "store",
    entityId: store.id,
    chainSlug: store.chainSlug ?? null,
    category: null,
    subcategory: null,
    title: store.name,
    subtitle: row.chainName,
    body: [store.address, store.city, store.postalCode, row.chainName]
      .filter(Boolean)
      .join(" ") || null,
    imageUrl: null,
  });
}

export async function indexRetailerItemsBatch(itemIds: string[]): Promise<number> {
  if (itemIds.length === 0) return 0;

  const db = getDb();
  const batchSize = 500;
  let indexed = 0;

  for (let i = 0; i < itemIds.length; i += batchSize) {
    const batchIds = itemIds.slice(i, i + batchSize);

    const items = await db
      .select()
      .from(retailerItems)
      .where(inArray(retailerItems.id, batchIds));

    if (items.length === 0) continue;

    const values = items.map((item) => ({
      id: generatePrefixedId("six"),
      entityType: "item" as const,
      entityId: item.id,
      chainSlug: item.chainSlug ?? null,
      category: item.category ?? null,
      subcategory: item.subcategory ?? null,
      title: item.name,
      subtitle: item.brand ?? null,
      body: [item.description, item.category, item.subcategory, item.brand]
        .filter(Boolean)
        .join(" ") || null,
      imageUrl: item.imageUrl ?? null,
      updatedAt: new Date(),
    }));

    await db
      .insert(searchIndex)
      .values(values)
      .onConflictDoUpdate({
        target: [searchIndex.entityType, searchIndex.entityId],
        set: {
          chainSlug: sql`excluded.chain_slug`,
          category: sql`excluded.category`,
          subcategory: sql`excluded.subcategory`,
          title: sql`excluded.title`,
          subtitle: sql`excluded.subtitle`,
          body: sql`excluded.body`,
          imageUrl: sql`excluded.image_url`,
          updatedAt: sql`excluded.updated_at`,
        },
      });

    indexed += items.length;
  }

  log.info("Batch indexed retailer items", { indexed, total: itemIds.length });
  return indexed;
}

export async function removeFromSearchIndex(
  entityType: SearchEntityType,
  entityId: string,
): Promise<void> {
  const db = getDb();

  await db
    .delete(searchIndex)
    .where(
      sql`${searchIndex.entityType} = ${entityType} AND ${searchIndex.entityId} = ${entityId}`,
    );
}
```

---

### Step 5: Create Search Query Functions

**Objective:** Implement autocomplete and full search queries with PARAMETERIZED QUERIES (no SQL injection).

**Files Touched:**
- `/src/lib/search/queries.ts` (CREATE)

**Instructions to Coding Agent:**

1. Create file `/src/lib/search/queries.ts` with this exact content:

> **CRITICAL:** This code uses Drizzle's `sql` template literals for parameterization.
> DO NOT use `sql.raw()` with user input. DO NOT use string interpolation for filter values.
> Use `websearch_to_tsquery` for robust user input handling.
> Use `ts_rank_cd` (cover density) for better product title ranking.

```typescript
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/utils/bindings";
import type { AutocompleteResult, FullSearchResult, SearchFilters, SearchEntityType } from "./types";
import { createLogger } from "@/utils/logger";

const log = createLogger("search");

// Allowed entity types for whitelist validation
const VALID_ENTITY_TYPES = new Set(["product", "item", "store"]);

function validateEntityTypes(types: string[]): SearchEntityType[] {
  return types.filter((t) => VALID_ENTITY_TYPES.has(t)) as SearchEntityType[];
}

export async function autocompleteSearch(
  query: string,
  limit: number = 10,
  filters?: SearchFilters,
): Promise<AutocompleteResult[]> {
  const normalizedQuery = query.toLowerCase().trim();

  if (normalizedQuery.length < 2) {
    return [];
  }

  const db = getDb();
  const prefixPattern = `${normalizedQuery}%`;

  // Build parameterized filter conditions
  const conditions: SQL[] = [
    sql`(
      autocomplete_text LIKE ${prefixPattern}
      OR similarity(autocomplete_text, ${normalizedQuery}) > 0.3
    )`,
  ];

  if (filters?.entityTypes?.length) {
    const validTypes = validateEntityTypes(filters.entityTypes);
    if (validTypes.length > 0) {
      conditions.push(sql`entity_type = ANY(${validTypes})`);
    }
  }
  if (filters?.chainSlug) {
    conditions.push(sql`chain_slug = ${filters.chainSlug}`);
  }
  if (filters?.category) {
    conditions.push(sql`category = ${filters.category}`);
  }

  const whereClause = sql.join(conditions, sql` AND `);

  const results = await db.execute<{
    id: string;
    entityType: SearchEntityType;
    entityId: string;
    title: string;
    subtitle: string | null;
    imageUrl: string | null;
  }>(sql`
    SELECT
      id,
      entity_type as "entityType",
      entity_id as "entityId",
      title,
      subtitle,
      image_url as "imageUrl"
    FROM search_index
    WHERE ${whereClause}
    ORDER BY
      CASE WHEN autocomplete_text LIKE ${prefixPattern} THEN 0 ELSE 1 END,
      similarity(autocomplete_text, ${normalizedQuery}) DESC,
      title
    LIMIT ${limit}
  `);

  return results.rows ?? [];
}

export async function fullSearch(
  query: string,
  limit: number = 20,
  offset: number = 0,
  filters?: SearchFilters,
): Promise<{ results: FullSearchResult[]; total: number }> {
  const normalizedQuery = query.toLowerCase().trim();

  if (normalizedQuery.length < 2) {
    return { results: [], total: 0 };
  }

  const db = getDb();

  // Build parameterized filter conditions
  const filterConditions: SQL[] = [];

  if (filters?.entityTypes?.length) {
    const validTypes = validateEntityTypes(filters.entityTypes);
    if (validTypes.length > 0) {
      filterConditions.push(sql`entity_type = ANY(${validTypes})`);
    }
  }
  if (filters?.chainSlug) {
    filterConditions.push(sql`chain_slug = ${filters.chainSlug}`);
  }
  if (filters?.category) {
    filterConditions.push(sql`category = ${filters.category}`);
  }

  const filterClause = filterConditions.length > 0
    ? sql`AND ${sql.join(filterConditions, sql` AND `)}`
    : sql``;

  // Use websearch_to_tsquery for robust user input parsing
  // Use ts_rank_cd (cover density) for better product title matching
  const searchQuery = sql`
    WITH q AS (
      SELECT
        websearch_to_tsquery('simple', ${normalizedQuery}) AS tsq,
        ${normalizedQuery} AS nq
    ),
    search_results AS (
      SELECT
        s.id,
        s.entity_type,
        s.entity_id,
        s.chain_slug,
        s.category,
        s.title,
        s.subtitle,
        s.body,
        s.image_url,
        (
          COALESCE(ts_rank_cd(s.search_vector, q.tsq, 32), 0) * 0.7 +
          GREATEST(
            similarity(s.title_normalized, q.nq),
            similarity(s.body_normalized, q.nq) * 0.5
          ) * 0.3
        ) as score,
        ts_headline('simple', s.title, q.tsq,
          'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15'
        ) as title_highlight,
        ts_headline('simple', COALESCE(s.body, ''), q.tsq,
          'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15'
        ) as body_highlight
      FROM search_index s
      CROSS JOIN q
      WHERE (
        s.search_vector @@ q.tsq
        OR s.title_normalized % q.nq
        OR s.body_normalized % q.nq
      )
      ${filterClause}
    )
    SELECT
      id,
      entity_type as "entityType",
      entity_id as "entityId",
      chain_slug as "chainSlug",
      category,
      title,
      subtitle,
      body,
      image_url as "imageUrl",
      score,
      title_highlight as "titleHighlight",
      body_highlight as "bodyHighlight"
    FROM search_results
    WHERE score > 0.05
    ORDER BY score DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const countQuery = sql`
    WITH q AS (
      SELECT
        websearch_to_tsquery('simple', ${normalizedQuery}) AS tsq,
        ${normalizedQuery} AS nq
    )
    SELECT COUNT(*) as total
    FROM search_index s
    CROSS JOIN q
    WHERE (
      s.search_vector @@ q.tsq
      OR s.title_normalized % q.nq
      OR s.body_normalized % q.nq
    )
    ${filterClause}
  `;

  const [resultsRaw, countRaw] = await Promise.all([
    db.execute(searchQuery),
    db.execute(countQuery),
  ]);

  type RawResult = {
    id: string;
    entityType: SearchEntityType;
    entityId: string;
    chainSlug: string | null;
    category: string | null;
    title: string;
    subtitle: string | null;
    body: string | null;
    imageUrl: string | null;
    score: number;
    titleHighlight: string | null;
    bodyHighlight: string | null;
  };

  const rows = (resultsRaw.rows ?? []) as RawResult[];
  const total = Number((countRaw.rows as { total: string }[])?.[0]?.total ?? 0);

  const results: FullSearchResult[] = rows.map((row) => ({
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    chainSlug: row.chainSlug,
    category: row.category,
    title: row.title,
    subtitle: row.subtitle,
    body: row.body,
    imageUrl: row.imageUrl,
    score: Number(row.score),
    highlights: {
      title: row.titleHighlight,
      body: row.bodyHighlight,
    },
  }));

  return { results, total };
}
```

---

### Step 6: Create oRPC Search Endpoints

**Objective:** Expose search functionality via oRPC API.

**Files Touched:**
- `/src/orpc/router/search.ts` (CREATE)

**Instructions to Coding Agent:**

1. Create file `/src/orpc/router/search.ts` with this exact content:

```typescript
import { z } from "zod";
import { procedure } from "../base";
import { autocompleteSearch, fullSearch } from "@/lib/search/queries";
import type { SearchFilters } from "@/lib/search/types";

const EntityTypeSchema = z.enum(["product", "item", "store"]);

const SearchFiltersSchema = z
  .object({
    entityTypes: z.array(EntityTypeSchema).optional(),
    chainSlug: z.string().optional(),
    category: z.string().optional(),
  })
  .optional();

const AutocompleteResultSchema = z.object({
  id: z.string(),
  entityType: EntityTypeSchema,
  entityId: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  imageUrl: z.string().nullable(),
});

const FullSearchResultSchema = AutocompleteResultSchema.extend({
  chainSlug: z.string().nullable(),
  category: z.string().nullable(),
  body: z.string().nullable(),
  score: z.number(),
  highlights: z.object({
    title: z.string().nullable(),
    body: z.string().nullable(),
  }),
});

export const autocomplete = procedure
  .input(
    z.object({
      query: z.string().min(2, "Query must be at least 2 characters"),
      limit: z.number().int().min(1).max(20).default(10),
      filters: SearchFiltersSchema,
    }),
  )
  .output(z.array(AutocompleteResultSchema))
  .handler(async ({ input }) => {
    const results = await autocompleteSearch(
      input.query,
      input.limit,
      input.filters as SearchFilters | undefined,
    );
    return results;
  });

export const search = procedure
  .input(
    z.object({
      query: z.string().min(2, "Query must be at least 2 characters"),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
      filters: SearchFiltersSchema,
    }),
  )
  .output(
    z.object({
      results: z.array(FullSearchResultSchema),
      total: z.number(),
      query: z.string(),
    }),
  )
  .handler(async ({ input }) => {
    const { results, total } = await fullSearch(
      input.query,
      input.limit,
      input.offset,
      input.filters as SearchFilters | undefined,
    );

    return {
      results,
      total,
      query: input.query,
    };
  });
```

---

### Step 7: Register Search Router

**Objective:** Add search endpoints to the main oRPC router.

**Files Touched:**
- `/src/orpc/router/index.ts`

**Instructions to Coding Agent:**

1. Open `/src/orpc/router/index.ts`
2. Add import at the top (after existing imports, around line 48):
```typescript
import * as search from "./search";
```

3. Add to the default export object (after `prices` block, around line 71):
```typescript
search: {
  autocomplete: search.autocomplete,
  search: search.search,
},
```

The result should look like:
```typescript
export default {
  listTodos,
  addTodo,
  basket: { ... },
  prices: { ... },
  search: {
    autocomplete: search.autocomplete,
    search: search.search,
  },
  admin: { ... },
};
```

---

### Step 8: Integrate Search Indexing into Ingestion Pipeline

**Objective:** Update search index after item persistence during ingestion.

**Files Touched:**
- `/src/ingestion/pipeline.ts`

**Instructions to Coding Agent:**

1. Open `/src/ingestion/pipeline.ts`
2. Add import at the top (with other imports):
```typescript
import { indexRetailerItemsBatch } from "@/lib/search";
```

3. Find line ~1851 (after `await recordParquetFile(chainSlug, targetDate, parquetKey);`)
4. Add the following code block immediately after `parquetDurationMs = Date.now() - parquetStartedAt;` (around line 1851):

```typescript
    // Index items for search
    let searchIndexDurationMs = 0;
    if (parquetRows.length > 0) {
      const searchIndexStartedAt = Date.now();
      const itemIdsToIndex = [...new Set(parquetRows.map((r) => r.retailer_item_id))];

      try {
        await indexRetailerItemsBatch(itemIdsToIndex);
        searchIndexDurationMs = Date.now() - searchIndexStartedAt;
        log.info("Search index updated", {
          indexed: itemIdsToIndex.length,
          durationMs: searchIndexDurationMs,
        });
      } catch (searchError) {
        // Don't fail ingestion if search indexing fails
        log.warn("Search indexing failed (non-fatal)", {
          error: errorToObject(searchError),
          itemCount: itemIdsToIndex.length,
        });
      }
    }
```

5. Update the metadata object in the `db.update(ingestionRuns)` call to include search index timing:
   - Find `parquetMs: parquetDurationMs,` (around line 1871)
   - Add after it: `searchIndexMs: searchIndexDurationMs,`

---

### Step 9: Create Backfill Script

**Objective:** Script to populate search_index with existing data.

**Files Touched:**
- `/scripts/backfill-search-index.ts` (CREATE)

**Instructions to Coding Agent:**

1. Create file `/scripts/backfill-search-index.ts` with this exact content:

```typescript
#!/usr/bin/env tsx
/**
 * Backfill search_index table with existing data
 * Usage: pnpm tsx scripts/backfill-search-index.ts [--products] [--items] [--stores]
 * No args = backfill all
 */

import { sql, eq } from "drizzle-orm";
import { getDatabase } from "@/db";
import { products, retailerItems, stores, chains, searchIndex } from "@/db/schema";
import { generatePrefixedId } from "@/utils/id";

const BATCH_SIZE = 1000;

async function backfillProducts(): Promise<number> {
  const db = getDatabase();
  let total = 0;
  let offset = 0;

  console.log("Backfilling products...");

  while (true) {
    const batch = await db
      .select()
      .from(products)
      .limit(BATCH_SIZE)
      .offset(offset);

    if (batch.length === 0) break;

    const values = batch.map((p) => ({
      id: generatePrefixedId("six"),
      entityType: "product" as const,
      entityId: p.id,
      chainSlug: null,
      category: p.category ?? null,
      subcategory: p.subcategory ?? null,
      title: p.name,
      subtitle: p.brand ?? null,
      body: [p.description, p.category, p.subcategory].filter(Boolean).join(" ") || null,
      imageUrl: p.imageUrl ?? null,
    }));

    await db.insert(searchIndex).values(values).onConflictDoNothing();

    total += batch.length;
    offset += BATCH_SIZE;
    console.log(`  Products: ${total} indexed`);
  }

  return total;
}

async function backfillItems(): Promise<number> {
  const db = getDatabase();
  let total = 0;
  let offset = 0;

  console.log("Backfilling retailer items...");

  while (true) {
    const batch = await db
      .select()
      .from(retailerItems)
      .limit(BATCH_SIZE)
      .offset(offset);

    if (batch.length === 0) break;

    const values = batch.map((item) => ({
      id: generatePrefixedId("six"),
      entityType: "item" as const,
      entityId: item.id,
      chainSlug: item.chainSlug ?? null,
      category: item.category ?? null,
      subcategory: item.subcategory ?? null,
      title: item.name,
      subtitle: item.brand ?? null,
      body: [item.description, item.category, item.subcategory, item.brand]
        .filter(Boolean)
        .join(" ") || null,
      imageUrl: item.imageUrl ?? null,
    }));

    await db.insert(searchIndex).values(values).onConflictDoNothing();

    total += batch.length;
    offset += BATCH_SIZE;

    if (total % 10000 === 0) {
      console.log(`  Items: ${total} indexed`);
    }
  }

  console.log(`  Items: ${total} indexed (complete)`);
  return total;
}

async function backfillStores(): Promise<number> {
  const db = getDatabase();

  console.log("Backfilling stores...");

  const storeRows = await db
    .select({
      store: stores,
      chainName: chains.name,
    })
    .from(stores)
    .innerJoin(chains, eq(chains.slug, stores.chainSlug));

  if (storeRows.length === 0) {
    console.log("  Stores: 0 indexed");
    return 0;
  }

  const values = storeRows.map((row) => ({
    id: generatePrefixedId("six"),
    entityType: "store" as const,
    entityId: row.store.id,
    chainSlug: row.store.chainSlug ?? null,
    category: null,
    subcategory: null,
    title: row.store.name,
    subtitle: row.chainName,
    body: [row.store.address, row.store.city, row.store.postalCode, row.chainName]
      .filter(Boolean)
      .join(" ") || null,
    imageUrl: null,
  }));

  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE);
    await db.insert(searchIndex).values(batch).onConflictDoNothing();
  }

  console.log(`  Stores: ${values.length} indexed`);
  return values.length;
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.length === 0;
  const doProducts = all || args.includes("--products");
  const doItems = all || args.includes("--items");
  const doStores = all || args.includes("--stores");

  console.log("Search Index Backfill");
  console.log("=====================");

  const start = Date.now();
  let totalIndexed = 0;

  if (doProducts) {
    totalIndexed += await backfillProducts();
  }
  if (doItems) {
    totalIndexed += await backfillItems();
  }
  if (doStores) {
    totalIndexed += await backfillStores();
  }

  const durationSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nComplete: ${totalIndexed} entities indexed in ${durationSec}s`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
```

---

## 5. VERIFICATION

### Post-Implementation Checklist

1. **Run migration:**
   ```bash
   pnpm db:migrate
   ```

2. **Verify extensions and functions:**
   ```sql
   SELECT hr_normalize('Čokolada');  -- Should return 'cokolada'
   ```

3. **Run backfill:**
   ```bash
   pnpm tsx scripts/backfill-search-index.ts
   ```

4. **Test autocomplete API:**
   ```bash
   curl -X POST http://localhost:3000/api/rpc \
     -H "Content-Type: application/json" \
     -d '{"method":"search.autocomplete","params":{"query":"mli","limit":5}}'
   ```

5. **Test full search API:**
   ```bash
   curl -X POST http://localhost:3000/api/rpc \
     -H "Content-Type: application/json" \
     -d '{"method":"search.search","params":{"query":"cokolada","limit":10}}'
   ```

6. **Test Croatian normalization:**
   - Search "cokolada" should match "Čokolada"
   - Search "mlijeko" should match items with "MLIJEKO"

7. **Run ingestion and verify search index updates:**
   ```bash
   # Trigger a chain ingestion
   # Verify search_index table has new entries
   ```

### Expected Performance

- Autocomplete: <25ms for typical queries
- Full search: <100ms for typical queries
- Backfill: ~5-10 minutes for 100k items

---

## 6. CRITICAL FILES SUMMARY

| File | Action | Purpose |
|------|--------|---------|
| `drizzle/XXXX_add_search_fts.sql` | CREATE | Migration with extension, functions, table |
| `/src/db/schema.ts` | MODIFY | Add searchIndex table definition |
| `/src/lib/search/types.ts` | CREATE | Type definitions |
| `/src/lib/search/index.ts` | CREATE | Indexing service |
| `/src/lib/search/queries.ts` | CREATE | Search query functions |
| `/src/orpc/router/search.ts` | CREATE | API endpoints |
| `/src/orpc/router/index.ts` | MODIFY | Register search router |
| `/src/ingestion/pipeline.ts` | MODIFY | Add search indexing step (~line 1851) |
| `/scripts/backfill-search-index.ts` | CREATE | Backfill script |

---

**Total Implementation Steps: 9**

**Hand this to your coding agent with: "Follow MASTER_BLUEPRINT.md exactly. Do not deviate."**

---

## APPENDIX A: Croatian Hunspell Upgrade Path (Future Enhancement)

> **When to consider:** If multi-word inflected queries (`bijelog kruha`, `svježeg mlijeka`, `pilećih prsa`) are common and trigram matching produces too much noise or misses.

### A.1 Hunspell Installation (PostgreSQL 16 Alpine Docker)

1. **Get dictionary files** from LibreOffice/OpenOffice:
   - `hr_HR.dic` and `hr_HR.aff`

2. **Convert for Postgres ispell:**
   ```bash
   # Remove entry count from first line of .dic
   tail -n +2 hr_HR.dic > hr_HR.dict
   # Rename .aff to .affix (often works as-is, may need tweaks)
   cp hr_HR.aff hr_HR.affix
   ```

3. **Install in Docker image:**
   ```dockerfile
   # In Dockerfile or volume mount
   COPY hr_HR.dict hr_HR.affix /usr/local/share/postgresql/tsearch_data/
   ```

4. **Create text search configuration:**
   ```sql
   CREATE TEXT SEARCH DICTIONARY hr_ispell (
     TEMPLATE = ispell,
     DictFile = hr_HR,
     AffFile = hr_HR
   );

   CREATE TEXT SEARCH CONFIGURATION hr_ft (COPY = simple);

   ALTER TEXT SEARCH CONFIGURATION hr_ft
     ALTER MAPPING FOR word, hword, hword_part, asciiword, asciihword, hword_asciipart
     WITH hr_ispell, simple; -- fallback to simple when unknown
   ```

### A.2 Dual-Channel Schema Addition

Add a second tsvector column for morphology (with original diacritics):

```sql
ALTER TABLE search_index
ADD COLUMN search_vector_hr TSVECTOR GENERATED ALWAYS AS (
  setweight(to_tsvector('hr_ft', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('hr_ft', COALESCE(subtitle, '')), 'B') ||
  setweight(to_tsvector('hr_ft', COALESCE(body, '')), 'C')
) STORED;

CREATE INDEX search_index_fts_hr_idx ON search_index USING GIN (search_vector_hr);
```

### A.3 Query Update for Dual-Channel

```sql
WITH q AS (
  SELECT
    websearch_to_tsquery('hr_ft', $1) AS tsq_hr,
    websearch_to_tsquery('simple', hr_normalize($1)) AS tsq_ascii,
    hr_normalize($1) AS nq
)
SELECT
  s.*,
  (
    GREATEST(
      ts_rank_cd(s.search_vector_hr, q.tsq_hr, 32),
      ts_rank_cd(s.search_vector, q.tsq_ascii, 32) * 0.9
    ) * 0.75
    + GREATEST(
        similarity(s.title_normalized, q.nq),
        similarity(s.body_normalized, q.nq) * 0.5
      ) * 0.25
  ) AS score
FROM search_index s
CROSS JOIN q
WHERE
  s.search_vector_hr @@ q.tsq_hr
  OR s.search_vector @@ q.tsq_ascii
  OR s.title_normalized % q.nq
  OR s.body_normalized % q.nq
ORDER BY score DESC
LIMIT $2;
```

### A.4 Evaluation Checklist

Before adding Hunspell, run this eval:
1. Sample 50-100 real/synthetic queries with Croatian inflections
2. Compare: (A) current simple+trigram vs (B) hunspell+ascii+trigram
3. Measure: "correct SKU in top 10?" for each query
4. If (B) wins by >10% on recall, proceed with Hunspell

---

## APPENDIX B: Codex Review Summary

This blueprint was reviewed with OpenAI Codex (gpt-5.2). Key findings:

| Issue | Resolution |
|-------|------------|
| SQL Injection in `sql.raw()` | Fixed: Use `sql` template literals with parameterization |
| `to_tsquery` fragile for user input | Fixed: Use `websearch_to_tsquery` |
| `ts_rank` vs `ts_rank_cd` | Fixed: Use `ts_rank_cd` (cover density) for product titles |
| Hunspell value for grocery search | Deferred: Start simple, add if eval shows need |
| Diacritic normalization conflicts with Hunspell | Noted: Dual-channel approach documented in Appendix A |
| Trigram `%` operator vs `similarity()` threshold | Fixed: Use `%` operator for better index usage |
