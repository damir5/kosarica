# Gap Specifications: Phase 5 & Phase 7

This document specifies the previously undefined areas identified by Gemini Pro analysis.

---

## Phase 5: Basket Optimization - Gap Resolutions

### 1. Effective Price Logic (API Response)

**Gap:** Ambiguity between `UnitPrice` and `DiscountPrice` in `ItemPriceInfo`.

**Specification:**

```go
// services/price-service/internal/optimizer/types.go

type ItemPriceInfo struct {
    ItemID        int64  `json:"itemId"`
    ItemName      string `json:"itemName"`
    Quantity      int    `json:"quantity"`

    // BasePrice: Always the list/regular price (cents)
    BasePrice     int64  `json:"basePrice"`

    // EffectivePrice: The price actually charged (cents)
    // = DiscountPrice if HasDiscount=true, else BasePrice
    EffectivePrice int64 `json:"effectivePrice"`

    // HasDiscount: True if item is currently discounted
    HasDiscount   bool   `json:"hasDiscount"`

    // DiscountPrice: Only set if HasDiscount=true (cents)
    DiscountPrice *int64 `json:"discountPrice,omitempty"`

    // LineTotal: EffectivePrice * Quantity (cents)
    LineTotal     int64  `json:"lineTotal"`
}

// INVARIANT: For any SingleStoreResult:
//   RealTotal == sum(item.LineTotal for item in ItemPrices)
//   RealTotal <= SortingTotal (penalties only inflate SortingTotal)
```

**Frontend Rule:** Always display `EffectivePrice`. Show strikethrough `BasePrice` only if `HasDiscount=true`.

---

### 2. Missing Item UX Display

**Gap:** How to explain ranking when visible prices don't match order.

**Specification:**

```typescript
// Frontend display rules

interface StoreDisplayInfo {
  storeId: number;
  storeName: string;

  // DISPLAY to user
  displayTotal: number;      // = RealTotal (what they'll actually pay)

  // EXPLAIN if ranking seems wrong
  hasMissingItems: boolean;
  missingItemCount: number;
  coveragePercent: number;   // = CoverageRatio * 100

  // RANKING info (for explanation)
  rankingNote: string | null;
}

function getRankingNote(result: SingleStoreResult, rank: number, allResults: SingleStoreResult[]): string | null {
  if (rank === 0) return null;  // Top result needs no explanation

  const prevResult = allResults[rank - 1];

  // Case: Lower price but ranked worse due to missing items
  if (result.realTotal < prevResult.realTotal && result.coverageRatio < prevResult.coverageRatio) {
    const missingCount = result.missingItems.length;
    return `Ranked lower due to ${missingCount} missing item${missingCount > 1 ? 's' : ''}`;
  }

  return null;
}

// UI Component
function StoreCard({ result, rank, allResults }: Props) {
  const note = getRankingNote(result, rank, allResults);

  return (
    <div className="store-card">
      <h3>{result.storeName}</h3>
      <div className="price">{formatPrice(result.realTotal)}</div>

      {result.missingItems.length > 0 && (
        <div className="warning">
          ⚠️ {result.missingItems.length} items unavailable
          <ul>
            {result.missingItems.map(item => (
              <li key={item.itemId}>{item.itemName}</li>
            ))}
          </ul>
        </div>
      )}

      {note && <div className="ranking-note">{note}</div>}
    </div>
  );
}
```

---

### 3. Nearest Stores Selection Algorithm

**Gap:** Efficient selection without O(N) full scan.

**Specification:**

