# Price Clustering & Price Groups - Deep Dive

## Overview

The system uses a **two-layer clustering approach**:

1. **Price Tiers** - First layer: Clusters prices **within a single item** across stores
2. **Price Groups** - Second layer: Clusters items **that share the same multi-store price distribution**

This enables efficient querying at both the item level (what does milk cost at Store X?) and the pattern level (what other items have the same pricing as milk?).

---

## Layer 1: Price Tiers

### What is a Price Tier?

A **price tier** represents a unique price for a single item across multiple stores.

```
Item: Milk UHT 1L
├── Tier 1: 94 HRK @ 188 stores  → Single national price
Item: Cabernet Sauvignon  
├── Tier 1: 528 HRK @ 10 stores  → Lower price tier
├── Tier 2: 689 HRK @ 45 stores  → Mid price tier
├── Tier 3: 899 HRK @ 78 stores  → Higher price tier
└── Tier 4: 1019 HRK @ 55 stores → Premium price tier
```

### Schema

```sql
CREATE TABLE price_tiers (
    id              TEXT PRIMARY KEY,
    chain_slug      TEXT NOT NULL,
    retailer_item_id TEXT NOT NULL,
    price           INTEGER NOT NULL,
    discount_price  INTEGER,
    store_count     INTEGER NOT NULL DEFAULT 0,
    -- ...
    UNIQUE(chain_slug, retailer_item_id, price, COALESCE(discount_price, '-1'))
);
```

**Key constraint:** Same item cannot have duplicate (price, discount) combinations.

### Database State (from ingestion)

| Metric | Value |
|--------|-------|
| Total price tiers | 45,630 |
| Unique items | 20,788 |
| Avg tiers per item | 2.2 |
| Max tiers per item | 6 |
| Total price refs | 1,716,469 |

### How Tiers Are Created

From the logs (`task_cluster.go:167`):

```go
priceTiers, storePriceRefs := groupByPriceTier(allStoreData)
```

For each store's parsed data:

1. **Extract all (item_id, price, discount) tuples**
2. **Group by item_id**
3. **Within each item, group by (price, discount)**
4. **Count stores per group**

Example:

```
Input data from 188 stores:
Milk (item_1): [94, 94, 94, 94, ...] × 188 stores
→ 1 tier: {item: item_1, price: 94, stores: 188}

Wine (item_2): [528×10, 689×45, 899×78, 1019×55]
→ 4 tiers: 
  - {item: item_2, price: 528, stores: 10}
  - {item: item_2, price: 689, stores: 45}
  - {item: item_2, price: 899, stores: 78}
  - {item: item_2, price: 1019, stores: 55}
```

**Result:** 45,630 price tiers created from 1,716,469 raw price entries.

---

## Layer 2: Price Groups

### What is a Price Group?

A **price group** represents a unique **multi-store price distribution pattern** across items.

Two items belong to the same price group if they have **identical prices at the same stores** (considering which stores have which price tiers).

```
Store Group Pattern Example:
Store 1-50:  44 HRK (Yogurt) AND 44 HRK (Sour Cream)
Store 51-100: 49 HRK (Yogurt) AND 49 HRK (Sour Cream)  
Store 101-188: 54 HRK (Yogurt) AND 54 HRK (Sour Cream)

→ Yogurt and Sour Cream belong to SAME PRICE GROUP
→ They have identical 3-tier distribution: [44×50, 49×50, 54×88]
```

### Schema

```sql
CREATE TABLE price_groups (
    id            TEXT PRIMARY KEY,
    chain_slug    TEXT NOT NULL,
    price_hash    TEXT NOT NULL,      -- SHA-256 hash of price distribution
    hash_version  INTEGER NOT NULL DEFAULT 1,
    store_count   INTEGER NOT NULL DEFAULT 0,
    item_count    INTEGER NOT NULL DEFAULT 0,
    first_seen_at TIMESTAMP NOT NULL,
    last_seen_at  TIMESTAMP NOT NULL,
    UNIQUE(chain_slug, price_hash, hash_version)
);

CREATE TABLE group_prices (
    price_group_id   TEXT NOT NULL,
    retailer_item_id TEXT NOT NULL,
    price            INTEGER NOT NULL,
    discount_price   INTEGER,
    unit_price       INTEGER,
    anchor_price     INTEGER,
    PRIMARY KEY(price_group_id, retailer_item_id)
);
```

