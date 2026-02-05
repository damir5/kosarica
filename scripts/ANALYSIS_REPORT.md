# Price Data Quality and Query Performance Analysis Report

## Executive Summary

This report analyzes the price data quality and query performance across chains in the Kosarica price comparison system. The system uses a **dual-database architecture**:
- **PostgreSQL** for metadata, reference data, and canonical catalogs
- **ClickHouse** for high-performance analytical queries on time-series price data

---

## 1. Database Architecture Overview

### 1.1 PostgreSQL - Metadata & Reference Data

**Purpose**: Master reference data, store information, canonical catalogs

| Table | Purpose | Est. Rows | Key Indexes |
|-------|---------|-----------|-------------|
| `chains` | Chain metadata (slug, name, website) | ~11 | PK: slug |
| `stores` | Store locations and approval workflow | ~hundreds | chain_slug, city, status |
| `store_identifiers` | Store identifiers (filename_code, portal_id) | ~thousands | (store_id, type, value) UNIQUE |
| `retailer_items` | Items per retailer (name, brand, category) | ~millions | (chain_slug, external_id) UNIQUE |
| `retailer_item_barcodes` | Item barcodes (EAN-13, EAN-8, GTIN) | ~millions | barcode, item_id |
| `products` | Canonical product catalog | ~thousands | PK: id |
| `product_links` | Retailer item to canonical product mapping | ~millions | product_id UNIQUE |
| `ingestion_runs` | Ingestion run tracking | ~thousands | (chain_slug, target_date) |
| `ingestion_store_stats` | Per-store ingestion statistics | ~thousands | run_id, store_id |
| `parquet_files` | Parquet file tracking for ClickHouse import | ~thousands | (chain_slug, target_date) UNIQUE |

### 1.2 ClickHouse - Price Time-Series Data

**Table**: `prices`

**Schema**:
```sql
CREATE TABLE prices (
    target_date Date,
    chain_slug LowCardinality(String),
    store_id String,
    retailer_item_id String,
    external_id Nullable(String),
    name String,
    barcode Nullable(String),
    price_cents Nullable(Int32),
    price_status Enum8('available' = 1, 'unavailable' = 2) DEFAULT 'available',
    price_unavailable_reason Nullable(Enum8('missing' = 1, 'invalid' = 2, 'non_positive' = 3)),
    discount_price_cents Nullable(Int32),
    unit_price_cents Nullable(Int32),
    category Nullable(String),
    brand Nullable(String),
    imported_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(imported_at)
PARTITION BY (toYYYYMM(target_date), chain_slug)
ORDER BY (target_date, chain_slug, store_id, retailer_item_id);
```

**Key Design Decisions**:
1. **ReplacingMergeTree** - Handles duplicate keys by keeping latest `imported_at`
2. **Partition by (month, chain)** - Efficient historical analysis and pruning
3. **LowCardinality(String)** - Optimizes storage for chain_slug
4. **Nullable price_cents** - Tracks unavailable prices with reasons

---

## 2. Supported Chains

| Chain ID | Name | Store Resolution | File Type | Encoding |
|----------|------|------------------|-----------|----------|
| konzum | Konzum | filename | CSV | UTF-8 |
| lidl | Lidl | filename | CSV/ZIP | Windows-1250 |
| plodine | Plodine | filename | CSV/ZIP | Windows-1250 |
| interspar | Interspar | filename | CSV | UTF-8 |
| studenac | Studenac | portal_id | XML/ZIP | UTF-8 |
| kaufland | Kaufland | filename | TSV | UTF-8 |
| eurospin | Eurospin | filename | CSV/ZIP | UTF-8 |
| dm | DM | national | XLSX | UTF-8 |
| ktc | KTC | filename | CSV | Windows-1250 |
| metro | Metro | portal_id | CSV | UTF-8 |
| trgocentar | Trgocentar | filename | XML | UTF-8 |

---

## 3. Typical Cross-Store Comparison Queries

### Query 1: Latest Prices by Store (Core Pattern)

**Use Case**: Display current prices for all items at a specific store

```sql
SELECT
    retailer_item_id,
    argMax(external_id, target_date) AS item_external_id,
    argMax(name, target_date) AS item_name,
    argMax(brand, target_date) AS brand,
    argMax(price_cents, target_date) AS current_price,
    argMax(price_status, target_date) AS price_status,
    argMax(discount_price_cents, target_date) AS discount_price,
    argMax(unit_price_cents, target_date) AS unit_price,
    max(target_date) AS last_seen_at
FROM prices
WHERE chain_slug = {chainSlug:String} AND store_id = {storeId:String}
GROUP BY retailer_item_id
ORDER BY last_seen_at DESC
LIMIT {limit:UInt32} OFFSET {offset:UInt32}
```

