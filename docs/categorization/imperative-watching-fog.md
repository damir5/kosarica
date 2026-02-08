# Listwise LLM Clustering: Trial Framework

## Context

The current semantic clustering system uses **pairwise LLM adjudication** — generating item pairs, asking "are A and B the same?", then building clusters via union-find. This works but has limitations: the LLM lacks global context (can't see price ladders or the full variant space), and pair volume scales quadratically.

We're transitioning to **listwise group-based clustering** where the LLM receives a block of 30-120 related items and directly outputs base product clusters with pack/size variants. Price data from ClickHouse is included as a signal. This gives the model global context to reason about pack structures (e.g., €1 single vs €6 six-pack).

**This plan focuses on building the trial/experimentation framework first** — prompts, group generation, price fetching, and a runnable script to test models on sample categories. Production cron integration comes later.

---

## Architecture: Two-Stage Prompting

**Stage 1 — Extraction**: Raw titles → structured OfferSpec (brand, product, variant, pack_count, unit_size, container, total_qty)
**Stage 2 — Clustering**: OfferSpecs + raw titles + median prices → base product clusters with pack variants

Separation benefits: extraction is cacheable/auditable independently, validates against rule-based `parseRetailerItemFeature()`, and different models can be used per stage.

---

## Implementation Plan

### Step 1: Types and schemas
**File**: `src/lib/semantic-clustering/listwise/types.ts`

Define TypeScript types:
- `OfferSpec` — LLM extraction output per item (brand, product, variant, pack_count, unit_size, unit_amount_ml_or_g, container, total_quantity, total_amount_ml_or_g)
- `GroupItem` — item within a candidate group (retailerItemId, rawName, normalizedName, brand, category, unit, totalAmount, packAmount, containerType, chainSlug, embedding)
- `CandidateGroup` — a block of items to cluster (groupId, seedKey, items[], category, brand)
- `ExtractionResult` — parsed response from extraction prompt (items[] with OfferSpec)
- `ClusteringResult` — parsed response from clustering prompt (base_products[] with pack_variants[], unclassified[], confidence, reasoning)
- `ListwiseLLMResult` — combined result (extraction, clustering, modelId, latencies)
- `TrialMetrics` — evaluation metrics (precision, recall, F1 at base/variant/item levels)
- `GoldSet` — ground truth structure for evaluation

### Step 2: Extraction prompt
**File**: `src/lib/semantic-clustering/listwise/extraction-prompt.ts`

`buildExtractionPrompt(items: {id, rawName}[])` → system + user messages

- System: "Return strict JSON only."
- User: Expert product data analyst for Croatian grocery retail. Extract structured fields from raw titles.
- Rules for Croatian context: "kom"=piece, "dag"/"dkg"=10g, handle "6x330ml" multipacks, detect container from Croatian words (boca/limenka/staklo/pak)
- JSON schema for `response_format` negotiation: `{ items: [{ id, brand, product, variant, pack_count, unit_size, unit_amount_ml_or_g, container, total_quantity, total_amount_ml_or_g }] }`
- `parseExtractionResponse(raw, groupItems)` — validates, maps by ID, falls back to rule-based feature for missing items

### Step 3: Clustering prompt
**File**: `src/lib/semantic-clustering/listwise/clustering-prompt.ts`

`buildClusteringPrompt(items: {id, rawName, spec: OfferSpec, medianPriceEur, chainSlug}[])` → system + user messages

- System: "Return strict JSON only."
- User: Expert product clustering system for Croatian grocery retail.
- Definitions: Base Product (abstract product concept), Pack Variant (same product, different packaging)
- Rules: different brands → always different base; different flavors/variants → different base; same physical product from different chains → same cluster; price ratios as validation hints (2x price ≈ 2x volume); conservative (prefer splitting over merging)
- JSON schema: `{ base_products: [{ base_id, canonical_name, brand, category, pack_variants: [{ variant_key, variant_label, item_ids[], unit_size, pack_count, container }] }], unclassified: [], confidence, reasoning }`
- `parseClusteringResponse(raw, groupItems)` — validates all item_ids are accounted for, checks for duplicates

### Step 4: LLM call orchestration
**File**: `src/lib/semantic-clustering/listwise/llm-call.ts`

Reuse patterns from existing `src/lib/semantic-clustering/llm.ts`:
- `callModel(config: EnsembleModelConfig, systemMsg, userMsg, jsonSchema?)` — dispatches to OpenAI-compatible or Claude path via raw `fetch()`
- Same adaptive `response_format` negotiation (json_object → json_schema → text fallback, cached per endpoint)
- Same `extractJsonPayload()` with regex fallback for response parsing
- Same retry logic (linear backoff, configurable maxRetries)
- **Key difference**: `max_tokens` set higher (~4000-8000) since listwise outputs are larger than pair verdicts
- `processGroupWithLLM(config, group, prices)` → calls extraction then clustering sequentially, returns `ListwiseLLMResult`

**Reuse directly** from existing `llm.ts` (import, don't copy):
- `extractJsonPayload()` — export it if not already exported
- `readApiKey()` from `config.ts`
- `parseEnsembleConfig()` from `config.ts`
- `EnsembleModelConfig` type from `config.ts`

### Step 5: Price fetching from ClickHouse
**File**: `src/lib/semantic-clustering/listwise/price-fetch.ts`

`fetchMedianPrices(itemIds: string[])` → `Map<string, {medianPriceCents, quoteCount}>`

ClickHouse query (follows pattern from `tmp/cola-pack-price-clusters.ts`):
```sql
SELECT
  retailer_item_id,
  median(effective_price) AS median_price,
  count() AS quote_count
FROM (
  SELECT
    retailer_item_id, chain_slug, store_id,
    argMax(if(discount_price_cents IS NULL, price_cents, discount_price_cents), target_date) AS effective_price
  FROM prices
  WHERE retailer_item_id IN ({ids:Array(String)})
    AND target_date >= today() - 30
  GROUP BY retailer_item_id, chain_slug, store_id
)
GROUP BY retailer_item_id
```

- Uses `getClickHouse().query<T>()` from `src/lib/clickhouse/index.ts`
- 30-day lookback, median across all stores/chains per item
- Graceful: returns empty map on ClickHouse connection failure (prices are optional signal)
- Converts cents → EUR when passing to prompt

### Step 6: Candidate group generation
**File**: `src/lib/semantic-clustering/listwise/group-gen.ts`

**For trials**: `buildGroupFromQuery(query: {namePattern?, category?, brand?, limit?})` → `CandidateGroup`
- Simple SQL query on `retailer_items` + `retailer_item_features` with filters
- Used by the trial script to build groups from category/brand/name patterns
- E.g., `buildGroupFromQuery({ namePattern: 'jar', category: '%ciscenje%', limit: 150 })`

**For production (later)**: `generateCandidateGroups(options)` → `CandidateGroup[]`
- Seed key: `(normalized_category, extracted_brand, name_stem)` from `retailer_item_features`
- Expand via embedding KNN lateral join (reuse existing HNSW index)
- Expand via barcode links from `retailer_item_barcodes`
- Split oversized groups (>200) via simple k-means on embeddings in TS
- Target group size: 30-120 items

### Step 7: Trial runner script
**File**: `tmp/run-listwise-trial.ts`

CLI script: `pnpm tsx tmp/run-listwise-trial.ts`

Workflow:
1. Define sample groups inline or load from JSON:
   - **Cola**: `WHERE LOWER(name) ~ '\m(coca.?cola|pepsi|sky.?cola|cola)\M' AND category LIKE '%pice%'`
   - **Banana**: `WHERE LOWER(name) LIKE '%banan%' AND category LIKE '%voce%'`
   - **Chocolate**: `WHERE LOWER(name) LIKE '%cokolad%' OR LOWER(name) LIKE '%chocolat%'`
   - **Meats**: `WHERE category LIKE '%meso%' AND LOWER(name) LIKE '%pile%'` (chicken as a start)
   - **Jar detergent**: `WHERE LOWER(name) LIKE '%jar%' AND category LIKE '%ciscenje%'`
   - **Diverse sample**: Random 100 items from a mid-frequency category (e.g., yogurt, coffee)
2. For each sample group:
   a. Build group via `buildGroupFromQuery()`
   b. Fetch prices via `fetchMedianPrices()`
   c. For each model in `LLM_ENSEMBLE_JSON`:
      - Run `processGroupWithLLM(config, group, prices)`
      - Print extraction results table (item name → extracted spec)
      - Print clustering results (base products → variants → items)
      - Print per-item price + unit price within clusters
      - Log latency + estimated token count
3. Output comparison: side-by-side model results per group, highlight disagreements
4. Write results to JSON file for later analysis

**No gold sets needed initially** — first runs are exploratory (eyeball the output, iterate on prompts). Gold sets can be derived from the best model's output after manual review.

### Step 8: Barrel export
**File**: `src/lib/semantic-clustering/listwise/index.ts`

Export public API: `processGroupWithLLM`, `buildGroupFromQuery`, `fetchMedianPrices`, types.

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/semantic-clustering/listwise/types.ts` | Create | Type definitions |
| `src/lib/semantic-clustering/listwise/extraction-prompt.ts` | Create | Stage 1 prompt + parser |
| `src/lib/semantic-clustering/listwise/clustering-prompt.ts` | Create | Stage 2 prompt + parser |
| `src/lib/semantic-clustering/listwise/llm-call.ts` | Create | LLM call orchestration |
| `src/lib/semantic-clustering/listwise/price-fetch.ts` | Create | ClickHouse price fetcher |
| `src/lib/semantic-clustering/listwise/group-gen.ts` | Create | Group generation (query-based for trials) |
| `src/lib/semantic-clustering/listwise/index.ts` | Create | Barrel exports |
| `tmp/run-listwise-trial.ts` | Create | Trial runner script |
| `src/lib/semantic-clustering/llm.ts` | Modify | Export `extractJsonPayload` if not already exported |

**Not modified** (reused as-is): `config.ts`, `normalize.ts`, `pipeline.ts`, `src/lib/clickhouse/index.ts`, `src/lib/embeddings/`
**Not yet built** (Phase 2, after trials succeed): DB schema tables, cron handler, persist logic, production group generation

---

## Verification

1. **Run trial script**: `pnpm tsx tmp/run-listwise-trial.ts`
2. **Check extraction quality**: Compare LLM-extracted OfferSpec against `parseRetailerItemFeature()` output for the same items — brand, pack_count, unit_size, container should broadly agree
3. **Check clustering quality**:
   - Jar: Should separate liquid soap vs tablets vs Platinum vs Platinum Plus; group variants (lemon/apple/chamomile) correctly within each size
   - Cola: Should separate Coca-Cola vs Pepsi vs store-brand; identify single vs 6-pack vs 24-pack
   - Banana: Should cluster into a single base with kg/piece variants
4. **Check price signal usage**: Within a variant cluster, unit prices should be roughly consistent. Large outliers indicate misclassification.
5. **Compare models**: Run with 2-3 models (e.g., gpt-4o-mini, gemini-2.5-flash, deepseek-v3.2), compare quality and latency