**Relationship:**
- `price_groups`: The pattern (hash) of prices
- `group_prices`: Which items are in which group, at what price
- `store_group_history`: Which store had which group, and when

### How Price Hash Works

The price hash is computed in `internal/pricegroups/hash.go`:

```go
func ComputePriceHash(prices []ItemPrice) string {
    // Step 1: Sort by ItemID, Price, Discount (deterministic)
    sort.Slice(sortedPrices, func(i, j int) bool {
        idI := strings.ToLower(sortedPrices[i].ItemID)
        idJ := strings.ToLower(sortedPrices[j].ItemID)
        if idI != idJ { return idI < idJ }
        if sortedPrices[i].Price != sortedPrices[j].Price {
            return sortedPrices[i].Price < sortedPrices[j].Price
        }
        // Handle NULL vs 0 discount (critical!)
        if discI == nil && discJ == nil { return false }
        if discI == nil { return true }
        if discJ == nil { return false }
        return *discI < *discJ
    })

    // Step 2: Build canonical string
    // Format: "item_id:price:discount\n"
    // NULL discount = "N" sentinel (NOT "0"!)
    for _, p := range sortedPrices {
        var discountStr string
        if p.DiscountPrice == nil {
            discountStr = "N"  // NULL sentinel
        } else {
            discountStr = strconv.Itoa(*p.DiscountPrice)
        }
        fmt.Fprintf(&buf, "%s:%d:%s\n", 
            strings.ToLower(p.ItemID), p.Price, discountStr)
    }

    // Step 3: SHA256 hex
    hash := sha256.Sum256(buf.Bytes())
    return hex.EncodeToString(hash[:])
}
```

**Key Design Decisions:**

1. **Order-independent:** Sorting ensures `{A:100, B:200}` = `{B:200, A:100}`
2. **NULL ≠ 0:** Discount uses `"N"` sentinel for NULL, `"0"` for zero value
3. **Case-insensitive UUIDs:** Normalized to lowercase
4. **Deterministic:** Same input always produces same hash

**Why this matters:**

```go
// These two scenarios produce DIFFERENT hashes:

Scenario 1: NULL discount (no discount)
Item: Milk, Price: 100, Discount: NULL
→ Hash includes: "milk_id:100:N\n"

Scenario 2: 0 discount (free or 100% off)
Item: Milk, Price: 100, Discount: 0  
→ Hash includes: "milk_id:100:0\n"

// Different hashes → Different price groups!
```

### How Price Groups Are Created

From `internal/pipeline/persist.go:persistRowsForStore()`:

```go
// Step 1: Collect all items with prices for this store
itemPrices := make([]pricegroups.ItemPrice, 0, len(rows))
for _, row := range rows {
    retailerItemID, _ := findOrCreateRetailerItem(ctx, row)
    itemPrices = append(itemPrices, pricegroups.ItemPrice{
        ItemID:        retailerItemID,
        Price:         row.Price,
        DiscountPrice: row.DiscountPrice,
    })
}

// Step 2: Compute price hash for this store
priceHash := pricegroups.ComputePriceHash(itemPrices)

// Step 3: Find or create price group by hash
group, isNewGroup, err := database.FindOrCreatePriceGroup(ctx, chainID, priceHash)

// Step 4: If new group, insert all item prices
if isNewGroup {
    groupPrices := make([]database.GroupPrice, 0, len(itemPrices))
    for _, itemPrice := range itemPrices {
        groupPrices = append(groupPrices, database.GroupPrice{
            PriceGroupID:   group.ID,
            RetailerItemID: itemPrice.ItemID,
            Price:          itemPrice.Price,
            DiscountPrice:  itemPrice.DiscountPrice,
            // ...
        })
    }
    database.BulkInsertGroupPrices(ctx, group.ID, groupPrices)
}

// Step 5: Assign store to this group (closes previous membership)
database.AssignStoreToGroup(ctx, storeID, group.ID)
```

