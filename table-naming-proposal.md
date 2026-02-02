# Price Table Naming - Current vs Proposed

## Problem with Current Names

The current names (`price_tiers`, `price_groups`, `store_price_refs`, `group_prices`) are confusing because:

1. **"Tiers" vs "Groups"** - Sound similar, unclear what's different
2. **"Refs"** - Technical term, doesn't describe business meaning
3. **No hint of purpose** - Can you tell what each table enables?
4. **Relationship unclear** - How do they connect?

---

## Proposed Naming Scheme

### Focus: What Each Table Enables

| Current Name | Proposed Name | Purpose (Question It Answers) |
|-------------|--------------|-------------------------------|
| `price_tiers` | `item_price_variants` | "What stores have milk at 94 HRK?" |
| `price_groups` | `store_price_catalogs` | "What does Store #5 sell, and at what prices?" |
| `store_price_refs` | `store_variant_assignments` | Which variant each store uses |
| `group_prices` | `catalog_items` | Items within each catalog |
| `store_group_history` | `store_catalog_history` | Catalog changes over time |

---

## Detailed Comparison

### 1. `price_tiers` → `item_price_variants`

**What it is:** Different prices for the SAME item across multiple stores

**Why "variants" is better:**
- Clearly represents "variations" in price
- Focuses on the item (primary entity)
- Natural language: "This item has 4 price variants"

**Examples:**
```
Milk (itm_1):
├── Variant 1: 94 HRK @ 188 stores
Wine (itm_2):
├── Variant 1: 528 HRK @ 10 stores
├── Variant 2: 689 HRK @ 45 stores
├── Variant 3: 899 HRK @ 78 stores
└── Variant 4: 1019 HRK @ 55 stores
```

**Query it enables:**
```sql
-- Find stores with milk at 94 HRK
SELECT s.* FROM stores s
JOIN store_variant_assignments sva ON sva.store_id = s.id
JOIN item_price_variants ipv ON sva.variant_id = ipv.id
WHERE ipv.item_id = 'itm_milk' AND ipv.price = 94;
```

---

### 2. `price_groups` → `store_price_catalogs`

**What it is:** Complete price list for a single store (or stores with identical pricing)

**Why "catalogs" is better:**
- "Catalog" = complete list of products/prices
- Familiar e-commerce term (product catalog)
- Focuses on the store (primary entity)
- Natural language: "This store has a unique catalog"

**Examples:**
```
Store #1:
└── Catalog A (catalog_id_1):
    ├── Milk: 94 HRK
    ├── Bread: 79 HRK
    ├── Wine: 528 HRK
    └── ... (9,129 items)

Store #2:
└── Catalog A (same catalog_id_1):
    ├── Milk: 94 HRK
    ├── Bread: 79 HRK
    ├── Wine: 528 HRK
    └── ... (identical to Store #1)

Store #3:
└── Catalog B (catalog_id_2):
    ├── Milk: 94 HRK
    ├── Bread: 82 HRK
    ├── Wine: 689 HRK
    └── ... (different pricing structure)
```

**Query it enables:**
```sql
-- Get Store #5's complete catalog
SELECT ri.name, ci.price
FROM store_price_catalogs spc
JOIN catalog_items ci ON spc.id = ci.catalog_id
JOIN retailer_items ri ON ci.item_id = ri.id
JOIN stores s ON s.current_catalog_id = spc.id
WHERE s.id = 'sid_store5';
```

---

### 3. `store_price_refs` → `store_variant_assignments`

**What it is:** Links each store to which price variant it uses for each item

**Why "assignments" is better:**
- Describes the relationship: "Store X is assigned variant Y"
- Clearer than "ref" (technical database term)
- Natural language: "Store assignment"

**Examples:**
```
Milk (itm_1), Variant 1 (94 HRK):
├── Store #1: Assigned variant 1
├── Store #2: Assigned variant 1
├── Store #3: Assigned variant 1
└── ... (188 stores all assigned)

Wine (itm_2), Variant 1 (528 HRK):
├── Store #1: Assigned variant 1
├── Store #2: Assigned variant 1
└── ... (10 stores)

Wine (itm_2), Variant 2 (689 HRK):
├── Store #11: Assigned variant 2
├── Store #12: Assigned variant 2
└── ... (45 stores)
```

**Schema would be:**
```sql
CREATE TABLE store_variant_assignments (
    store_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    in_stock BOOLEAN DEFAULT true,
    last_seen_at TIMESTAMP NOT NULL,
    PRIMARY KEY(store_id, variant_id)
);
```

---

### 4. `group_prices` → `catalog_items`

**What it is:** Items and their prices within each store catalog

**Why "items" is better:**
- Simple and direct
- "Items in catalog" is natural language
- Removes ambiguity of "group_prices" (prices of what group?)

