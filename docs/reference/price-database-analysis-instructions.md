# Price Database Analysis Instructions

## Purpose

This document outlines the queries and metrics to review for ongoing price ingestion and clustering analysis.

---

## Running the Analysis

### Prerequisites

```bash
# Database connection
export DATABASE_URL="postgresql://kosarica:kosarica@localhost:5432/kosarica"

# Or connect directly
psql -h localhost -U kosarica -d kosarica
```

---

## Core Analysis Queries

### 1. Ingestion Performance Summary

Track ingestion runs, success rates, and throughput.

```sql
SELECT
  chain_slug,
  status,
  COUNT(*) as run_count,
  SUM(total_entries) as total_entries,
  SUM(processed_entries) as processed_entries,
  SUM(error_count) as total_errors,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds,
  MIN(started_at) as first_run,
  MAX(completed_at) as last_run
FROM ingestion_runs
WHERE started_at IS NOT NULL
GROUP BY chain_slug, status
ORDER BY chain_slug, status;
```

**What to review:**
- Error counts should remain at 0
- Duration trends (watch for slowdowns)
- Processing throughput (entries/second)

---

### 2. Price Tiers Clustering Metrics

Monitor clustering efficiency daily.

```sql
SELECT
  chain_slug,
  target_date,
  COUNT(*) as total_price_tiers,
  COUNT(DISTINCT retailer_item_id) as unique_items,
  SUM(store_count) as total_store_refs,
  AVG(store_count) as avg_stores_per_tier,
  MAX(store_count) as max_stores_per_tier,
  COUNT(CASE WHEN discount_price IS NOT NULL THEN 1 END) as discounted_items,
  ROUND(100.0 * COUNT(CASE WHEN discount_price IS NOT NULL THEN 1 END) / COUNT(*), 2) as discount_pct
FROM price_tiers
WHERE target_date >= (SELECT MAX(target_date) - INTERVAL '30 days' FROM price_tiers)
GROUP BY chain_slug, target_date
ORDER BY target_date DESC, chain_slug;
```

**What to review:**
- `store_count` should NOT be 0 (indicates migration bug)
- `avg_stores_per_tier` ~38 is expected for Konzum
- `discount_pct` should be ~7%

---

### 3. Clustering Efficiency (Compression Ratio)

Calculate storage savings from clustering.

```sql
WITH clustering_efficiency AS (
  SELECT
    chain_slug,
    target_date,
    COUNT(*) as num_tiers,
    SUM(store_count) as total_store_items,
    SUM(store_count)::NUMERIC / COUNT(*) as items_per_tier,
    COUNT(DISTINCT retailer_item_id) as unique_products
  FROM price_tiers
  WHERE target_date >= (SELECT MAX(target_date) - INTERVAL '7 days' FROM price_tiers)
  GROUP BY chain_slug, target_date
)
SELECT
  chain_slug,
  target_date,
  unique_products,
  num_tiers,
  total_store_items,
  ROUND(100.0 * (1 - num_tiers::NUMERIC / NULLIF(total_store_items, 0)), 2) as compression_ratio_pct,
  items_per_tier as avg_stores_per_price_tier
FROM clustering_efficiency
ORDER BY target_date DESC, chain_slug;
```

**What to review:**
- Compression ratio should remain ~97%
- Drop indicates deduplication issues

---

### 4. Price Volatility (Day-to-Day Changes)

Track price stability.

```sql
WITH price_changes AS (
  SELECT
    pt.chain_slug,
    pt.retailer_item_id,
    pt.target_date,
    pt.price,
    pt.discount_price,
    LAG(pt.price) OVER (PARTITION BY pt.chain_slug, pt.retailer_item_id ORDER BY pt.target_date) as prev_price,
    LAG(pt.discount_price) OVER (PARTITION BY pt.chain_slug, pt.retailer_item_id ORDER BY pt.target_date) as prev_discount
  FROM price_tiers pt
  WHERE pt.target_date >= (SELECT MAX(target_date) - INTERVAL '30 days' FROM price_tiers)
),
volatility AS (
  SELECT
    chain_slug,
    target_date,
    COUNT(*) as total_items,
    COUNT(CASE WHEN price != prev_price THEN 1 END) as price_changes,
    COUNT(CASE WHEN COALESCE(discount_price, 0) != COALESCE(prev_discount, 0) THEN 1 END) as discount_changes,
    ROUND(100.0 * COUNT(CASE WHEN price != prev_price THEN 1 END)::NUMERIC / COUNT(*), 2) as price_change_pct
  FROM price_changes
  WHERE prev_price IS NOT NULL
  GROUP BY chain_slug, target_date
)
SELECT * FROM volatility
ORDER BY target_date DESC, chain_slug;
```