**Critical insight:** Each store gets **ONE price group** that contains **ALL items** for that store.

---

## Relationship: Tiers ↔ Groups

### Data Flow

```
Raw CSV Data (1,716,469 rows)
         ↓
    [Parse]
         ↓
[Store-specific Item Lists]
    Store 1: [Milk:94, Bread:79, Wine:528, ...]  ← 9,129 items
    Store 2: [Milk:94, Bread:79, Wine:528, ...]  ← 9,132 items
    Store 3: [Milk:94, Bread:82, Wine:689, ...]  ← 9,115 items
         ↓
[Create Price Tiers]  ← Phase 2, takes <1s
         ↓
    Tier 1: Milk@94 → 188 stores
    Tier 2: Bread@79 → 150 stores
    Tier 3: Bread@82 → 38 stores
    Tier 4: Wine@528 → 10 stores
    Tier 5: Wine@689 → 45 stores
         ↓
[Create Price Groups]  ← During persist, should create 188 groups (one per store)
         ↓
    Group A: Store 1's price pattern
        → Contains: Milk@94, Bread@79, Wine@528, ...
    Group B: Store 2's price pattern
        → Contains: Milk@94, Bread@79, Wine@528, ...
    Group C: Store 3's price pattern
        → Contains: Milk@94, Bread@82, Wine@689, ...
```

### Key Differences

| Aspect | Price Tiers | Price Groups |
|--------|-------------|--------------|
| **Scope** | Single item, multiple stores | All items, single store (or cluster of similar stores) |
| **Grouping key** | (item_id, price, discount) | SHA-256 hash of entire store price list |
| **Purpose** | Find stores with same price for item X | Find stores with same pricing structure across ALL items |
| **Cardinality** | 45,630 tiers (2.2 per item avg) | Should be ~188 groups (1 per store) |
| **Query use case** | "Where can I get milk for 94 HRK?" | "What stores have similar pricing to Store 5?" |
| **Tables** | `price_tiers`, `store_price_refs` | `price_groups`, `group_prices`, `store_group_history` |

### Example: Concrete Data

**Item: Milk UHT 1L (itm_1)**

```
price_tiers:
└── pt_abc: {retailer_item_id: itm_1, price: 94, discount: NULL, store_count: 188}

store_price_refs:
├── {store_id: sid_1, price_tier_id: pt_abc, in_stock: true}
├── {store_id: sid_2, price_tier_id: pt_abc, in_stock: true}
└── ... (188 entries)

group_prices:
├── {price_group_id: pg_store1, retailer_item_id: itm_1, price: 94, ...}
├── {price_group_id: pg_store2, retailer_item_id: itm_1, price: 94, ...}
└── ... (188 entries, one per price_group)
```

**Item: Cabernet Sauvignon (itm_2)**

```
price_tiers:
├── pt_xyz1: {retailer_item_id: itm_2, price: 528, store_count: 10}
├── pt_xyz2: {retailer_item_id: itm_2, price: 689, store_count: 45}
├── pt_xyz3: {retailer_item_id: itm_2, price: 899, store_count: 78}
└── pt_xyz4: {retailer_item_id: itm_2, price: 1019, store_count: 55}

store_price_refs:
├── {store_id: sid_1, price_tier_id: pt_xyz1, ...}  ← 528 HRK
├── {store_id: sid_2, price_tier_id: pt_xyz1, ...}  ← 528 HRK
├── {store_id: sid_11, price_tier_id: pt_xyz2, ...} ← 689 HRK
└── ... (188 entries across 4 tiers)

group_prices:
├── {price_group_id: pg_store1, retailer_item_id: itm_2, price: 528, ...}  ← Store 1
├── {price_group_id: pg_store2, retailer_item_id: itm_2, price: 528, ...}  ← Store 2
├── {price_group_id: pg_store11, retailer_item_id: itm_2, price: 689, ...} ← Store 11
└── ... (188 entries, each store's price for wine)
```

---

## Why Two Layers?

### Layer 1 (Price Tiers): Item-centric queries

**Question:** "What stores have milk at 94 HRK?"