**Performance**: Excellent - Uses `argMax()` aggregate for time-series latest-value retrieval

**Source**: `/workspace/src/orpc/router/prices.ts:38-53`

---

### Query 2: Cross-Store Price Comparison

**Use Case**: Compare prices for specific items across all stores in a chain

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
WHERE chain_slug = {chainSlug:String}
    AND retailer_item_id IN ({itemIds:Array(String)})
GROUP BY chain_slug, store_id, retailer_item_id
```

**Then join with PostgreSQL**:
```sql
SELECT stores.*, chains.name as chainName
FROM stores
INNER JOIN chains ON stores.chainSlug = chains.slug
WHERE stores.id IN ({storeIds})
```

**Performance**: Two-phase query - ClickHouse for price data, PostgreSQL for store metadata

**Source**: `/workspace/src/orpc/router/catalog-prices.ts:100-117`

---

### Query 3: Basket Optimization - Store Selection

**Use Case**: Find optimal stores for a shopping basket

**Phase 1 - Get prices by store**:
```sql
SELECT
    store_id,
    retailer_item_id,
    argMax(price_cents, imported_at) AS price_cents,
    argMax(discount_price_cents, imported_at) AS discount_price_cents
FROM prices
WHERE chain_slug = {chainSlug:String}
    AND target_date = {targetDate:Date}
    AND retailer_item_id IN ({itemIds:Array(String)})
GROUP BY store_id, retailer_item_id
```

**Phase 2 - Calculate average prices for missing items**:
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
WHERE chain_slug = {chainSlug:String}
    AND target_date = {targetDate:Date}
    AND retailer_item_id IN ({itemIds:Array(String)})
GROUP BY retailer_item_id
```

**Performance**: Optimized with `IN` clause for targeted item lookup

**Source**: `/workspace/src/lib/basket/optimizer.ts:281-329`

---

### Query 4: Store Coverage Analysis

**Use Case**: Find which stores have the most complete price data

```sql
SELECT
    chain_slug,
    store_id,
    count(DISTINCT retailer_item_id) AS item_count,
    countIf(price_status = 'available') AS available_count,
    countIf(price_status = 'unavailable') AS unavailable_count
FROM prices
WHERE target_date = {date:Date}
GROUP BY chain_slug, store_id
ORDER BY item_count DESC
```

**Performance**: Fast aggregation with `countIf()` for availability breakdown

---

### Query 5: Cache Health Monitoring

**Use Case**: Check data freshness for all chains

```sql
SELECT chain_slug, max(target_date) AS target_date
FROM prices
GROUP BY chain_slug
```

**Source**: `/workspace/src/lib/basket/optimizer.ts:655-699`

---

## 4. PostgreSQL Query Patterns

### Search Items by Name/Brand

```sql
SELECT id, name, brand, category, subcategory, chainSlug, externalId, unit, unitQuantity, imageUrl
FROM retailer_items
WHERE (name ILIKE {search} OR brand ILIKE {search})
    AND chainSlug = {chainSlug}  -- optional
ORDER BY name
LIMIT {limit}
```

**Indexes**: Implicit B-tree on text columns via ILIKE

**Source**: `/workspace/src/orpc/router/prices.ts:109-151`

### Get Stores by Chain with Metadata

```sql
SELECT s.id, s.name, s.city, s.isVirtual, c.slug AS chainSlug, c.name AS chainName
FROM stores s
INNER JOIN chains c ON s.chainSlug = c.slug
WHERE s.chainSlug = {chainSlug}
ORDER BY s.name
```

**Indexes**: `stores_chain_slug_idx`

### Barcode Lookup

```sql
SELECT rib.barcode, ri.name, ri.brand, ri.chain_slug
FROM retailer_item_barcodes rib
INNER JOIN retailer_items ri ON rib.retailer_item_id = ri.id
WHERE rib.barcode = {barcode}
```

**Indexes**: `retailer_item_barcodes_barcode_new_idx`, `barcode_item_idx`

---

## 5. Data Quality Metrics

### 5.1 Price Availability Handling

The system tracks unavailable prices with structured reasons:

| Status | Reason | Meaning |
|--------|--------|---------|
| `unavailable` | `missing` | Price field was empty/null in source |
| `unavailable` | `invalid` | Price couldn't be parsed as number |
| `unavailable` | `non_positive` | Price was <= 0 |
| `available` | - | Valid price recorded |

**Source**: Schema `price_status` and `price_unavailable_reason` columns

### 5.2 Data Quality Features