**What to review:**
- Daily change % ~72% is expected
- Spikes may indicate promotion events
- Drops may indicate data issues

---

### 5. Retail Items Catalog Quality

Monitor data completeness.

```sql
SELECT
  chain_slug,
  COUNT(*) as total_items,
  COUNT(DISTINCT barcode) as unique_barcodes,
  COUNT(DISTINCT category) as unique_categories,
  COUNT(DISTINCT brand) as unique_brands,
  COUNT(CASE WHEN description IS NOT NULL AND description != '' THEN 1 END) as with_description,
  ROUND(100.0 * COUNT(CASE WHEN description IS NOT NULL AND description != '' THEN 1 END)::NUMERIC / COUNT(*), 2) as description_coverage_pct
FROM retailer_items
GROUP BY chain_slug
ORDER BY chain_slug;
```

**What to review:**
- Category coverage should increase from 0%
- Description coverage should increase from 0%
- Brand coverage should increase from 0%

---

### 6. Store Coverage

Track store count and status.

```sql
SELECT
  s.chain_slug,
  COUNT(*) as total_stores,
  COUNT(CASE WHEN s.is_virtual = false THEN 1 END) as physical_stores,
  COUNT(CASE WHEN s.is_virtual = true THEN 1 END) as virtual_stores,
  COUNT(CASE WHEN s.status = 'active' THEN 1 END) as active_stores,
  COUNT(CASE WHEN s.status = 'pending' THEN 1 END) as pending_stores
FROM stores s
GROUP BY s.chain_slug
ORDER BY total_stores DESC;
```

---

### 7. Items with Multiple Price Tiers

Track price differentiation across stores.

```sql
WITH multi_tier_items AS (
  SELECT
    pt.retailer_item_id,
    ri.name,
    pt.chain_slug,
    pt.target_date,
    COUNT(*) as num_tiers,
    MIN(pt.price) as min_price,
    MAX(pt.price) as max_price,
    ROUND((MAX(pt.price) - MIN(pt.price))::NUMERIC / NULLIF(MIN(pt.price), 0) * 100, 2) as price_spread_pct
  FROM price_tiers pt
  JOIN retailer_items ri ON pt.retailer_item_id = ri.id
  WHERE pt.target_date = (SELECT MAX(target_date) FROM price_tiers)
  GROUP BY pt.retailer_item_id, ri.name, pt.chain_slug, pt.target_date
  HAVING COUNT(*) > 1
)
SELECT
  chain_slug,
  COUNT(*) as items_with_multiple_prices,
  ROUND(AVG(price_spread_pct)::NUMERIC, 2) as avg_spread_pct,
  MAX(price_spread_pct) as max_spread_pct
FROM multi_tier_items
GROUP BY chain_slug;
```

**What to review:**
- ~61% items with multiple prices is expected
- Spread % > 100% warrants investigation

---

### 8. Store Price References Validation

Verify `store_price_refs` linkage.

```sql
SELECT
  target_date,
  COUNT(*) as total_refs,
  COUNT(DISTINCT store_id) as unique_stores,
  COUNT(DISTINCT retailer_item_id) as unique_items,
  COUNT(CASE WHEN in_stock = true THEN 1 END) as in_stock_count
FROM store_price_refs
WHERE target_date >= (SELECT MAX(target_date) - INTERVAL '7 days' FROM store_price_refs)
GROUP BY target_date
ORDER BY target_date DESC;
```

**What to review:**
- `unique_stores` should match expected store count
- `in_stock_count` should equal `total_refs`
- Daily counts should be stable

---

## Known Issues to Monitor

| Issue | Expected Fix | Check Query |
|-------|--------------|-------------|
| `store_count = 0` | Migration fix | Clustering metrics query |
| No category data | Source parsing | Catalog quality query |
| No description data | Source parsing | Catalog quality query |
| Negative duration | Timezone fix | Ingestion performance query |

---

## Regenerating the Report

To generate a fresh report:

```bash
# Run all analysis queries
PGPASSWORD=kosarica psql -h localhost -U kosarica -d kosarica -f analysis-queries.sql

# Or use the Claude Code agent
# Ask: "check db and report price ingestion performance"
```

---

## Schedule

- **Daily:** Spot check latest `target_date` in `price_tiers`
- **Weekly:** Full clustering and volatility analysis
- **Monthly:** Archive storage cleanup and catalog quality review
