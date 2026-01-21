# Gap Analysis: Phase 5 & Phase 7 Plans

This analysis identifies unspecified areas in `doc/tmp/phase5-plan-reviewed.md` and `doc/tmp/phase7-plan-reviewed.md` that require definition before implementation.

## Phase 5: Basket Optimization

### 1. `ItemPriceInfo` Logic for Effective Price

- **Missing:** The Go code for `GetEffectivePrice` is provided (lines 1001-1007), but the `ItemPriceInfo` struct in the API response schema (lines 820-828) has both `UnitPrice` and `DiscountPrice`. It's not explicitly stated *which* value populates `UnitPrice` in the response: the raw base price or the effective price?
- **Why it matters:** Frontend clients need to know if `UnitPrice` is "always the price you pay" or "the base price before discount". Ambiguity leads to UI bugs (showing double discounts or wrong totals).
- **Suggested Specification:**
  - `UnitPrice`: Always the **base/list price** (before discount).
  - `DiscountPrice`: Optional field. If present, it is the **effective price** to be used for calculation.
  - `LineTotal`: Must be calculated as `Quantity * (DiscountPrice if present else UnitPrice)`.
  - **Invariant:** `RealTotal` in `SingleStoreResult` must equal sum of all `LineTotal`.

### 2. Missing Item "Penalty" Visualization

- **Missing:** The plan specifies a "penalty approach" for sorting (line 96) and a `MissingItem` struct (line 106), but doesn't define how the frontend should *display* these penalties to the user. Does the user see the "SortingTotal" (inflated) or the "RealTotal"? If they see RealTotal, the sorting might look wrong (a cheaper basket ranked lower).
- **Why it matters:** User trust. If Store A costs $50 (but has 1 missing item) and Store B costs $60 (complete), and the algorithm ranks Store A *lower* (due to penalty), the user sees "$50 vs $60" and wonders why the cheaper one is ranked worse.
- **Suggested Specification:**
  - **API:** Return `SortingTotal` for debug/logic, but `RealTotal` for display.
  - **UX Rule:** Always display `RealTotal`. If a store has missing items, UI must explicitly state: "Ranked lower due to X missing items".
  - **Sorting:** The "Coverage-First Ranking" (lines 385-419) mitigates this, but the tie-breaking within a coverage bin using `SortingTotal` still needs UI explanation if the visible price order seems violated.

### 3. "Nearest Stores" Selection Algorithm

- **Missing:** Line 136 mentions `o.getNearestStores(ctx, req.Location, 5)`. It doesn't specify *how* these are efficiently selected from the cache. The `storeLocations` map (line 25) is in memory. Iterating all stores to calculate Haversine for every request is O(N) per request.
- **Why it matters:** Performance. With 1000s of stores, full scans per request are costly.
- **Suggested Specification:**
  - For N < 5000 stores, a linear scan is acceptable (as noted in line 971).
  - **Optimization:** If `MaxDistance` is provided (e.g. 50km), pre-filter stores by a simple "bounding box" (lat/lon +/- delta) before calculating exact Haversine distance, to avoid expensive trig math on obvious outliers.

### 4. `ChainCacheSnapshot` Lifecycle & Memory

- **Missing:** The "Snapshot Swap Pattern" (line 227) replaces the entire pointer. It doesn't specify if the *old* snapshot is explicitly nilled out or how GC is handled for potentially massive maps being discarded frequently during ingestion.
- **Why it matters:** Memory spikes. If a chain reloads every 5 minutes and the old snapshot lingers, OOM kills could occur.
- **Suggested Specification:**
  - Go's GC handles this, but large map cleanup can be slow.
  - **Constraint:** Ensure `ChainCache` reload interval (TTL) is significantly larger than GC cycle time.
  - **Monitoring:** Add metric `optimizer_snapshot_memory_bytes` to track heap usage of the active snapshot.

### 5. `MultiStoreResult` "Unassigned Items" Logic