```go
// services/price-service/internal/optimizer/geo.go

// GetNearestStores returns up to `limit` nearest stores within maxDistanceKm
// Uses bounding box pre-filter for efficiency
func (c *PriceCache) GetNearestStores(
    chainSlug string,
    lat, lon float64,
    maxDistanceKm float64,
    limit int,
) []StoreWithDistance {
    cc := c.getChain(chainSlug)
    if cc == nil {
        return nil
    }

    // 1. Calculate bounding box (rough pre-filter)
    // 1 degree latitude ≈ 111 km
    // 1 degree longitude ≈ 111 km * cos(lat)
    latDelta := maxDistanceKm / 111.0
    lonDelta := maxDistanceKm / (111.0 * math.Cos(lat*math.Pi/180))

    minLat, maxLat := lat-latDelta, lat+latDelta
    minLon, maxLon := lon-lonDelta, lon+lonDelta

    // 2. Pre-filter by bounding box (cheap comparison)
    var candidates []storeDistance

    cc.mu.RLock()
    for storeID, loc := range cc.snapshot.storeLocations {
        if loc.Lat < minLat || loc.Lat > maxLat ||
           loc.Lon < minLon || loc.Lon > maxLon {
            continue // Outside bounding box
        }

        // 3. Calculate exact Haversine distance (expensive)
        dist := HaversineKm(lat, lon, loc.Lat, loc.Lon)
        if dist <= maxDistanceKm {
            candidates = append(candidates, storeDistance{
                storeID:  storeID,
                distance: dist,
            })
        }
    }
    cc.mu.RUnlock()

    // 4. Sort by distance and take top `limit`
    sort.Slice(candidates, func(i, j int) bool {
        return candidates[i].distance < candidates[j].distance
    })

    if len(candidates) > limit {
        candidates = candidates[:limit]
    }

    return candidates
}

type storeDistance struct {
    storeID  int64
    distance float64
}

// Performance characteristics:
// - Bounding box filters ~90% of stores in typical cases
// - Only ~10% require expensive Haversine calculation
// - For N=5000 stores, ~500 Haversine calls (acceptable)
```

---

### 4. Cache Snapshot Memory Management

**Gap:** GC behavior for large discarded snapshots.

**Specification:**

```go
// services/price-service/internal/optimizer/cache.go

// Memory monitoring
var (
    snapshotMemoryBytes = promauto.NewGaugeVec(prometheus.GaugeOpts{
        Name: "optimizer_snapshot_memory_bytes",
        Help: "Estimated memory usage of cache snapshots",
    }, []string{"chain"})
)

// Snapshot with size tracking
type ChainCacheSnapshot struct {
    // ... existing fields ...

    // estimatedSizeBytes calculated during construction
    estimatedSizeBytes int64
}

func (s *ChainCacheSnapshot) EstimateSize() int64 {
    var size int64

    // groupPrices: ~32 bytes per entry
    for _, prices := range s.groupPrices {
        size += int64(len(prices)) * 32
    }

    // storeToGroup: ~16 bytes per entry
    size += int64(len(s.storeToGroup)) * 16

    // exceptions: ~40 bytes per entry
    for _, exc := range s.exceptions {
        size += int64(len(exc)) * 40
    }

    // storeLocations: ~24 bytes per entry
    size += int64(len(s.storeLocations)) * 24

    return size
}

func (c *PriceCache) doLoadChain(ctx context.Context, chainSlug string) error {
    // Build new snapshot
    newSnapshot := &ChainCacheSnapshot{...}
    if err := c.loadFromDB(ctx, chainSlug, newSnapshot); err != nil {
        return err
    }
    newSnapshot.estimatedSizeBytes = newSnapshot.EstimateSize()

    // Get chain cache
    cc := c.getOrCreateChain(chainSlug)

    // Swap pointer (old snapshot becomes garbage)
    cc.mu.Lock()
    oldSnapshot := cc.snapshot
    cc.snapshot = newSnapshot
    cc.loadedAt = time.Now()
    cc.mu.Unlock()

    // Update metrics
    snapshotMemoryBytes.WithLabelValues(chainSlug).Set(float64(newSnapshot.estimatedSizeBytes))

    // Explicit nil assignment helps GC (optional, but clearer intent)
    if oldSnapshot != nil {
        log.Debug("discarding old snapshot",
            "chain", chainSlug,
            "old_size_mb", oldSnapshot.estimatedSizeBytes/1024/1024,
            "new_size_mb", newSnapshot.estimatedSizeBytes/1024/1024)
    }

    return nil
}

// Configuration constraint
const (
    // MinCacheRefreshInterval prevents GC pressure from frequent reloads
    MinCacheRefreshInterval = 5 * time.Minute

    // MaxSnapshotSizeMB triggers warning if exceeded
    MaxSnapshotSizeMB = 500
)
```

---

### 5. Multi-Store Unassigned Items Post-Pass

**Gap:** Greedy algorithm may leave items unassigned even if other stores have them.

**Specification:**