1. **Duplicate Handling**: `ReplacingMergeTree(engine)` with `imported_at` version
2. **Change Detection**: Tracks `price_changes` in `ingestion_store_stats`
3. **Error Tracking**: `ingestion_errors` table with detailed error types
4. **Failed Rows Archive**: `retailer_items_failed` for re-processing
5. **Barcode Coverage**: Separate `retailer_item_barcodes` table with `is_primary` flag

---

## 6. Performance Characteristics

### ClickHouse Advantages

1. **Columnar Storage**: Only reads needed columns
2. **Data Skipping**: Partition pruning by (month, chain)
3. **Aggregation Speed**: Native `argMax()`, `countIf()`, `avg()` functions
4. **Array Parameters**: Efficient `IN ({itemIds:Array(String)})` queries
5. **Compression**: LowCardinality types for chain_slug

### PostgreSQL Strengths

1. **Complex Joins**: Store + Chain metadata enrichment
2. **Text Search**: ILIKE for product search
3. **Transaction Safety**: ACID for ingestion tracking
4. **Referential Integrity**: FK constraints maintain data consistency

---

## 7. Typical Query Performance (Expected)

| Query Type | Database | Expected Time | Rows |
|------------|----------|---------------|------|
| Latest prices by store | ClickHouse | < 50ms | 100-1000 |
| Cross-store comparison | ClickHouse + PG | < 100ms | 100-10000 |
| Basket optimization | ClickHouse + PG | < 200ms | Variable |
| Store coverage | ClickHouse | < 100ms | All stores |
| Item search | PostgreSQL | < 50ms | 20-100 |
| Barcode lookup | PostgreSQL | < 10ms | 1-10 |

---

## 8. Recommendations

### 8.1 Performance Optimization

1. **Materialized Views**: Consider for frequently accessed aggregations (e.g., daily average prices)
2. **Query Caching**: Cache results of "latest prices by store" queries
3. **Batch Operations**: Use array parameters for multi-item lookups
4. **Partition Maintenance**: Regularly drop old partitions based on retention policy

### 8.2 Data Quality Improvements

1. **Alerting**: Set up monitoring for chains with data > 3 days old
2. **Unavailable Rate Tracking**: Monitor and alert when unavailable rate > 20%
3. **Barcode Enrichment**: Prioritize barcode matching for better product resolution
4. **Store Validation**: Implement geocoding verification for store locations

### 8.3 Cross-Store Mall Features

The system already supports core queries needed for cross-store comparison:

1. **Price Comparison by Item**: Query 2 with barcode lookup
2. **Store Finder**: PostgreSQL location queries + Haversine distance calculation
3. **Basket Optimization**: Query 3 provides multi-store basket allocation
4. **Coverage Analysis**: Query 4 shows which stores have most complete data

**Recommended additional queries for mall features**:

```sql
-- Lowest price by item across all chains
SELECT
    retailer_item_id,
    argMax(name, target_date) AS name,
    min(argMax(price_cents, target_date)) AS min_price,
    argMin(chain_slug, argMax(price_cents, target_date)) AS cheapest_chain
FROM prices
WHERE target_date = {date}
    AND price_status = 'available'
    AND retailer_item_id IN ({itemIds})
GROUP BY retailer_item_id
```

```sql
-- Cross-chain product search by name
SELECT DISTINCT
    lower(name) AS normalized_name,
    groupArray(chain_slug) AS chains,
    count(DISTINCT chain_slug) AS chain_count
FROM prices
WHERE target_date = {date}
    AND positionCaseInsensitiveUTF8(name, {search}) > 0
GROUP BY normalized_name
HAVING chain_count >= 2
ORDER BY chain_count DESC
```

---

## 9. Key Files Reference

| File | Purpose |
|------|---------|
| `/workspace/scripts/clickhouse-schema.sql` | ClickHouse prices table definition |
| `/workspace/src/db/schema.ts` | PostgreSQL schema (865 lines) |
| `/workspace/src/orpc/router/prices.ts` | Store prices API |
| `/workspace/src/orpc/router/catalog-prices.ts` | Cross-store catalog prices API |
| `/workspace/src/lib/basket/optimizer.ts` | Basket optimization queries |
| `/workspace/src/ingestion/adapters/config.ts` | Chain configurations |
| `/workspace/src/lib/clickhouse/index.ts` | ClickHouse client wrapper |

---

## 10. Conclusion

The Kosarica system implements a well-designed dual-database architecture optimized for cross-store price comparison:

- **ClickHouse** provides excellent performance for time-series price data queries
- **PostgreSQL** maintains metadata and enables complex joins with referential integrity
- The `argMax()` pattern is efficient for latest-price queries
- Price availability is properly tracked with structured reasons
- Store coverage and basket optimization queries are performant

**The system is well-positioned for building a cross-comparison webshop/mall** - all core query patterns are already implemented and performant.