**Examples:**
```
Catalog A (for Stores #1 and #2):
├── Milk: 94 HRK
├── Bread: 79 HRK
├── Wine: 528 HRK
└── ... (9,129 items)

Catalog B (for Store #3):
├── Milk: 94 HRK
├── Bread: 82 HRK
├── Wine: 689 HRK
└── ... (9,115 items)
```

**Schema would be:**
```sql
CREATE TABLE catalog_items (
    catalog_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    price INTEGER NOT NULL,
    discount_price INTEGER,
    unit_price INTEGER,
    anchor_price INTEGER,
    PRIMARY KEY(catalog_id, item_id)
);
```

---

### 5. `store_group_history` → `store_catalog_history`

**What it is:** Tracks which catalog a store has had, and when it changed

**Why "catalog_history" is better:**
- Clear it's about catalog changes over time
- "Group" in current name is confusing (what group?)
- Natural language: "Store catalog history"

**Examples:**
```
Store #5 catalog transitions:
├── 2026-01-15: Catalog A → Catalog B (prices increased)
├── 2026-01-20: Catalog B → Catalog C (new items added)
└── 2026-02-01: Catalog C → Catalog D (weekly update)

Store #10 catalog transitions:
├── 2026-01-15: Catalog A → Catalog B
├── 2026-01-20: Catalog B → Catalog B (no change)
└── 2026-02-01: Catalog B → Catalog D
```

**Schema would be:**
```sql
CREATE TABLE store_catalog_history (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    catalog_id TEXT NOT NULL,
    valid_from TIMESTAMP NOT NULL,
    valid_to TIMESTAMP,  -- NULL = current catalog
    created_at TIMESTAMP NOT NULL
);
```

---

## Relationship Diagram (Proposed Names)

```
retailer_items (20,788 products)
    │
    ├── 1:N ── item_price_variants (45,630 variants)
    │              │
    │              └── 1:N ── store_variant_assignments (1,716,469 links)
    │                              │
    │                              └── N:1 ── stores (188 stores)
    │                                          │
    │                                          ├── 1:N ── store_price_catalogs (188 catalogs)
    │                                          │         │
    │                                          │         ├── 1:N ── catalog_items (1,716,469 entries)
    │                                          │         │              └── N:1 ── retailer_items
    │                                          │
    │                                          └── 1:N ── store_catalog_history (transitions over time)
    │                                                     │
    │                                                     └── N:1 ── store_price_catalogs
```

---

## Mental Model Comparison

### Current Names (Confusing)

"I have price_tiers and price_groups... what's the difference?"
→ "Tiers are for items, groups are for stores" (unintuitive)
→ "store_price_refs link them" (technical, no context)
→ "group_prices are in price_groups" (prices of what group?)

### Proposed Names (Clear)

"I have item_price_variants and store_price_catalogs... what's the difference?"

→ **Item-level:** `item_price_variants` = different price options for each product
   - "Milk has 1 variant (94 HRK)"
   - "Wine has 4 variants (528-1019 HRK)"

→ **Store-level:** `store_price_catalogs` = complete product list for each store
   - "Store #1 has catalog A with 9,129 items"
   - "Store #2 also has catalog A (same prices)"
   - "Store #3 has catalog B (different prices)"

→ **Link:** `store_variant_assignments` = which variant each store uses
   - "Store #1 uses milk variant 1 (94 HRK)"
   - "Store #11 uses wine variant 2 (689 HRK)"

→ **Catalog contents:** `catalog_items` = items within each catalog
   - "Catalog A contains milk @ 94, wine @ 528"
   - "Catalog B contains milk @ 94, wine @ 689"

---

## Query Comparison

### Same Query, Current vs Proposed Names

#### Query: "Find stores with milk at 94 HRK"

**Current names:**
```sql
SELECT s.id, s.name
FROM stores s
JOIN store_price_refs spr ON spr.store_id = s.id
JOIN price_tiers pt ON spr.price_tier_id = pt.id
WHERE pt.retailer_item_id = 'itm_milk'
  AND pt.price = 94;
```

**Proposed names:**
```sql
SELECT s.id, s.name
FROM stores s
JOIN store_variant_assignments sva ON sva.store_id = s.id
JOIN item_price_variants ipv ON sva.variant_id = ipv.id
WHERE ipv.item_id = 'itm_milk'
  AND ipv.price = 94;
```

**Which is clearer?** Proposed - you're finding assignments to a specific variant.

---

#### Query: "Get Store #5's complete price list"

**Current names:**
```sql
SELECT ri.name, gp.price
FROM stores s
JOIN store_group_history sgh ON sgh.store_id = s.id AND sgh.valid_to IS NULL
JOIN price_groups pg ON sgh.price_group_id = pg.id
JOIN group_prices gp ON gp.price_group_id = pg.id
JOIN retailer_items ri ON gp.retailer_item_id = ri.id
WHERE s.id = 'sid_store5';
```

