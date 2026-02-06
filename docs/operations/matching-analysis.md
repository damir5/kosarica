# Product Matching & Price Comparison Analysis

**Date:** 2026-02-05
**Database snapshot:** 1,379,314 retailer_items, 11 chains, 0% matched (barcode matching not yet run)

---

## 1. Current State of Data

### 1.1 Scale per Chain

| Chain | Total Rows | Distinct Names | Has External ID | Has Barcodes | Barcode Coverage |
|-------|-----------|---------------|----------------|-------------|-----------------|
| Eurospin | 990,298 | 3,905 | **NO** | 4,479 | 0.5% |
| InterSpar | 228,178 | 23,275 | **NO** | 23,977 | 10.5% |
| Plodine | 27,530 | 27,446 | YES | 25,646 | 93.2% |
| DM | 23,064 | 22,966 | YES | 23,064 | **100%** |
| Studenac | 21,703 | 21,325 | YES | 18,718 | 86.3% |
| Konzum | 21,024 | 20,980 | YES | 20,073 | 95.5% |
| Kaufland | 20,237 | 20,201 | YES | 20,227 | 99.9% |
| KTC | 15,934 | 15,867 | YES | 15,128 | 94.9% |
| Metro | 13,572 | 11,464 | YES | 13,571 | 99.9% |
| Trgocentar | 11,074 | 11,037 | YES | 11,074 | 99.9% |
| Lidl | 6,700 | 6,374 | YES | 6,558 | 97.9% |

**Key observations:**
- Eurospin has ~990K rows but only ~3,900 unique products (massive per-store duplication with no external_id for dedup)
- InterSpar similarly has 228K rows but ~23K unique products, also no external_id
- After deduplication, real unique product count is roughly **~180K distinct items** across all chains
- Most chains have very good barcode coverage (90%+), except Eurospin and InterSpar

### 1.2 Barcode Cross-Chain Overlap

| Chains sharing barcode | Count |
|----------------------|-------|
| 1 chain only | 85,508 |
| 2 chains | 8,643 |
| 3 chains | 4,408 |
| 4 chains | 3,398 |
| 5 chains | 2,730 |
| 6 chains | 2,276 |
| 7 chains | 2,129 |
| 8 chains | 1,349 |
| 9 chains | 611 |
| 10 chains | 98 |

**~25,642 barcodes appear in 2+ chains** - these are immediate cross-chain matches waiting to happen via barcode matching. This covers branded packaged goods well.

### 1.3 Unit & Quantity Data Quality

**Units are messy and inconsistent:**
- Same concept in different formats: `KG`, `kg`, `KOM`, `kom`, `ko`, `PZ`, `L`, `l`, `LT`
- Embedded quantities in unit field: `500g`, `0,75l`, `1komad`, `200g`
- Quantities mix unit repetition: `"1.00 kg"`, `"0,500 KG"`, `"1000 G"`, `"1 KOM"`, `".75 L"`

**Unit data availability by chain:**
- unit_quantity is **completely missing** from: Eurospin, InterSpar, Studenac
- Quantity often embedded in product name instead (e.g., "SKUSA IZOLA S POVRCEM **125 G** DELAMARIS")

### 1.4 Category Data

All chains provide category data but with inconsistent casing:
- `HRANA` / `Hrana` / `hrana` (same)
- `KOZMETIKA` / `Kozmetika`
- `PIĆE` / `PICE` / `Pi\u0107a`

Major categories across all chains: Food (~80%), Cosmetics/Personal Care (~10%), Cleaning (~5%), Beverages (~5%)

---

## 2. Matching Approach - Multi-Layer Strategy

### Layer 1: Barcode Matching (already built, needs to run)

**What it does:** Exact barcode lookup across chains
**Coverage:** ~25,642 barcodes in 2+ chains → connects branded products automatically
**Estimated match:** ~25K canonical products linked to ~80K+ retailer items
**Confidence:** Very high (barcode = same product)
**Status:** Code exists in `src/lib/matching/index.ts`, just needs to be executed

### Layer 2: Deduplicate Eurospin & InterSpar

**Problem:** These two chains have no `external_id`, creating massive row duplication across stores.
**Solution:**
1. Group by normalized name (lowercase, remove diacritics, normalize whitespace)
2. Create synthetic external_id from name hash
3. Pick one representative item per group, link barcodes to it
4. This alone reduces 1.2M rows → ~27K distinct items

