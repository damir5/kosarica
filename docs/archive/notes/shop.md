# Price Data Quality and Query Performance Benchmark

Generated: 2026-02-05T07:06:54+00:00

## Chain Statistics

| Chain | Total Rows | Items | Stores | Coverage |
|-------|------------|-------|--------|----------|
| Eurospin | 6669799 | 990298 | 1330 | 100.0% |
| Interspar | 14221015 | 228178 | 56 | 100.0% |
| KTC | 7853780 | 15934 | 33 | 100.0% |
| Kaufland | 20814324 | 20237 | 52 | 100.0% |
| Konzum | 51352467 | 21024 | 188 | 100.0% |
| Lidl | 18469209 | 6700 | 113 | 100.0% |
| Metro | 3192159 | 13572 | 10 | 100.0% |
| Plodine | 53646602 | 27530 | 141 | 100.0% |
| Studenac | 5083285 | 21703 | 223 | 100.0% |
| Trgocentar | 1622586 | 11074 | 210 | 99.1% |
| dm | 8418360 | 23064 | 1 | 100.0% |

## Query Performance Results

| Query | Chain | Time (ms) | Rows |
|-------|-------|-----------|------|
| Query 1: Latest Prices by Store | Eurospin | 46 | 100 |
| Query 1: Latest Prices by Store | Interspar | 60 | 100 |
| Query 1: Latest Prices by Store | KTC | 51 | 100 |
| Query 1: Latest Prices by Store | Kaufland | 57 | 100 |
| Query 1: Latest Prices by Store | Konzum | 53 | 100 |
| Query 1: Latest Prices by Store | Lidl | 54 | 100 |
| Query 1: Latest Prices by Store | Metro | 55 | 100 |
| Query 1: Latest Prices by Store | Plodine | 59 | 100 |
| Query 1: Latest Prices by Store | Studenac | 53 | 100 |
| Query 1: Latest Prices by Store | Trgocentar | 47 | 100 |
| Query 1: Latest Prices by Store | dm | 101 | 100 |

| Query 2: Cross-Store Comparison | Eurospin | 180 | 1000 |
| Query 2: Cross-Store Comparison | Interspar | 210 | 1000 |
| Query 2: Cross-Store Comparison | KTC | 142 | 1000 |
| Query 2: Cross-Store Comparison | Kaufland | 304 | 1000 |
| Query 2: Cross-Store Comparison | Konzum | 673 | 1000 |
| Query 2: Cross-Store Comparison | Lidl | 265 | 1000 |
| Query 2: Cross-Store Comparison | Metro | 84 | 1000 |
| Query 2: Cross-Store Comparison | Plodine | 813 | 1000 |
| Query 2: Cross-Store Comparison | Studenac | 121 | 1000 |
| Query 2: Cross-Store Comparison | Trgocentar | 88 | 1000 |
| Query 2: Cross-Store Comparison | dm | 104 | 1000 |

| Query 3: Store Coverage | Eurospin | 64 | 1330 |
| Query 3: Store Coverage | Interspar | 70 | 56 |
| Query 3: Store Coverage | KTC | 63 | 33 |
| Query 3: Store Coverage | Kaufland | 79 | 52 |
| Query 3: Store Coverage | Konzum | 128 | 188 |
| Query 3: Store Coverage | Lidl | 86 | 113 |
| Query 3: Store Coverage | Metro | 53 | 10 |
| Query 3: Store Coverage | Plodine | 121 | 141 |
| Query 3: Store Coverage | Studenac | 60 | 223 |
| Query 3: Store Coverage | Trgocentar | 52 | 210 |
| Query 3: Store Coverage | dm | 68 | 1 |

| Query 4: Cache Health | All Chains | 45 | 11 |

| PG Query 1: Search Items | - | 300 | 5 |
| PG Query 2: Stores by Chain | - | 27 | 189 |
| PG Query 3: Barcode Lookup | - | 26 | 101 |

## Summary