- **Missing:** The greedy algorithm (line 928) assigns items to stores. Line 941 mentions "remaining items go to unassignedItems". It doesn't specify if the algorithm should *try* to assign these "unassigned" items to a store that *has* them but wasn't chosen for the main basket (e.g., to a store already in the allocation, or a new store if maxStores isn't reached).
- **Why it matters:** Users expect to buy everything if possible. If an item exists in Store C, but Store C wasn't "cheap enough" to win a slot, leaving the item unassigned is suboptimal if `maxStores` constraint allows adding Store C.
- **Suggested Specification:**
  - **Post-pass:** After the main greedy loop, if `unassignedItems > 0` and `allocation.length < maxStores`:
    - Find the store that covers the most *unassigned* items. Add it to allocation. Repeat until maxStores reached or no coverage found.

---

## Phase 7: Product Matching

### 1. `EmbeddingProvider` Interface & Configuration

- **Missing:** `services/price-service/internal/matching/embedding.go` is listed as a file to create (line 1129), but its interface definition is missing from the plan. Specifically, how it handles rate limits (OpenAI 429s) and retries.
- **Why it matters:** OpenAI API is flaky. Without robust retry/backoff in the *provider*, the batch processing (line 632) will fail entire batches, stalling the pipeline.
- **Suggested Specification:**
  - Interface: `GenerateEmbeddingBatch(ctx, texts) ([]float32, error)`
  - **Requirement:** Implementation MUST include exponential backoff (up to 5 attempts) on 429/5xx errors *inside* the provider method.

### 2. `isGenericBrand` List Maintenance

- **Missing:** Line 519 defines a hardcoded list `generic := []string{"n/a", "nepoznato", ...}`. This list is static.
- **Why it matters:** Data quality. As new generic terms appear (e.g., "rinfuza", "no brand"), code changes are required.
- **Suggested Specification:**
  - Move this list to a config file or a database table `brand_aliases` with type `generic`.
  - **Fallback:** Keep the hardcoded list as a default, but append from DB/Config at startup.

### 3. `getTrgmCandidates` Threshold Configuration

- **Missing:** Line 751 uses a hardcoded `> 0.1` similarity threshold.
- **Why it matters:** Recall vs. Performance. 0.1 might be too loose (returning garbage) or too strict. This needs to be tunable without recompiling.
- **Suggested Specification:**
  - Add `TrgmSimilarityThreshold` to `AIMatcherConfig` (line 554).
  - Default to `0.1` but allow override.

### 4. "Suspicious Barcode" Resolution Workflow

- **Missing:** The plan flags items as "suspicious" (line 422) and queues them. It does *not* specify how an admin resolves this queue. Does approving a suspicious item force-create a product? Does it link to an existing one? The `approveMatch` RPC (line 949) seems designed for "pending matches" (link candidates), not "suspicious barcode" flags.
- **Why it matters:** Operational dead end. Admins will see "suspicious" items but have no UI/API to say "This is actually valid, create the product" or "This is junk, ignore it".
- **Suggested Specification:**
  - **New Status:** `product_match_queue.status` should include `suspicious`.
  - **Admin Action:**
    - `resolveSuspicious`: Input `{ queueId, action: 'force_create' | 'ignore' | 'link_to_existing' }`.
    - If `force_create`: Create product, link item, add exception to `canonical_barcodes` to prevent future flagging.

### 5. `storeCandidateMatch` Pruning/Cleanup

- **Missing:** The system stores top-N candidates *per run* (line 669 mentions `MatchingRunID`). It doesn't specify when old candidates are deleted.
- **Why it matters:** Database bloat. If we run matching daily for 100k items × 5 candidates, the table grows by 500k rows/day.
- **Suggested Specification:**
  - **Retention Policy:** Keep only the latest `MatchingRunID` per item.
  - **Cleanup Job:** After a successful run, delete `product_match_candidates` where `matching_run_id != current_run_id`.

### 6. `product_match_audit` Retention

- **Missing:** No retention policy for audit logs.
- **Why it matters:** Infinite growth of `product_match_audit` table.
- **Suggested Specification:**
  - **Policy:** Retain for 90 days.
  - **Mechanism:** Cron job `DELETE FROM product_match_audit WHERE created_at < NOW() - INTERVAL '90 days'`.

