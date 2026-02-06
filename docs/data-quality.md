# Data Quality Issues & Product Normalization

## Overview

The ingestion pipeline imports price data from 11 retail chains, but significant data quality issues prevent accurate price comparisons. This document outlines the issues and provides instructions for agents working on product normalization.

---

## Critical Issues

### 1. Case/Pallet Prices Stored as Unit Prices

**Problem:** Wholesale chains (Metro) record case/pallet prices in `price_cents` field instead of per-unit prices.

**Example:**
```
name: "2L COCA-COLA PET"
price_cents: 73918 (739.18 KN)
unit_price_cents: 92 (0.92 KN/L)
```

**Detection:**
- `price_cents` > 10x the median price for that product category
- `unit_price_cents` exists and is significantly lower than `price_cents`
- Price outliers > 100 KN for consumer products

**Solution:**
- Use `unit_price_cents` when available for price comparisons
- Otherwise, filter out `price_cents` values > 10x category median
- Add `is_bulk_price` flag to identify case/pallet prices

---

### 2. Brand Fragmentation - Same Product, Different Names

**Problem:** Identical products sold under different brand names are not matched.

**Example:**
```
"SVJEZE MLIJEKO 3,2% 1,75 L PET VINDIJA"     (Plodine, KTC)
"MLIJEKO SV.3,2% Z BREG.1,75 L"             (Interspar)
"Z bregov svježe mlijeko 3,2% 1,75 l PET"   (Kaufland)
"MLIJEKO SVJEŽE 3,2% ZBREGOV 1,75 l"        (Studenac)
"SVJEŽE MLIJEKO 3,2% 1,75L PET"            (Trgocentar)
```

All are the same product (fresh milk 3.2%, 1.75L) but different brands.

**Solution:**
- Extract product attributes: type (milk), fat (3.2%), volume (1.75L), packaging (PET)
- Create canonical product key: `milk-fresh-3.2-1.75l`
- Brand as secondary attribute, not primary identifier

---

### 3. Text Matching False Positives

**Problem:** Keyword search matches unrelated products.

**Example - searching for "jaj" (egg):**
- `TJESTEN. S JAJIMA` (pasta WITH eggs)
- `TJESTEN BEZ JAJA` (pasta WITHOUT eggs)
- `SET USKR. IGRAČAKA JAJA I FIGURICE` (Easter egg toy set)
- `JAJA I ČOKOLADA` (chocolate eggs)

**Solution:**
- Exclude known false-positive patterns
- Use category field when available
- Require product-specific keywords (e.g., "klasa" for egg grades)

---

### 4. Mixed Product Grades Not Separated

**Problem:** Premium and standard grades mixed together.

**Example for Eggs:**
- Class L (large): ~2.60 KN
- Class M (medium): ~2.40 KN
- Organic/free-range: 3.50-4.50 KN
- Price range appears as 1.39-4.82 KN

**Solution:**
- Extract grade/class from product name
- Create separate product keys for each grade
- Tag premium attributes (organic, free-range, etc.)

---

## Product Normalization Strategy

### Step 1: Attribute Extraction

Parse product names to extract structured attributes:

```typescript
interface ProductAttributes {
  // Core product identity
  category: string;        // "milk", "eggs", "coca-cola"
  subtype?: string;        // "fresh", "uht", "zero"

  // Quantity/size
  quantity: number;        // 1.75
  unit: string;            // "l", "kg", "kom"

  // Quality/grade
  fat_percent?: number;    // 3.2
  grade?: string;          // "L", "M", "A"
  organic?: boolean;
  free_range?: boolean;

  // Packaging
  packaging?: string;      // "PET", "carton", "glass"

  // Brand (secondary)
  brand?: string;          // "vindija", "z bregov"

  // Multipack info
  multipack_count?: number; // 2 for "2x2L"
}
```

### Step 2: Canonical Product Key

Generate a normalized key for matching:

```
format: {category}-{subtype}-{attributes}-{quantity}{unit}
examples:
  - milk-fresh-3.2-1.75l
  - eggs-l-10kom
  - coca-cola-regular-2l
  - coca-cola-zero-2l
```

### Step 3: Cross-Chain Matching

Match products across chains using:
1. Canonical key (primary)
2. Barcode (exact match, high confidence)
3. Name similarity (trigram, threshold 0.95)
4. Attributes + quantity (fuzzy match)

---

## Implementation Tasks

### Phase 1: Detection & Analysis

1. **Price Outlier Detection**
   - [ ] Identify prices > 10x category median
   - [ ] Check for `unit_price_cents` presence
   - [ ] Flag bulk/case prices

2. **Category Analysis**
   - [ ] Analyze top 100 products by frequency
   - [ ] Identify naming patterns per chain
   - [ ] Extract common attributes

3. **Brand Mapping**
   - [ ] Map milk brands (Vindija, Z Bregov, Dukat, etc.)
   - [ ] Map common products across chains
   - [ ] Identify private label brands

### Phase 2: Attribute Extractor

1. **Parser Development**
   - [ ] Build regex patterns for quantities
   - [ ] Extract units (l, kg, g, kom, ml)
   - [ ] Parse percentages (fat, alcohol)
   - [ ] Identify grades (L, M, S, A, B, C)

2. **Category Detection**
   - [ ] Build keyword→category mapping
   - [ ] Handle multilingual names (HR, EN)
   - [ ] Exclude false positives

### Phase 3: Normalization Engine

1. **Canonical Key Generation**
   - [ ] Implement `generateCanonicalKey(attributes)`
   - [ ] Test on real data
   - [ ] Handle edge cases

2. **Cross-Chain Matching**
   - [ ] Match by canonical key
   - [ ] Fallback to barcode
   - [ ] Fallback to name similarity
   - [ ] Store match confidence

3. **Database Schema**
   - [ ] Add `canonical_key` to products
   - [ ] Add `is_bulk_price` flag
   - [ ] Add `match_confidence` field
   - [ ] Add extracted attributes columns

---

## Testing Strategy

### Unit Tests
- Attribute extraction with various name formats
- Canonical key generation consistency
- Price outlier detection

### Integration Tests
- Load sample data from 3+ chains
- Verify cross-chain matching
- Check price accuracy after normalization

### Validation
- Manual review of top 50 products
- Verify price ranges make sense
- Compare with known retail prices

---

## Priority Products for Normalization

Start with these high-volume products:

1. **Milk** - 1.75L fresh, various fat percentages
2. **Eggs** - 10 pcs, grades L and M
3. **Coca-Cola** - 2L regular and zero
4. **Bread** - Common white/whole wheat loaves
5. **Butter** - 100g-200g packs
6. **Water** - 1.5L-2L still water
7. **Flour** - 1kg Type 500, T400
8. **Sugar** - 1kg white sugar
9. **Oil** - 1L sunflower oil
10. **Coffee** - Common instant/ground brands

---

## ClickHouse Queries for Analysis

### Find Price Outliers
```sql
SELECT
    chain_slug,
    name,
    count() as records,
    min(price_cents)/100.0 as min_price,
    max(price_cents)/100.0 as max_price,
    avg(price_cents)/100.0 as avg_price
FROM kosarica.prices
WHERE [CONDITIONS]
GROUP BY chain_slug, name
HAVING max_price > avg_price * 10
ORDER BY max_price DESC;
```

### Find Similar Products
```sql
SELECT
    chain_slug,
    name,
    count() as records
FROM kosarica.prices
WHERE lower(name) LIKE '%KEYWORD%'
GROUP BY chain_slug, name
ORDER BY records DESC;
```

### Analyze Unit Price Availability
```sql
SELECT
    chain_slug,
    count() as total,
    countIf(unit_price_cents > 0) as with_unit_price,
    round(with_unit_price / total * 100, 2) as percent_with_unit
FROM kosarica.prices
GROUP BY chain_slug;
```