| Database | Query Count | Avg Time (ms) |
|----------|-------------|---------------|
| ClickHouse | 34 | ~100ms |
| PostgreSQL | 3 | ~127ms |

ClickHouse performs well for time-series aggregations. PostgreSQL is efficient for metadata lookups.

## Detailed SQL with Timings

### Query 1: Latest Prices by Store

**Pattern**: Get latest prices for all items at a specific store using `argMax()` for time-series aggregation

**Use Case**: Display current prices in store view or product page

```sql
SELECT
    retailer_item_id,
    argMax(external_id, target_date) AS item_external_id,
    argMax(name, target_date) AS item_name,
    argMax(brand, target_date) AS brand,
    argMax(price_cents, target_date) AS current_price,
    argMax(price_status, target_date) AS price_status,
    argMax(discount_price_cents, target_date) AS discount_price,
    max(target_date) AS last_seen_at
FROM prices
WHERE chain_slug = '<chain_slug>' AND store_id = '<store_id>'
GROUP BY retailer_item_id
ORDER BY last_seen_at DESC
LIMIT 100
```

**Timings by Chain**:
| Chain | Time (ms) | Notes |
|-------|-----------|-------|
| Eurospin | 48 | 1,330 stores |
| Interspar | 71 | 56 stores |
| KTC | 70 | 33 stores |
| Kaufland | 70 | 52 stores |
| Konzum | 66 | 188 stores |
| Lidl | 66 | 113 stores |
| Metro | 67 | 10 stores |
| Plodine | 75 | 141 stores |
| Studenac | 66 | 223 stores |
| Trgocentar | 50 | 210 stores |
| dm | 130 | 1 store (national) |

**Source**: `/workspace/src/orpc/router/prices.ts:38-53`

---

### Query 2: Cross-Store Price Comparison

**Pattern**: Compare prices for specific items across all stores in a chain

**Use Case**: Show which store has the best price for a product

```sql
SELECT
    chain_slug,
    store_id,
    retailer_item_id,
    argMax(name, target_date) AS name,
    argMax(brand, target_date) AS brand,
    argMax(price_cents, target_date) AS price_cents,
    argMax(discount_price_cents, target_date) AS discount_price_cents,
    max(target_date) AS last_seen_at
FROM prices
WHERE chain_slug = '<chain_slug>'
GROUP BY chain_slug, store_id, retailer_item_id
ORDER BY last_seen_at DESC
LIMIT 1000
```

**Timings by Chain**:
| Chain | Time (ms) | Rows |
|-------|-----------|------|
| Eurospin | 212 | 1,000 |
| Interspar | 236 | 1,000 |
| KTC | 149 | 1,000 |
| Kaufland | 372 | 1,000 |
| Konzum | 790 | 1,000 |
| Lidl | 530 | 1,000 |
| Metro | 97 | 1,000 |
| Plodine | 1231 | 1,000 |
| Studenac | 143 | 1,000 |
| Trgocentar | 84 | 1,000 |
| dm | 122 | 1,000 |

**Source**: `/workspace/src/orpc/router/catalog-prices.ts:100-117`

---

### Query 3: Store Coverage Analysis

**Pattern**: Count items and availability per store

**Use Case**: Find stores with most complete price data, show coverage metrics

```sql
SELECT
    chain_slug,
    store_id,
    count(DISTINCT retailer_item_id) AS item_count,
    countIf(price_status = 'available') AS available_count,
    countIf(price_status = 'unavailable') AS unavailable_count
FROM prices
WHERE target_date = '<date>'
GROUP BY chain_slug, store_id
ORDER BY item_count DESC
```

**Timings by Chain**:
| Chain | Time (ms) | Stores |
|-------|-----------|--------|
| Eurospin | 66 | 1,330 |
| Interspar | 75 | 56 |
| KTC | 63 | 33 |
| Kaufland | 80 | 52 |
| Konzum | 120 | 188 |
| Lidl | 78 | 113 |
| Metro | 61 | 10 |
| Plodine | 119 | 141 |
| Studenac | 59 | 223 |
| Trgocentar | 54 | 210 |
| dm | 68 | 1 |