```go
// services/price-service/internal/optimizer/multi.go

func (o *MultiStoreOptimizer) greedyAlgorithm(
    ctx context.Context,
    req OptimizeRequest,
    candidates []Store,
) (*MultiStoreResult, error) {
    remaining := make(map[int64]int) // itemID -> quantity
    for _, item := range req.BasketItems {
        remaining[item.ItemID] = item.Quantity
    }

    allocation := make([]StoreAllocation, 0)

    // Phase 1: Greedy selection for best value
    for len(remaining) > 0 && len(allocation) < req.MaxStores {
        best := o.selectBestStore(ctx, candidates, remaining)
        if best == nil {
            break
        }

        alloc := o.allocateItems(best, remaining)
        allocation = append(allocation, alloc)

        // Remove allocated items from remaining
        for _, item := range alloc.Items {
            remaining[item.ItemID] -= item.Quantity
            if remaining[item.ItemID] <= 0 {
                delete(remaining, item.ItemID)
            }
        }

        // Remove selected store from candidates
        candidates = removeStore(candidates, best.ID)
    }

    // Phase 2: Coverage post-pass for remaining items
    // Try to assign remaining items to stores already in allocation
    // or add new stores if under maxStores limit
    if len(remaining) > 0 {
        allocation = o.coveragePostPass(ctx, allocation, candidates, remaining, req.MaxStores)
    }

    // Items still remaining after post-pass are truly unassigned
    unassigned := make([]MissingItem, 0)
    for itemID, qty := range remaining {
        unassigned = append(unassigned, MissingItem{
            ItemID:   itemID,
            Quantity: qty,
            Reason:   "no_store_has_item",
        })
    }

    return &MultiStoreResult{
        Allocations:     allocation,
        UnassignedItems: unassigned,
        // ...
    }, nil
}

// coveragePostPass tries to assign remaining items
func (o *MultiStoreOptimizer) coveragePostPass(
    ctx context.Context,
    allocation []StoreAllocation,
    candidates []Store,
    remaining map[int64]int,
    maxStores int,
) []StoreAllocation {
    // Step 1: Check if existing allocated stores can cover remaining items
    for i := range allocation {
        store := o.getStoreByID(allocation[i].StoreID)
        if store == nil {
            continue
        }

        for itemID, qty := range remaining {
            price, ok := o.cache.GetPrice(store.ChainSlug, store.ID, itemID)
            if ok {
                // Add to this store's allocation
                allocation[i].Items = append(allocation[i].Items, ItemPriceInfo{
                    ItemID:         itemID,
                    Quantity:       qty,
                    EffectivePrice: price.GetEffective(),
                    // ...
                })
                allocation[i].Subtotal += price.GetEffective() * int64(qty)
                delete(remaining, itemID)
            }
        }
    }

    // Step 2: If still under maxStores, add new stores for remaining items
    for len(remaining) > 0 && len(allocation) < maxStores {
        best := o.findBestCoverageStore(ctx, candidates, remaining)
        if best == nil || best.coverCount == 0 {
            break // No store can cover any remaining items
        }

        alloc := o.allocateItems(best.store, remaining)
        allocation = append(allocation, alloc)

        for _, item := range alloc.Items {
            remaining[item.ItemID] -= item.Quantity
            if remaining[item.ItemID] <= 0 {
                delete(remaining, item.ItemID)
            }
        }

        candidates = removeStore(candidates, best.store.ID)
    }

    return allocation
}
```

---

## Phase 7: Product Matching - Gap Resolutions

### 1. EmbeddingProvider Retry/Backoff

**Gap:** No retry specification for API failures.

**Specification:** See `embedding-benchmarking-spec.md` - `LiteLLMProvider.embedBatchWithRetry()` implements:
- Exponential backoff: 1s, 2s, 4s, 8s, 16s
- Max 5 retries
- Only retry on 429 (rate limit) or 5xx (server errors)

---

### 2. Generic Brand List Management

**Gap:** Hardcoded list of generic brands.

**Specification:**

```go
// services/price-service/internal/matching/config.go

type MatchingConfig struct {
    // ... existing fields ...

    // GenericBrands loaded from DB at startup
    GenericBrands map[string]bool
}

// Load from database
func LoadMatchingConfig(ctx context.Context, db *pgxpool.Pool) (*MatchingConfig, error) {
    cfg := &MatchingConfig{
        GenericBrands: make(map[string]bool),
    }

    // Hardcoded fallback
    defaults := []string{"n/a", "nepoznato", "unknown", "-", "", "bez marke", "no brand"}
    for _, b := range defaults {
        cfg.GenericBrands[strings.ToLower(b)] = true
    }

    // Override/extend from database
    rows, err := db.Query(ctx, `
        SELECT LOWER(name) FROM brand_aliases WHERE alias_type = 'generic'
    `)
    if err != nil {
        log.Warn("failed to load generic brands from DB, using defaults", "error", err)
        return cfg, nil
    }
    defer rows.Close()

    for rows.Next() {
        var name string
        if err := rows.Scan(&name); err != nil {
            continue
        }
        cfg.GenericBrands[name] = true
    }

    return cfg, nil
}

func (cfg *MatchingConfig) IsGenericBrand(brand string) bool {
    return cfg.GenericBrands[strings.ToLower(strings.TrimSpace(brand))]
}
```