### Layer 3: Unit & Quantity Normalization

**Problem:** Can't compare prices without knowing what you're comparing
**Solution - Parse and normalize into a standard format:**

```
Input: "Kraš napolitanke nugat 420 g" with unit=KOM, qty=0.420
Output: { quantity: 0.420, unit: "kg", unitPrice: price / 0.420 per kg }

Input: "Donat Mg 0,5L" with unit=L, qty=0.5
Output: { quantity: 0.5, unit: "l", unitPrice: price / 0.5 per l }
```

**Normalization rules:**
1. Standardize unit names: `KG`/`kg`/`g`/`G` → `kg` (convert g→kg at /1000)
2. `L`/`l`/`LT`/`ml` → `l` (convert ml→l at /1000)
3. `KOM`/`kom`/`ko`/`PZ`/`1komad` → `kom` (piece)
4. Parse embedded quantities from unit field: `500g` → 0.5kg, `0,75l` → 0.75l
5. Parse quantities from product name when unit_quantity is missing
6. Calculate unit_price = price / quantity (per 1kg, 1l, or 1 piece)

### Layer 4: Text-Based Matching (Fuzzy / Trigram)

**Already partially built** (trigram matching exists in codebase)

**Improvements needed:**
1. **Name normalization pipeline:**
   - Lowercase
   - Remove diacritics (č→c, š→s, ž→z, ć→c, đ→d)
   - Remove common noise: "rfz", "rinfuza", "rfs", "MAP", "BK", "VP", "BKK", "cca"
   - Normalize weight mentions: "500g" → "500 g"
   - Strip chain-specific prefixes ("*", brand prefixes)

2. **Category-aware matching:** Only compare items within same category
3. **Brand-aware matching:** Branded items must match brand, generic items skip brand check
4. **Weight-aware matching:** "Čokolino 500g" ≠ "Čokolino 1kg" (different products/sizes → product_relations as variants)

### Layer 5: Generic/Commodity Item Matching

**Problem:** Fresh produce, meat, bulk items have different names per chain:
- `JABUKA FUJI` / `Jabuka fuji rfz` / `JABUKA FUJI RINFUZA` / `Jabuka Fuji kg` → same product
- `LIMUN` / `Limun rfz` / `LIMUN NATALIA` → same or different?
- `SVINJSKA LOPATICA` / `SVINJSKA LOPATICA BK` / `SVINJSKA LOPATICA 4D (BKK)` → variants

**Solution - Commodity taxonomy:**

Create a **commodity dictionary** mapping canonical names to patterns:
```
{ canonical: "Jabuka Fuji", patterns: ["jabuka fuji", "fuji jabuka"], unit: "kg" }
{ canonical: "Limun", patterns: ["limun"], unit: "kg", excludePatterns: ["limunada", "limun.*sirup"] }
{ canonical: "Banane", patterns: ["banana", "banane"], unit: "kg" }
{ canonical: "Svinjska lopatica", patterns: ["svinjska lopatica"], unit: "kg" }
```

**Auto-detection rules for generics:**
- Items sold by kg without barcodes in "HRANA" category → likely commodity
- Multiple chains have exact/near-exact uppercase name → commodity
- Items with "rfz", "rinfuza", "rinfuz", "kg" suffix → bulk commodity

**Quality tiers within generics:**
- BIO/organic variants → separate product, linked as relation_type='variant'
- Premium/named varieties → separate product (e.g., "JABUKA FUJI" ≠ "JABUKA GRANNY SMITH")
- Brand-specific generics → separate (e.g., "MANDARINA" vs "MANDARINA NATALIA")

### Layer 6: AI-Assisted Matching

For remaining unmatched items (~10-20% of catalog):
1. Use LLM to extract structured data from messy product names:
   - Brand, product type, variant, weight, count
2. Generate embedding vectors for product names
3. Cluster similar products and suggest matches
4. Human review queue for uncertain matches (already built: `product_match_queue`)

---

## 3. Unit Price Calculation Strategy

### 3.1 Base Units

| Category | Base Unit | Example |
|----------|----------|---------|
| Weight items | 1 kg | Meat, cheese, produce |
| Liquid items | 1 L | Drinks, cleaning products |
| Piece items | 1 piece | Packaged goods |