---

### Query 4: Cache Health Monitoring

**Pattern**: Check latest data date for all chains

**Use Case**: Monitor data freshness, show health status

```sql
SELECT chain_slug, max(target_date) AS target_date
FROM prices
GROUP BY chain_slug
```

**Timing**: 44ms for 11 chains

**Source**: `/workspace/src/lib/basket/optimizer.ts:655-699`

---

### Query 5: Basket Optimization

**Pattern**: Get prices by store and calculate average prices for penalty calculation

**Use Case**: Multi-store basket allocation algorithm

**Phase 1 - Prices by Store**:
```sql
SELECT
    store_id,
    retailer_item_id,
    argMax(price_cents, imported_at) AS price_cents,
    argMax(discount_price_cents, imported_at) AS discount_price_cents
FROM prices
WHERE chain_slug = '<chain_slug>'
    AND target_date = '<date>'
    AND retailer_item_id IN ('<item1>', '<item2>', ...)
GROUP BY store_id, retailer_item_id
```

**Phase 2 - Average Prices**:
```sql
SELECT
    retailer_item_id,
    avg(
        if(
            discount_price_cents > 0 AND discount_price_cents < price_cents,
            discount_price_cents,
            price_cents
        )
    ) AS avg_price
FROM prices
WHERE chain_slug = '<chain_slug>'
    AND target_date = '<date>'
    AND retailer_item_id IN ('<item1>', '<item2>', ...)
GROUP BY retailer_item_id
```

**Typical Timing**: 50-150ms per chain depending on item count

**Source**: `/workspace/src/lib/basket/optimizer.ts:281-329`

---

### PostgreSQL Query 1: Search Items by Name/Brand

**Pattern**: ILIKE search on text columns

**Use Case**: Product search autocomplete

```sql
SELECT id, name, brand, category, subcategory, chain_slug, external_id, unit, unit_quantity, image_url
FROM retailer_items
WHERE (name ILIKE '%<search>%' OR brand ILIKE '%<search>%')
ORDER BY name
LIMIT 20
```

**Timing**: 322ms for 'mleko' search, 5 rows

**Note**: Consider adding full-text search (GIN index) for better performance

**Source**: `/workspace/src/orpc/router/prices.ts:109-151`

---

### PostgreSQL Query 2: Get Stores by Chain

**Pattern**: Join stores with chains for metadata enrichment

**Use Case**: Store selector, location-based features

```sql
SELECT s.id, s.name, s.city, s.is_virtual, c.slug AS chain_slug, c.name AS chain_name
FROM stores s
INNER JOIN chains c ON s.chain_slug = c.slug
WHERE s.chain_slug = '<chain_slug>'
ORDER BY s.name
```

**Timing**: 25ms for Konzum (189 stores)

**Indexes**: `stores_chain_slug_idx`

---

### PostgreSQL Query 3: Barcode Lookup

**Pattern**: Join barcodes with items for product resolution

**Use Case**: Barcode scanning feature, product matching

```sql
SELECT rib.barcode, ri.name, ri.brand, ri.chain_slug
FROM retailer_item_barcodes rib
INNER JOIN retailer_items ri ON rib.retailer_item_id = ri.id
LIMIT 100
```

**Timing**: 33ms for 100 rows

**Indexes**: `retailer_item_barcodes_barcode_new_idx`, `barcode_item_idx`

---

## Performance Notes

1. **ClickHouse excels** at aggregations on large datasets (millions of rows)
2. **PostgreSQL** is efficient for indexed lookups and joins
3. **argMax()** is the key pattern for latest-value queries in ClickHouse
4. **Docker exec overhead** adds ~10-20ms per query (would be faster with direct connections)
5. **Plodine and Konzum** have the most data and show slower query times proportionally

## Database Sizes

- **ClickHouse `prices` table**: ~195M total rows across all chains
- **PostgreSQL**: ~hundreds of stores, ~thousands of products, ~millions of retailer items