**Proposed names:**
```sql
SELECT ri.name, ci.price
FROM stores s
JOIN store_catalog_history sch ON sch.store_id = s.id AND sch.valid_to IS NULL
JOIN store_price_catalogs spc ON sch.catalog_id = spc.id
JOIN catalog_items ci ON ci.catalog_id = spc.id
JOIN retailer_items ri ON ci.item_id = ri.id
WHERE s.id = 'sid_store5';
```

**Which is clearer?** Proposed - "get catalog items for this store's current catalog"

---

#### Query: "Find stores with identical pricing"

**Current names:**
```sql
SELECT 
    pg.id,
    COUNT(DISTINCT s.id) AS store_count,
    STRING_AGG(s.name, ', ') AS stores
FROM price_groups pg
JOIN store_group_history sgh ON sgh.price_group_id = pg.id AND sgh.valid_to IS NULL
JOIN stores s ON sgh.store_id = s.id
GROUP BY pg.id
HAVING COUNT(DISTINCT s.id) > 1;
```

**Proposed names:**
```sql
SELECT 
    spc.id,
    COUNT(DISTINCT s.id) AS store_count,
    STRING_AGG(s.name, ', ') AS stores
FROM store_price_catalogs spc
JOIN store_catalog_history sch ON sch.catalog_id = spc.id AND sch.valid_to IS NULL
JOIN stores s ON sch.store_id = s.id
GROUP BY spc.id
HAVING COUNT(DISTINCT s.id) > 1;
```

**Which is clearer?** Proposed - "find catalogs shared by multiple stores"

---

## Migration Path

### Step 1: Create new tables
```sql
CREATE TABLE item_price_variants (...);
CREATE TABLE store_price_catalogs (...);
CREATE TABLE store_variant_assignments (...);
CREATE TABLE catalog_items (...);
CREATE TABLE store_catalog_history (...);
```

### Step 2: Migrate data
```sql
-- Migrate price_tiers
INSERT INTO item_price_variants (id, item_id, price, discount_price, store_count)
SELECT id, retailer_item_id, price, discount_price, store_count
FROM price_tiers;

-- Migrate price_groups
INSERT INTO store_price_catalogs (id, chain_slug, catalog_hash, store_count, item_count)
SELECT id, chain_slug, price_hash, store_count, item_count
FROM price_groups;

-- Migrate store_price_refs
INSERT INTO store_variant_assignments (store_id, variant_id, in_stock, last_seen_at)
SELECT store_id, price_tier_id, in_stock, last_seen_at
FROM store_price_refs;

-- Migrate group_prices
INSERT INTO catalog_items (catalog_id, item_id, price, discount_price, unit_price, anchor_price)
SELECT price_group_id, retailer_item_id, price, discount_price, unit_price, anchor_price
FROM group_prices;

-- Migrate store_group_history
INSERT INTO store_catalog_history (id, store_id, catalog_id, valid_from, valid_to, created_at)
SELECT id, store_id, price_group_id, valid_from, valid_to, created_at
FROM store_group_history;
```

### Step 3: Update foreign keys
```sql
ALTER TABLE stores
    ADD CONSTRAINT fk_current_catalog
    FOREIGN KEY (current_catalog_id) REFERENCES store_price_catalogs(id);

ALTER TABLE store_variant_assignments
    ADD CONSTRAINT fk_variant
    FOREIGN KEY (variant_id) REFERENCES item_price_variants(id);
```

### Step 4: Deprecate old tables
```sql
-- Comment out old tables
COMMENT ON TABLE price_tiers IS 'DEPRECATED: Use item_price_variants';
COMMENT ON TABLE price_groups IS 'DEPRECATED: Use store_price_catalogs';
COMMENT ON TABLE store_price_refs IS 'DEPRECATED: Use store_variant_assignments';
COMMENT ON TABLE group_prices IS 'DEPRECATED: Use catalog_items';
COMMENT ON TABLE store_group_history IS 'DEPRECATED: Use store_catalog_history';
```

---

## Summary

| Aspect | Current | Proposed | Improvement |
|---------|----------|-----------|------------|
| **Item prices** | `price_tiers` | `item_price_variants` | "Variants" clearer than "tiers" |
| **Store prices** | `price_groups` | `store_price_catalogs` | "Catalog" = complete list, familiar term |
| **Store-item link** | `store_price_refs` | `store_variant_assignments` | "Assignments" describes relationship |
| **Group contents** | `group_prices` | `catalog_items` | "Items in catalog" is intuitive |
| **History** | `store_group_history` | `store_catalog_history` | "Catalog history" vs "group history" |
| **Self-documenting** | ❌ No | ✅ Yes | Names explain purpose |
| **Mental model** | Confusing | Clear | Item variants vs store catalogs |
| **Query readability** | Technical | Business-focused | Easier to understand intent |

**Recommendation:** Adopt proposed names for clearer database schema and more maintainable code.