**Schema addition:**

```typescript
export const brandAliases = pgTable('brand_aliases', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  aliasType: text('alias_type').notNull(),  // 'generic', 'private_label', 'typo'
  chainId: smallint('chain_id'),  // NULL = all chains
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  nameTypeUniq: uniqueIndex('brand_aliases_name_type_uniq').on(table.name, table.aliasType),
}));
```

---

### 3. Trigram Threshold Configuration

**Gap:** Hardcoded `> 0.1` threshold.

**Specification:**

```go
// Add to AIMatcherConfig
type AIMatcherConfig struct {
    // ... existing fields ...

    // TrgmSimilarityThreshold for pg_trgm pre-filter
    // Lower = more candidates, slower but better recall
    // Higher = fewer candidates, faster but may miss matches
    // Default: 0.1 (very loose, relies on embedding rerank)
    TrgmSimilarityThreshold float32 `default:"0.1"`
}

// Update getTrgmCandidates to use config
func getTrgmCandidates(ctx context.Context, db *pgxpool.Pool,
    text string, limit int, threshold float32) ([]string, error) {

    rows, err := db.Query(ctx, `
        SELECT p.id
        FROM products p
        WHERE similarity(lower(p.name), lower($1)) > $3
        ORDER BY similarity(lower(p.name), lower($1)) DESC
        LIMIT $2
    `, text, limit, threshold)
    // ...
}
```

---

### 4. Suspicious Barcode Resolution Workflow

**Gap:** No admin action for suspicious items.

**Specification:**

```typescript
// src/orpc/router/products.ts

// Add status: 'suspicious' to productMatchQueue allowed values

resolveSuspicious: adminProcedure
  .input(z.object({
    queueId: z.string(),
    action: z.enum(['force_create', 'ignore', 'link_existing']),
    existingProductId: z.string().optional(),  // Required if action='link_existing'
    notes: z.string().optional(),
  }))
  .mutation(async ({ input, ctx }) => {
    return await db.transaction(async (tx) => {
      const [queue] = await tx
        .select()
        .from(productMatchQueue)
        .where(eq(productMatchQueue.id, input.queueId))
        .for('update');

      if (!queue || queue.status !== 'suspicious') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not a suspicious item' });
      }

      const retailerItem = await tx
        .select()
        .from(retailerItems)
        .where(eq(retailerItems.id, queue.retailerItemId))
        .then(rows => rows[0]);

      let productId: string;

      switch (input.action) {
        case 'force_create':
          // Create new product from this item
          const newProduct = await tx.insert(products).values({
            name: retailerItem.name,
            brand: retailerItem.brand,
            category: retailerItem.category,
            // ... other fields
          }).returning({ id: products.id });
          productId = newProduct[0].id;

          // Register barcode (prevent future flagging)
          if (retailerItem.barcode) {
            await tx.insert(canonicalBarcodes).values({
              barcode: retailerItem.barcode,
              productId: productId,
            }).onConflictDoNothing();
          }
          break;

        case 'link_existing':
          if (!input.existingProductId) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'existingProductId required' });
          }
          productId = input.existingProductId;
          break;

        case 'ignore':
          // Mark as rejected, no product link
          await tx.update(productMatchQueue)
            .set({
              status: 'rejected',
              decision: 'ignored_suspicious',
              reviewedBy: ctx.user.id,
              reviewedAt: new Date(),
              reviewNotes: input.notes,
            })
            .where(eq(productMatchQueue.id, input.queueId));

          // Audit
          await tx.insert(productMatchAudit).values({
            queueId: input.queueId,
            action: 'ignored_suspicious',
            userId: ctx.user.id,
            newState: { reason: 'suspicious_barcode_ignored' },
          });

          return { success: true, action: 'ignored' };
      }

      // Create product link
      await tx.insert(productLinks).values({
        productId: productId,
        retailerItemId: queue.retailerItemId,
        matchType: 'manual_suspicious_resolve',
        confidence: 1.0,
      });

      // Update queue
      await tx.update(productMatchQueue)
        .set({
          status: 'approved',
          decision: input.action === 'force_create' ? 'new_product' : 'linked',
          linkedProductId: productId,
          reviewedBy: ctx.user.id,
          reviewedAt: new Date(),
          reviewNotes: input.notes,
        })
        .where(eq(productMatchQueue.id, input.queueId));

      // Audit
      await tx.insert(productMatchAudit).values({
        queueId: input.queueId,
        action: `resolved_suspicious_${input.action}`,
        userId: ctx.user.id,
        newState: { productId, action: input.action },
      });

      return { success: true, productId, action: input.action };
    });
  }),
```