```sql
SELECT spr.store_id, s.name
FROM store_price_refs spr
JOIN price_tiers pt ON spr.price_tier_id = pt.id
JOIN stores s ON spr.store_id = s.id
WHERE pt.retailer_item_id = 'itm_milk_id'
  AND pt.price = 94;
```

**Answer:** 188 stores (all Konzum stores)

### Layer 2 (Price Groups): Store-centric queries

**Question:** "What items are cheaper at Store 1 compared to Store 2?"

```sql
-- Get Store 1's price group
SELECT pg.id, gp.retailer_item_id, ri.name, gp.price
FROM store_group_history sgh
JOIN price_groups pg ON sgh.price_group_id = pg.id
JOIN group_prices gp ON pg.id = gp.price_group_id
JOIN retailer_items ri ON gp.retailer_item_id = ri.id
WHERE sgh.store_id = 'sid_1'
  AND sgh.valid_to IS NULL;

-- Compare with Store 2's price group
SELECT gp2.price - gp1.price AS price_diff, gp1.price, gp2.price
FROM group_prices gp1
JOIN group_prices gp2 ON gp1.retailer_item_id = gp2.retailer_item_id
WHERE gp1.price_group_id = 'pg_store1'
  AND gp2.price_group_id = 'pg_store2'
  AND gp1.price != gp2.price;
```

### Combined queries

**Question:** "Find items priced similarly across all stores"

```sql
-- Items with highest clustering (same price in >150 stores)
SELECT ri.name, pt.price, pt.store_count
FROM price_tiers pt
JOIN retailer_items ri ON pt.retailer_item_id = ri.id
WHERE pt.store_count >= 150
ORDER BY pt.store_count DESC, ri.name;
```

**Answer:** Yogurt, sour cream, flour, sugar, etc.

---

## Current State: Why No Price Groups?

### Expected vs Actual

**Expected:**
- 188 price groups (one per store)
- 1,716,469 group_prices entries
- Each group has ~9,129 items

**Actual:**
- 0 price groups
- 0 group_prices entries
- Cluster task stuck in infinite loop

### Root Cause

The clustering task completes Phase 2 (creates tiers successfully), but never reaches the price group creation step because:

1. **Task restarts after each completion**
2. **Persist phase times out or errors**
3. **Finalization schedules new run**

From logs, the task does:
```
Phase 1: Load archives (17-18s) ✓
Phase 2: Cluster into tiers (0.5-0.8s) ✓
Phase 3: Persist to DB (35s-20min) ← Variable, sometimes fails
Finalize: Mark run completed ✓
→ RESTART FROM PHASE 1 ← BUG
```

**Price group creation happens during:** `persistRowsForStore()` in `persist.go`
**But persist phase never completes fully** before task restarts.

---

## Performance Analysis

### Price Tier Clustering

**Operation:** Group 1,716,469 rows by (item, price, discount)

```
Time: <1 second consistently
Method: In-memory Go map
  tiers[item_id][price][discount] = {stores: []}
```

**Why so fast:**
- Pure in-memory operation
- Single pass through sorted data
- Map key lookups are O(1)

### Price Hash Computation

**Operation:** SHA-256 hash of ~9,000 item entries per store

```
Time: <100ms per store
Method: Sort + string building + SHA256
```

**Why so fast:**
- SHA-256 is hardware-accelerated
- Sorting 9,000 items is trivial for Go
- String formatting is efficient

### Price Group Creation

**Operation (per store):**
1. Find/create retailer items (~9k queries)
2. Compute price hash (1 hash)
3. Find/create price group (1 query)
4. Bulk insert group_prices (if new group)
5. Assign store to group (1 query)
6. Update store_item_state (batch)

```
Time: 35s-20min per store
Method: Database operations
```

**Why so slow:**
- 9,000 `findOrCreateRetailerItem` queries (each may query + insert)
- Batch size 9,000 for group_prices (large transaction)
- Index lookups and constraint checks
- Locking on price_groups table

---

## Practical Examples

### Use Case 1: Basket Optimization

**Goal:** Find cheapest basket across stores

