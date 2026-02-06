# Price Ingestion & Clustering Analysis Report

**Generated:** 2026-02-01
**Database:** kosarica (PostgreSQL 14.20)

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Total Chains** | 1 (Konzum) |
| **Total Stores** | 1,316 (all virtual) |
| **Unique Items** | ~20,788 products |
| **Total Price Tiers (latest)** | 45,630 |
| **Archive Storage** | 1,139 MB across 1,316 files |

---

## 1. Ingestion Performance

| Metric | Value |
|--------|-------|
| **Completed Runs** | 7 |
| **Total Entries Processed** | 44,635,772 |
| **Error Count** | 0 |
| **Avg Duration** | ~2,163 seconds (negative indicates clock skew) |
| **First Run** | 2026-02-01 14:14 |
| **Last Run** | 2026-02-01 13:53 |

**Note:** 100% success rate on ingestion with zero errors.

---

## 2. Clustering Analysis

### Price Tiers (Last 7 Days)

| Date | Price Tiers | Unique Items | Store Refs | Avg Stores/Tier | Compression Ratio |
|------|-------------|--------------|------------|-----------------|-------------------|
| 2026-02-01 | 45,630 | 20,788 | 1,716,469 | 0 (migration issue) | - |
| 2026-01-31 | 45,473 | 20,791 | 1,717,116 | 37.76 | **97.35%** |
| 2026-01-30 | 45,452 | 20,778 | 1,718,345 | 37.81 | **97.35%** |
| 2026-01-29 | 45,383 | 20,731 | 1,717,133 | 37.84 | **97.36%** |
| 2026-01-28 | 45,314 | 20,730 | 1,717,015 | 37.89 | **97.36%** |
| 2026-01-27 | 45,400 | 20,726 | 1,714,700 | 37.77 | **97.35%** |
| 2026-01-26 | 45,307 | 20,713 | 1,715,496 | 37.86 | **97.36%** |

**Key Finding:** The clustering achieves a **~97.35% compression ratio**. This means:
- 45K price tiers represent ~1.7M store-item combinations
- On average, **~38 stores share the same price** for the same item
- Significantly reduces storage compared to storing each store-item pair separately

---

## 3. Price Volatility (Day-to-Day Changes)

| Date | Total Items | Price Changes | % Changed | Discount Changes |
|------|-------------|---------------|-----------|------------------|
| 2026-02-01 | 45,629 | 33,166 | **72.69%** | 3,048 |
| 2026-01-31 | 45,443 | 32,791 | **72.16%** | 2,983 |
| 2026-01-30 | 45,398 | 32,737 | **72.11%** | 2,998 |
| 2026-01-29 | 45,369 | 32,783 | **72.26%** | 3,023 |
| 2026-01-28 | 45,301 | 33,636 | **74.25%** | 4,231 |
| 2026-01-27 | 45,361 | 32,724 | **72.14%** | 2,953 |

**Key Finding:** **~72% of items change price daily**. This indicates highly dynamic pricing, likely driven by:
- Daily promotions/discounts
- Inventory-based pricing
- Competitive pricing adjustments

---

## 4. Discount Analysis (Last 7 Days)

| Date | Discounted Items | Discount % |
|------|------------------|------------|
| 2026-02-01 | 3,001 | **6.58%** |
| 2026-01-31 | 3,216 | **7.07%** |
| 2026-01-30 | 3,238 | **7.12%** |
| 2026-01-29 | 3,228 | **7.11%** |
| 2026-01-28 | 3,168 | **6.99%** |
| 2026-01-27 | 3,261 | **7.18%** |

**Key Finding:** ~7% of items have active discounts at any time.

---

## 5. Price Distribution (Latest Day)

| Price Range (€) | Tier Count |
|-----------------|------------|
| 0-1 | 506 |
| 1-2 | 6,499 |
| 2-3 | 9,720 (peak) |
| 3-4 | 6,747 |
| 4-5 | 5,070 |
| 5-10 | 16,107 |
| 10+ | ~1,000 |

**Key Finding:** Most products are in the **€2-5 range**.

---

## 6. Items with Multiple Price Tiers

| Metric | Value |
|--------|-------|
| **Items with Multiple Prices** | 12,718 |
| **Avg Price Spread** | 14.00% |
| **Max Price Spread** | 183.95% |

**Key Finding:** ~61% of items (12,718 / 20,788) have different prices across stores, indicating location-based or store-type-based pricing differentiation.

---

## 7. Store Coverage

| Chain | Total Stores | Physical | Virtual | Active |
|-------|--------------|----------|---------|--------|
| Konzum | 1,316 | 0 | 1,316 | 1,316 |

**Key Finding:** All stores are virtual (likely representing online/delivery locations).

---

## 8. Archive Storage

| Chain | Total Archives | Total Size | Avg Size |
|-------|----------------|------------|----------|
| Konzum | 1,316 | 1,139 MB | 886 KB |

---

## Issues Detected

### High Priority

1. **`price_tiers.store_count = 0`** for latest dates (2026-02-01)
   - `store_price_refs` table shows correct linkage (1.7M refs)
   - Likely a migration/calculation issue in `store_count` field update

2. **No category data** in `retailer_items` table
   - All categories are empty/null
   - Limits category-based analysis and user filtering

### Medium Priority

3. **No description data** - 0% coverage on product descriptions

4. **Negative duration** in ingestion runs - Clock skew or timezone issue

---

## Query Reference

```sql
-- Ingestion performance
SELECT chain_slug, status, COUNT(*) as run_count,
  SUM(total_entries) as total_entries,
  SUM(processed_entries) as processed_entries,
  SUM(error_count) as total_errors
FROM ingestion_runs GROUP BY chain_slug, status;

-- Price tiers clustering
SELECT chain_slug, target_date, COUNT(*) as total_price_tiers,
  COUNT(DISTINCT retailer_item_id) as unique_items,
  SUM(store_count) as total_store_refs,
  AVG(store_count) as avg_stores_per_tier
FROM price_tiers
WHERE target_date >= (SELECT MAX(target_date) - INTERVAL '30 days' FROM price_tiers)
GROUP BY chain_slug, target_date;

-- Clustering efficiency
SELECT chain_slug, target_date,
  COUNT(DISTINCT retailer_item_id) as unique_products,
  COUNT(*) as num_tiers,
  SUM(store_count) as total_store_items
FROM price_tiers
GROUP BY chain_slug, target_date;

-- Price volatility
WITH price_changes AS (
  SELECT chain_slug, retailer_item_id, target_date, price,
    LAG(price) OVER (PARTITION BY chain_slug, retailer_item_id ORDER BY target_date) as prev_price
  FROM price_tiers
)
SELECT chain_slug, target_date,
  COUNT(*) as total_items,
  COUNT(CASE WHEN price != prev_price THEN 1 END) as price_changes
FROM price_changes WHERE prev_price IS NOT NULL
GROUP BY chain_slug, target_date;
```