---

### 5. Candidate Pruning/Cleanup

**Gap:** Candidates accumulate across runs.

**Specification:**

```go
// services/price-service/internal/matching/cleanup.go

// CleanupOldCandidates removes candidates from previous runs
// Called after successful matching run completion
func CleanupOldCandidates(ctx context.Context, db *pgxpool.Pool, currentRunID string) error {
    result, err := db.Exec(ctx, `
        DELETE FROM product_match_candidates
        WHERE matching_run_id != $1
        AND matching_run_id IS NOT NULL
        AND retailer_item_id NOT IN (
            -- Keep candidates for items still in queue
            SELECT retailer_item_id FROM product_match_queue WHERE status = 'pending'
        )
    `, currentRunID)

    if err != nil {
        return fmt.Errorf("cleanup candidates: %w", err)
    }

    log.Info("cleaned up old candidates", "deleted", result.RowsAffected())
    return nil
}

// Alternative: Keep only latest N runs worth of candidates
func CleanupOldCandidatesByAge(ctx context.Context, db *pgxpool.Pool, keepDays int) error {
    _, err := db.Exec(ctx, `
        DELETE FROM product_match_candidates
        WHERE created_at < NOW() - INTERVAL '1 day' * $1
        AND retailer_item_id NOT IN (
            SELECT retailer_item_id FROM product_match_queue WHERE status = 'pending'
        )
    `, keepDays)
    return err
}
```

---

### 6. Audit Log Retention

**Gap:** Infinite growth of audit logs.

**Specification:**

```go
// services/price-service/internal/jobs/cleanup_audit.go

// CleanupAuditLogs removes audit entries older than retention period
// Default: 90 days
func CleanupAuditLogs(ctx context.Context, db *pgxpool.Pool, retentionDays int) error {
    result, err := db.Exec(ctx, `
        DELETE FROM product_match_audit
        WHERE created_at < NOW() - INTERVAL '1 day' * $1
    `, retentionDays)

    if err != nil {
        return fmt.Errorf("cleanup audit: %w", err)
    }

    log.Info("cleaned up old audit logs", "deleted", result.RowsAffected())
    return nil
}

// Schedule in cron
func (s *Scheduler) setupCleanupJobs() {
    // Run daily at 3 AM
    s.cron.AddFunc("0 3 * * *", func() {
        ctx := context.Background()

        // Candidates: keep 7 days
        if err := CleanupOldCandidatesByAge(ctx, s.db, 7); err != nil {
            log.Error("candidate cleanup failed", "error", err)
        }

        // Audit logs: keep 90 days
        if err := CleanupAuditLogs(ctx, s.db, 90); err != nil {
            log.Error("audit cleanup failed", "error", err)
        }

        // Expired price exceptions (from phase 4)
        if err := CleanupExpiredExceptions(ctx, s.db); err != nil {
            log.Error("exception cleanup failed", "error", err)
        }
    })
}
```

**Configuration:**

```go
type CleanupConfig struct {
    CandidateRetentionDays int `default:"7"`
    AuditRetentionDays     int `default:"90"`
    ExceptionCleanupBatch  int `default:"1000"`
}
```

---

## Summary of New Files

| File | Purpose |
|------|---------|
| `doc/tmp/embedding-benchmarking-spec.md` | Cross-model embedding system |
| `doc/tmp/phases-5-7-gap-specifications.md` | This file - gap resolutions |
| `services/price-service/internal/matching/embedding/types.go` | Embedding interfaces |
| `services/price-service/internal/matching/embedding/litellm.go` | LiteLLM provider |
| `services/price-service/internal/matching/benchmark/runner.go` | Benchmark execution |
| `services/price-service/internal/matching/config/models.go` | Model registry |
| `services/price-service/internal/jobs/cleanup_audit.go` | Retention jobs |
| `services/price-service/internal/optimizer/geo.go` | Geo filtering |