**Using Price Tiers:**
```sql
-- Get item prices grouped by store
SELECT 
    s.id AS store_id,
    s.name AS store_name,
    JSON_AGG(
        JSON_BUILD_OBJECT(
            'item', ri.name,
            'price', pt.price
        )
    ) AS prices
FROM stores s
CROSS JOIN retailer_items ri ON ri.chain_slug = 'konzum'  -- Filter relevant items
LEFT JOIN store_price_refs spr ON spr.store_id = s.id
LEFT JOIN price_tiers pt ON spr.price_tier_id = pt.id
    AND pt.retailer_item_id = ri.id
WHERE spr.in_stock = true
GROUP BY s.id, s.name;
```

**Using Price Groups:**
```sql
-- Get entire store pricing in one query
SELECT 
    s.id AS store_id,
    s.name AS store_name,
    pg.id AS price_group_id,
    JSON_AGG(
        JSON_BUILD_OBJECT(
            'item', ri.name,
            'price', gp.price
        )
    ) AS prices
FROM stores s
JOIN store_group_history sgh ON sgh.store_id = s.id
    AND sgh.valid_to IS NULL
JOIN price_groups pg ON sgh.price_group_id = pg.id
JOIN group_prices gp ON gp.price_group_id = pg.id
JOIN retailer_items ri ON gp.retailer_item_id = ri.id
WHERE s.chain_slug = 'konzum'
GROUP BY s.id, s.name, pg.id;
```

**Price Groups advantage:** Single query per store vs N queries per store.

### Use Case 2: Price Pattern Analysis

**Question:** "Which stores have aggressive pricing?"

```sql
-- Find stores with many items in low-price tiers
SELECT 
    s.id AS store_id,
    s.name AS store_name,
    COUNT(*) AS low_price_items,
    AVG(pt.price) AS avg_price
FROM stores s
JOIN store_price_refs spr ON spr.store_id = s.id
JOIN price_tiers pt ON spr.price_tier_id = pt.id
WHERE pt.price < 100  -- Low price items
GROUP BY s.id, s.name
ORDER BY low_price_items DESC;
```

### Use Case 3: Similar Store Detection

**Question:** "Find stores with identical pricing"

```sql
-- Get stores sharing the same price group
SELECT 
    pg.id AS price_group_id,
    pg.item_count,
    pg.store_count,
    COUNT(DISTINCT s.id) AS actual_stores,
    STRING_AGG(s.name, ', ' ORDER BY s.name) AS stores
FROM price_groups pg
JOIN store_group_history sgh ON sgh.price_group_id = pg.id
    AND sgh.valid_to IS NULL
JOIN stores s ON sgh.store_id = s.id
GROUP BY pg.id, pg.item_count, pg.store_count
HAVING COUNT(DISTINCT s.id) > 1
ORDER BY pg.store_count DESC;
```

**Expected result:** None (each store should have unique price group, unless some stores truly have identical pricing).

---

## Summary

### Hierarchy

```
retailer_items (20,788 products)
    ↓ (1-N relationship)
price_tiers (45,630 unique prices)
    ↓ (aggregates stores per price)
store_price_refs (1,716,469 store-price links)

price_groups (188 store price patterns - expected)
    ↓ (1-N relationship)
group_prices (1,716,469 item-price-group links)
    ↓ (tracks store membership over time)
store_group_history (price group transitions)
```

### Key Insights

1. **Price Tiers = Item-Centric**
   - Answers: "Where is item X cheapest?"
   - Enables store comparison per item
   - Fast clustering: <1 second

2. **Price Groups = Store-Centric**  
   - Answers: "What does Store X sell, and at what prices?"
   - Enables basket optimization
   - Enables price pattern analysis
   - Fast hashing: <100ms per store

3. **Two layers work together**
   - Tiers enable per-item price queries
   - Groups enable per-store price queries
   - Both support aggregation and optimization

4. **Current blocker**
   - Price tiers created successfully ✓
   - Price groups not created due to infinite loop bug ✗
   - Both layers required for full functionality

### Next Steps

1. **Fix infinite loop** to allow price group creation
2. **Verify 188 price groups created** (one per store)
3. **Test combined queries** using both tiers and groups
4. **Optimize persist phase** (35s-20min is too variable)