### 3.2 Parsing Quantity from Product Names

Many items embed quantity in the name. Regex extraction:
```
"SKUSA IZOLA S POVRCEM 125 G" → 125g → 0.125kg
"SOK LEMONISH LIMUN BAZGA 0,4 L" → 0.4l
"JAJA L 10/1" → 10 pieces
"BADEM JEZGRA 500g" → 500g → 0.5kg
"Persil Deterdžent 110 pranja" → 110 washes (special unit)
```

### 3.3 Multi-Pack Handling

```
"Desert u čaši SK2" with qty "2x60g" → 120g total, unitPrice per kg
"JAJA L 10/1" → 10 pieces, unitPrice per piece
"Donat Mg 6x0,5L" → 3L total, unitPrice per liter
```

### 3.4 Display Logic

| Scenario | Display |
|----------|---------|
| Same product, same size, different chains | Direct price comparison |
| Same product, different sizes | Show unit price (€/kg or €/L) for comparison |
| Generic commodity (e.g., bananas) | Show all chains' per-kg prices |
| Multi-pack vs single | Show both pack price and unit price |

---

## 4. Implementation Phases

### Phase 1: Foundation (barcode + dedup)
1. **Run barcode matching** - execute existing code
2. **Deduplicate Eurospin/InterSpar** - group by name hash, create external_ids
3. **Normalize units** - standardize unit field across all chains
4. **Calculate unit prices** - for all items where quantity is known

### Phase 2: Text Matching
1. Build name normalization pipeline (strip noise, normalize diacritics)
2. Run improved trigram matching within same category
3. Queue uncertain matches for review

### Phase 3: Commodity Matching
1. Build commodity dictionary (50-100 common produce/meat items)
2. Auto-match commodities across chains
3. Create quality tier relationships (bio, premium, standard)

### Phase 4: AI Enhancement
1. LLM-based name parsing for quantity/brand extraction
2. Embedding-based similarity for remaining items
3. Human review workflow for edge cases

### Phase 5: Price Comparison UX
1. **Search by product** → show all chain prices, sorted by unit price
2. **Category browse** → cheapest per category across chains
3. **Basket comparison** → total basket cost per store
4. **Price alerts** → watch items, notify on drops
5. **Generic commodity view** → e.g., "Banane" shows all chains' per-kg price

---

## 5. Brainstorm: Making Price Comparison Accessible

### 5.1 User-Facing Features

- **"Scan & Compare"**: User scans barcode → instantly see price at every chain
- **"Cheapest basket"**: Enter shopping list → see optimal store(s) considering distance
- **"Price map"**: Geographic view of prices (same item can differ by store location)
- **"Weekly deals"**: Cross-chain comparison of discounted items
- **"Price history"**: Chart showing price over time, highlight 30-day low
- **"Similar but cheaper"**: Suggest alternatives (store brand vs. name brand)

### 5.2 Data Quality Dashboard (internal)

- Match rate per chain (target: >90%)
- Unmatched items queue with priority ranking
- Unit price coverage (target: >95%)
- Commodity dictionary coverage
- Cross-chain price anomaly detection (same barcode, wildly different price)

### 5.3 Content & Engagement

- **"Price of the week"**: Auto-generate social posts comparing common items
- **"Inflation tracker"**: Month-over-month category price changes
- **"Best value finder"**: AI-curated lists per category
- **"Crowdsource help"**: Let users confirm/reject product matches (gamification)

### 5.4 Monetization Angles

- Free: basic price lookup, limited favorites
- Premium: full basket optimization, price alerts, history, no ads
- "Points" system: earn by contributing matches, reporting availability

---

## 6. Estimated Impact

| Layer | Items Matched | Coverage After |
|-------|-------------|---------------|
| Barcode matching | ~80K items (25K products) | ~45% of distinct items |
| Eurospin/InterSpar dedup | reduces noise, no new matches | cleaner data |
| Text/trigram matching | ~15K items | ~55% |
| Commodity matching | ~5K items (high-value!) | ~58% |
| AI + human review | ~10K items | ~65%+ |

The remaining ~35% will be chain-exclusive items (private labels, local specialties) that don't have equivalents at other chains but still need unit price normalization for within-chain comparison.
