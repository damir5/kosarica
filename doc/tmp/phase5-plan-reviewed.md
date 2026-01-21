# Phase 5: Basket Optimization - Implementation Plan (Reviewed)

## AI Review Summary

### Reviewers
- **Gemini 3 Pro**: Architecture & algorithm focus
- **Grok Code Fast**: Concurrency & production hardening
- **Gemini 3 Flash**: API design & testing
- **GPT-5.2**: Deep concurrency & correctness analysis

---

## Critical Issues Identified

### 1. 🔴 Cache Architecture Flaw (Gemini Pro)
**Problem:** Proposed `map[storeID]map[itemID]Price` defeats price group deduplication. If 300 stores share the same "National Price Group", prices stored 300x in RAM.

**Fix:** Mirror database structure:
```go
type PriceCache struct {
    mu              sync.RWMutex
    groupPrices     map[int]map[int64]CachedPrice  // groupID -> itemID -> price
    storeToGroup    map[int64]int                   // storeID -> current groupID
    exceptions      map[int64]map[int64]CachedPrice // storeID -> itemID -> exception
    storeLocations  map[int64]Location              // cache geolocations
    loadedAt        map[string]time.Time
    chainGroups     map[string][]int                // chainSlug -> groupIDs
}

// Lookup: check exceptions first, then resolve via group
func (c *PriceCache) GetPrice(storeID, itemID int64) (CachedPrice, bool) {
    // 1. Check exceptions
    if exc, ok := c.exceptions[storeID][itemID]; ok {
        return exc, true
    }
    // 2. Get group for store
    groupID, ok := c.storeToGroup[storeID]
    if !ok {
        return CachedPrice{}, false
    }
    // 3. Get price from group
    price, ok := c.groupPrices[groupID][itemID]
    return price, ok
}
```

### 2. 🔴 Lazy Loading Latency Spike (Gemini Pro)
**Problem:** First user waits 2-5s for massive SQL query.

**Fix:** Active warm-up strategy:
```go
func (c *PriceCache) StartWarmup(ctx context.Context) {
    // Load all active chains on startup
    chains := c.db.GetActiveChains(ctx)
    for _, chain := range chains {
        go c.LoadChain(ctx, chain.Slug)
    }
}

// Called after ingestion completes
func (c *PriceCache) OnIngestionComplete(chainSlug string) {
    go c.RefreshChain(context.Background(), chainSlug)
}
```

### 3. 🔴 Lock Contention (Both models)
**Problem:** Single mutex blocks all requests during chain refresh.

**Fix:** Per-chain sharding with singleflight:
```go
type PriceCache struct {
    chains  map[string]*ChainCache
    sf      singleflight.Group  // prevents thundering herd
}

type ChainCache struct {
    mu           sync.RWMutex
    groupPrices  map[int]map[int64]CachedPrice
    storeToGroup map[int64]int
    exceptions   map[int64]map[int64]CachedPrice
    loadedAt     time.Time
}

func (c *PriceCache) LoadChain(ctx context.Context, chainSlug string) error {
    // singleflight ensures only one load per chain
    _, err, _ := c.sf.Do(chainSlug, func() (interface{}, error) {
        return nil, c.doLoadChain(ctx, chainSlug)
    })
    return err
}
```

### 4. 🟡 Missing Item Strategy (Gemini Pro)
**Problem:** Plan leaves this as "open question" but it's critical for UX.

**Decision:** Use **penalty approach** for sorting, with **flag display** for UX:
```go
type OptimizeResult struct {
    StoreID       int64
    SortingTotal  int              // includes penalties for sorting
    RealTotal     int              // actual purchasable total
    MissingItems  []MissingItem    // flagged for display
    CoverageRatio float64          // e.g., 0.95 = 95% items available
}

type MissingItem struct {
    ItemID      int64
    ItemName    string
    PenaltyUsed int  // what was used for sorting
}

const MissingItemPenalty = 2.0 // 2x average market price
```

### 5. 🟡 Optimal Algorithm Danger (Gemini Pro)
**Problem:** `C(500, 3) = 20M combinations` without filtering.

**Fix:** Pre-filter candidates:
```go
func (o *MultiStoreOptimizer) Optimize(ctx context.Context, req OptimizeRequest) (*MultiStoreResult, error) {
    // NEVER run optimal on full store set
    candidates := o.selectCandidates(ctx, req)  // max 20 stores

    if len(req.BasketItems) <= 10 && len(candidates) <= 15 {
        return o.optimalAlgorithm(ctx, req, candidates)
    }
    return o.greedyAlgorithm(ctx, req, candidates)
}

func (o *MultiStoreOptimizer) selectCandidates(ctx context.Context, req OptimizeRequest) []Store {
    // Get top 10 cheapest single-store results
    singleResults := o.singleOptimizer.Optimize(ctx, req)[:10]

    // Add top 5 nearest stores (if location provided)
    if req.Location != nil {
        nearest := o.getNearestStores(ctx, req.Location, 5)
        // Merge and dedupe
    }

    return dedupe(candidates) // max ~15 stores
}
```

### 6. 🟡 GC Pressure (Both models)
**Problem:** Using `*CachedPrice` creates millions of small heap allocations.

**Fix:** Use value types:
```go
// Before (bad)
type CachedPrice struct {
    Price         int
    DiscountPrice *int  // pointer = heap allocation
    IsException   bool
}

// After (good)
type CachedPrice struct {
    Price         int
    DiscountPrice int   // use 0 or -1 as sentinel for "no discount"
    HasDiscount   bool  // explicit flag
    IsException   bool
}
```

### 7. 🟡 API Design Issues (Gemini Flash)
**Problem:** Using raw `fetch`, inconsistent with codebase patterns.

**Fix:** Use existing utilities:
```typescript
// src/orpc/router/basket.ts
import { goFetch } from '@/lib/go-service-client';

export const basketRouter = router({
  optimizeSingle: procedure
    .input(optimizeRequestSchema)
    .mutation(async ({ input }) => {
      return goFetch<SingleStoreResult[]>('/internal/basket/optimize/single', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    }),
});
```

### 8. 🟡 Testing Gaps (Gemini Flash)
**Missing tests:**
- Thundering herd scenarios (100 concurrent requests, empty cache)
- Haversine edge cases (poles, 0km distance, date line crossing)
- Stress baskets (100 items × 500 stores)
- Context cancellation mid-optimization

---

## GPT-5.2 Deep Review Findings

### 9. 🔴 Top-Level Map Synchronization (GPT-5.2)
**Problem:** `PriceCache.chains map[string]*ChainCache` has no synchronization. Concurrent `LoadChain`, warmup, and request reads can race.

**Fix:** Use `sync.Map` or explicit mutex:
```go
type PriceCache struct {
    chainsMu sync.RWMutex
    chains   map[string]*ChainCache
    sf       singleflight.Group
}

func (c *PriceCache) getOrCreateChain(slug string) *ChainCache {
    c.chainsMu.RLock()
    if cc, ok := c.chains[slug]; ok {
        c.chainsMu.RUnlock()
        return cc
    }
    c.chainsMu.RUnlock()

    c.chainsMu.Lock()
    defer c.chainsMu.Unlock()
    // Double-check after acquiring write lock
    if cc, ok := c.chains[slug]; ok {
        return cc
    }
    cc := &ChainCache{}
    c.chains[slug] = cc
    return cc
}
```

### 10. 🔴 Snapshot Swap Pattern (GPT-5.2)
**Problem:** Building maps while holding lock causes multi-second request stalls.

**Fix:** Build off-lock, swap under lock (or use `atomic.Value`):
```go
func (c *PriceCache) doLoadChain(ctx context.Context, chainSlug string) error {
    // 1. Build new snapshot WITHOUT holding lock
    newSnapshot := &ChainCacheSnapshot{
        groupPrices:  make(map[int]map[int64]CachedPrice),
        storeToGroup: make(map[int64]int),
        exceptions:   make(map[int64]map[int64]CachedPrice),
        locations:    make(map[int64]Location),
    }

    // Load from DB (slow, but no lock held)
    if err := c.loadFromDB(ctx, chainSlug, newSnapshot); err != nil {
        return err
    }

    // 2. Swap pointer under SHORT lock
    cc := c.getOrCreateChain(chainSlug)
    cc.mu.Lock()
    cc.snapshot = newSnapshot  // atomic pointer swap
    cc.loadedAt = time.Now()
    cc.mu.Unlock()

    return nil
}

// Alternative: use atomic.Value for lock-free reads
type ChainCache struct {
    snapshot atomic.Value  // *ChainCacheSnapshot
    loadedAt atomic.Value  // time.Time
}
```

### 11. 🔴 Nil-Map Panic Risk (GPT-5.2)
**Problem:** `c.exceptions[storeID][itemID]` panics if inner map is nil.

**Fix:** Safe access pattern:
```go
func (c *PriceCache) GetPrice(storeID, itemID int64) (CachedPrice, bool) {
    cc := c.getChain(chainSlug)
    if cc == nil {
        return CachedPrice{}, false
    }

    cc.mu.RLock()
    defer cc.mu.RUnlock()

    // Safe nil check for nested maps
    if excForStore, ok := cc.exceptions[storeID]; ok {
        if exc, ok := excForStore[itemID]; ok {
            return exc, true
        }
    }

    groupID, ok := cc.storeToGroup[storeID]
    if !ok {
        return CachedPrice{}, false
    }

    pricesForGroup, ok := cc.groupPrices[groupID]
    if !ok {
        return CachedPrice{}, false
    }

    price, ok := pricesForGroup[itemID]
    return price, ok
}
```

### 12. 🟡 Singleflight Context Issue (GPT-5.2)
**Problem:** If first caller's context is canceled, load fails for everyone.

**Fix:** Use dedicated load context with timeout:
```go
func (c *PriceCache) LoadChain(ctx context.Context, chainSlug string) error {
    _, err, _ := c.sf.Do(chainSlug, func() (interface{}, error) {
        // Use dedicated context, NOT request context
        loadCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()
        return nil, c.doLoadChain(loadCtx, chainSlug)
    })
    return err
}
```

### 13. 🟡 Warmup Concurrency Limit (GPT-5.2)
**Problem:** `StartWarmup` spawns unbounded goroutines, can spike DB at startup.

**Fix:** Use semaphore:
```go
func (c *PriceCache) StartWarmup(ctx context.Context) {
    chains := c.db.GetActiveChains(ctx)
    sem := make(chan struct{}, 3)  // max 3 concurrent loads

    var wg sync.WaitGroup
    for _, chain := range chains {
        wg.Add(1)
        go func(slug string) {
            defer wg.Done()
            sem <- struct{}{}        // acquire
            defer func() { <-sem }() // release

            if err := c.LoadChain(ctx, slug); err != nil {
                log.Error("warmup failed", "chain", slug, "error", err)
            }
        }(chain.Slug)
    }
    wg.Wait()
}
```

### 14. 🟡 Penalty Definition Underspecified (GPT-5.2)
**Problem:** "2x average market price" - average of what? Per-item? Per-chain? Computed when?

**Fix:** Use pre-computed chain-wide average, cached:
```go
type ChainCacheSnapshot struct {
    // ... existing fields
    itemAveragePrice map[int64]int64  // itemID -> avg price across all stores in chain
}

// Computed during cache load
func (c *PriceCache) computeAverages(snapshot *ChainCacheSnapshot) {
    itemPrices := make(map[int64][]int64)  // itemID -> all prices

    for _, prices := range snapshot.groupPrices {
        for itemID, p := range prices {
            effectivePrice := p.Price
            if p.HasDiscount {
                effectivePrice = p.DiscountPrice
            }
            itemPrices[itemID] = append(itemPrices[itemID], int64(effectivePrice))
        }
    }

    for itemID, prices := range itemPrices {
        sum := int64(0)
        for _, p := range prices {
            sum += p
        }
        snapshot.itemAveragePrice[itemID] = sum / int64(len(prices))
    }
}

const MissingItemPenaltyMultiplier = 2.0

func (o *Optimizer) getPenalty(chainSlug string, itemID int64) int64 {
    avg := o.cache.GetAveragePrice(chainSlug, itemID)
    if avg == 0 {
        return 10000  // fallback: 100 currency units
    }
    return int64(float64(avg) * MissingItemPenaltyMultiplier)
}
```

### 15. 🟡 Coverage-First Ranking (GPT-5.2)
**Problem:** Penalty alone can mis-rank (cheap store missing 30% items may still "win").

**Fix:** Two-tier ranking:
```go
type OptimizeResult struct {
    StoreID       int64
    CoverageRatio float64  // PRIMARY sort key
    SortingTotal  int64    // SECONDARY sort key
    RealTotal     int64    // display only
    MissingItems  []MissingItem
}

func sortResults(results []OptimizeResult) {
    sort.Slice(results, func(i, j int) bool {
        // Coverage bins: 1.0, 0.9+, 0.8+, <0.8
        binI := coverageBin(results[i].CoverageRatio)
        binJ := coverageBin(results[j].CoverageRatio)
        if binI != binJ {
            return binI > binJ  // higher coverage first
        }
        return results[i].SortingTotal < results[j].SortingTotal
    })
}

func coverageBin(ratio float64) int {
    switch {
    case ratio >= 1.0: return 4
    case ratio >= 0.9: return 3
    case ratio >= 0.8: return 2
    default: return 1
    }
}
```

### 16. 🟡 Use int64 for Money (GPT-5.2)
**Problem:** `int` totals can overflow with large baskets + penalties.

**Fix:** Use `int64` everywhere for money:
```go
type CachedPrice struct {
    Price         int64  // cents, NOT int
    DiscountPrice int64
    HasDiscount   bool
    IsException   bool
}

type OptimizeResult struct {
    SortingTotal  int64  // cents
    RealTotal     int64  // cents
    // ...
}
```

### 17. 🟡 DB Snapshot Consistency (GPT-5.2)
**Problem:** Loading `groupPrices` and `storeToGroup` from separate queries can produce impossible states (store points to group not in cache).

**Fix:** Use single transaction or versioned load:
```go
func (c *PriceCache) loadFromDB(ctx context.Context, chainSlug string, snapshot *ChainCacheSnapshot) error {
    tx, err := c.db.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
    if err != nil {
        return err
    }
    defer tx.Rollback(ctx)

    // All queries in same transaction = consistent snapshot
    if err := c.loadStoreGroups(ctx, tx, chainSlug, snapshot); err != nil {
        return err
    }
    if err := c.loadGroupPrices(ctx, tx, chainSlug, snapshot); err != nil {
        return err
    }
    if err := c.loadExceptions(ctx, tx, chainSlug, snapshot); err != nil {
        return err
    }
    if err := c.loadLocations(ctx, tx, chainSlug, snapshot); err != nil {
        return err
    }

    return tx.Commit(ctx)
}
```

### 18. 🟡 Optimal Algorithm Time Budget (GPT-5.2)
**Problem:** Even with candidate filtering, optimal can exceed time budget.

**Fix:** Hard deadline with fallback:
```go
func (o *MultiStoreOptimizer) Optimize(ctx context.Context, req OptimizeRequest) (*MultiStoreResult, error) {
    candidates := o.selectCandidates(ctx, req)

    if len(req.BasketItems) <= 10 && len(candidates) <= 15 {
        // Try optimal with 100ms budget
        optCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
        defer cancel()

        result, err := o.optimalAlgorithm(optCtx, req, candidates)
        if err == nil {
            return result, nil
        }
        if err != context.DeadlineExceeded {
            return nil, err
        }
        // Fallback to greedy if optimal times out
        log.Warn("optimal timed out, falling back to greedy")
    }

    return o.greedyAlgorithm(ctx, req, candidates)
}
```

---

## Must-Specify Invariants (GPT-5.2)

These invariants MUST be documented and tested:

| Invariant | Enforcement |
|-----------|-------------|
| All map accesses check for nil | Code review + linter |
| Snapshot built off-lock, swapped under lock | Unit test timing |
| singleflight uses dedicated context (not request) | Code review |
| Money values are int64, never int | Type definitions |
| Coverage ratio >= 0.8 required for top results | Ranking tests |
| DB load uses single transaction | Integration test |
| Optimal algorithm has hard time budget | Timeout test |
| Warmup limited to N concurrent loads | Startup test |

---

## Revised Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Go Price Service                              │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           PriceCache (Group-Aware)                        │   │
│  │                                                           │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │   │
│  │  │ ChainCache  │  │ ChainCache  │  │ ChainCache  │       │   │
│  │  │   (dm)      │  │  (konzum)   │  │   (lidl)    │       │   │
│  │  │  mu RWMutex │  │  mu RWMutex │  │  mu RWMutex │       │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘       │   │
│  │                                                           │   │
│  │  groupPrices:   map[groupID]map[itemID]Price             │   │
│  │  storeToGroup:  map[storeID]groupID                      │   │
│  │  exceptions:    map[storeID]map[itemID]Price             │   │
│  │  storeLocations: map[storeID]Location                    │   │
│  │                                                           │   │
│  │  Features:                                                │   │
│  │  ✓ Warm-up on startup                                    │   │
│  │  ✓ Refresh after ingestion                               │   │
│  │  ✓ singleflight for thundering herd                      │   │
│  │  ✓ Per-chain locks                                       │   │
│  │  ✓ Graceful fallback to DB                               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Optimization Engine                          │   │
│  │                                                           │   │
│  │  PriceSource interface (decoupled from cache impl)       │   │
│  │                                                           │   │
│  │  SingleStoreOptimizer:                                   │   │
│  │  • Penalty-based missing item handling                   │   │
│  │  • Coverage ratio calculation                            │   │
│  │  • Context cancellation support                          │   │
│  │                                                           │   │
│  │  MultiStoreOptimizer:                                    │   │
│  │  • Pre-filtered candidates (max 15-20 stores)            │   │
│  │  • Hybrid greedy/optimal based on size                   │   │
│  │  • Goroutine limits for CPU-bound work                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Revised Files to Create

### Go Files

| File | Purpose |
|------|---------|
| `internal/optimizer/interfaces.go` | `PriceSource` interface for decoupling |
| `internal/optimizer/cache.go` | Group-aware cache with sharding |
| `internal/optimizer/single.go` | Single-store optimizer with penalties |
| `internal/optimizer/multi.go` | Multi-store with candidate filtering |
| `internal/optimizer/types.go` | Shared types (value types, no pointers) |
| `internal/optimizer/metrics.go` | Prometheus metrics |
| `internal/handlers/optimize.go` | HTTP handlers with validation |

### Node.js Files

| File | Purpose |
|------|---------|
| `src/orpc/router/basket.ts` | oRPC routes using `goFetch` |

---

## Revised Implementation Order

### Step 1: Cache Foundation (Critical Fixes)
1. Create `interfaces.go` with `PriceSource` interface
2. Create `types.go` with **int64 money types** (not int)
3. Create `cache.go` with:
   - Group-aware structure (`groupPrices` + `storeToGroup`)
   - `sync.RWMutex` for top-level `chains` map
   - Per-chain `ChainCache` with `atomic.Value` for snapshot
   - **Snapshot swap pattern** (build off-lock, swap under lock)
   - **Safe nil-map access** throughout
4. Implement `singleflight` with **dedicated load context** (not request ctx)
5. Add **semaphore-limited warmup** (max 3 concurrent)
6. Use **single DB transaction** for consistent snapshot
7. Compute **item average prices** during load (for penalty calc)
8. Add Prometheus metrics
9. **Tests:**
   - Thundering herd (100 concurrent, only 1 DB hit)
   - Context cancellation doesn't fail other callers
   - Nil-map safety (missing store, missing group)
   - Snapshot swap timing (no multi-second locks)

### Step 2: Single-Store Optimizer
1. Implement optimizer using `PriceSource` interface
2. Add **coverage-first ranking** (binned by 1.0/0.9/0.8/<0.8)
3. Add penalty calculation using cached averages
4. Separate `SortingTotal` vs `RealTotal` in results
5. Add context cancellation support
6. **Tests:**
   - Correctness (cheapest store wins within coverage bin)
   - Missing items flagged correctly
   - Penalty uses chain average, not magic constant
   - High-coverage stores rank above cheap-but-incomplete

### Step 3: Multi-Store Optimizer
1. Implement candidate selection:
   - Top 10 cheapest single-store (filtered by coverage >= 0.8)
   - Top 5 nearest stores (if location provided)
2. Implement greedy algorithm
3. Implement optimal algorithm with **hard 100ms timeout**
4. **Automatic fallback** to greedy on timeout
5. Multi-store coverage = combined items / total items
6. Add goroutine limits for CPU-bound work
7. **Tests:**
   - Greedy vs optimal correctness
   - Timeout triggers fallback
   - Combined coverage calculation
   - Performance within bounds

### Step 4: API Integration
1. Add Go handlers with input validation:
   - Basket size limits (1-100 items)
   - Quantity > 0
   - Lat/Lon ranges
2. Wire cache refresh to ingestion pipeline
3. Create Node.js oRPC routes with `goFetch`
4. **Tests:**
   - E2E happy path
   - Validation error responses
   - 503 when cache unavailable

### Step 5: Production Hardening
1. Add circuit breaker for cache failures
2. Add structured logging with request IDs
3. Add feature flags for multi-store disable
4. Add health check for cache freshness
5. Add graceful degradation: block requests until warmup done (no DB thundering herd)
6. Document scaling considerations (Redis/distributed cache for multi-instance)

---

## Resolved Questions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Missing items | **Coverage-first ranking** + penalty for secondary sort | Prevents cheap-but-incomplete stores from winning |
| Penalty value | 2x **chain-wide item average** (precomputed) | Stable, fast, semantically meaningful |
| Travel cost | Simple Haversine | External APIs add latency; start simple |
| Cache limits | TTL-based with singleflight | 50-100MB is acceptable; avoid LRU complexity |
| Concurrent loads | Per-chain mutex + singleflight + **dedicated context** | Prevents thundering herd, context isolation |
| Discount handling | Value type with `HasDiscount` bool | Avoids GC pressure from pointers |
| Distance calc | Cache store locations, Haversine in-memory | Avoid DB hits per optimization |
| Money types | **int64 everywhere** | Prevents overflow with penalties + large baskets |
| Map safety | **Explicit nil checks** on all nested map access | Prevents runtime panics |
| DB consistency | **Single read-only transaction** for cache load | Prevents impossible group/store states |
| Optimal timeout | **100ms hard budget** with greedy fallback | Guarantees response time SLA |
| Warmup strategy | **Block requests until warm** OR 503 | Prevents DB thundering herd on cold start |

---

## Success Criteria (Updated)

### Correctness
- [ ] Cache mirrors group structure (not exploded per-store)
- [ ] All money values use int64 (no int overflow possible)
- [ ] No nil-map panics (fuzz test with missing data)
- [ ] DB load uses single transaction (consistency verified)
- [ ] Coverage-first ranking: 100% coverage store beats cheaper 80% coverage

### Performance
- [ ] Warm-up completes within 30s of startup
- [ ] Single-store optimization <50ms for 50 items, 500 stores
- [ ] Multi-store optimization <200ms with candidate filtering
- [ ] Optimal algorithm times out + falls back within 150ms total
- [ ] Memory usage <100MB per chain (with group deduplication)
- [ ] Snapshot swap holds lock <10ms (not seconds)

### Resilience
- [ ] Thundering herd test: only 1 DB load per chain (singleflight)
- [ ] Context cancellation doesn't fail other callers (dedicated load ctx)
- [ ] 100 concurrent requests don't exceed 500ms p99
- [ ] Graceful 503 when cache unavailable (not slow DB fallback)
- [ ] Warmup semaphore limits concurrent DB loads to 3

### Observability
- [ ] Prometheus metrics exposed (hits, misses, duration, basket size)
- [ ] Structured logging with chain + request context
- [ ] Health endpoint reports cache freshness per chain

---

## Monitoring Requirements

```go
var (
    cacheHits = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "optimizer_cache_hits_total",
    }, []string{"chain"})

    cacheMisses = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "optimizer_cache_misses_total",
    }, []string{"chain"})

    cacheLoadDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "optimizer_cache_load_duration_seconds",
        Buckets: []float64{0.1, 0.5, 1, 2, 5, 10},
    }, []string{"chain"})

    optimizationDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "optimizer_calculation_duration_seconds",
        Buckets: []float64{0.01, 0.05, 0.1, 0.2, 0.5, 1},
    }, []string{"type"}) // "single" or "multi"

    basketSize = promauto.NewHistogram(prometheus.HistogramOpts{
        Name:    "optimizer_basket_items_count",
        Buckets: []float64{5, 10, 20, 50, 100},
    })
)
```

---

## Pre-Implementation Specifications (GPT-5.2 + Gemini Analysis)

### 1. Configuration Constants

```go
// services/price-service/internal/optimizer/config.go

type OptimizerConfig struct {
    // Cache settings
    CacheLoadTimeout      time.Duration `default:"30s"`   // Max time for single chain load
    CacheTTL              time.Duration `default:"1h"`    // Stale threshold
    CacheRefreshJitter    time.Duration `default:"5m"`    // Random jitter to prevent thundering herd
    WarmupConcurrency     int           `default:"3"`     // Max concurrent chain loads at startup

    // Candidate selection
    TopCheapestStores     int           `default:"10"`    // Single-store results to consider
    TopNearestStores      int           `default:"5"`     // Nearest stores to add (if location)
    MaxCandidates         int           `default:"20"`    // Hard cap after merge+dedupe
    MaxDistanceKm         float64       `default:"50.0"`  // Ignore stores beyond this

    // Algorithm settings
    OptimalTimeoutMs      int           `default:"100"`   // Hard deadline for optimal algo
    MaxBasketItems        int           `default:"100"`   // Reject larger baskets
    MinBasketItems        int           `default:"1"`     // Reject empty baskets

    // Pricing
    MissingItemPenaltyMult float64      `default:"2.0"`   // Multiplier on chain average
    MissingItemFallback    int64        `default:"10000"` // 100.00 if no average available

    // Coverage bins (descending order)
    CoverageBins          []float64     `default:"[1.0, 0.9, 0.8]"` // Ranking thresholds
}
```

**Rationale:**
- `CacheLoadTimeout=30s`: Balances completeness vs startup latency
- `WarmupConcurrency=3`: Prevents DB connection exhaustion (typical pool is 10-20)
- `MissingItemPenaltyMult=2.0`: Makes missing items expensive but not catastrophic
- `CoverageBins`: Business decision - 80% availability is minimum acceptable

### 2. API Request/Response Schemas

```go
// Request schema
type OptimizeRequest struct {
    BasketItems []BasketItem `json:"basketItems" validate:"required,min=1,max=100"`
    Location    *Location    `json:"location,omitempty"`
    ChainFilter []string     `json:"chainFilter,omitempty"`  // Empty = all chains
    MaxDistance *float64     `json:"maxDistance,omitempty"`  // km, requires location
    MaxStores   int          `json:"maxStores,omitempty" validate:"omitempty,min=2,max=5"` // multi only
}

type BasketItem struct {
    ItemID   int64 `json:"itemId" validate:"required,gt=0"`
    Quantity int   `json:"quantity" validate:"required,gt=0,lte=100"`
}

type Location struct {
    Lat float64 `json:"lat" validate:"required,gte=-90,lte=90"`
    Lon float64 `json:"lon" validate:"required,gte=-180,lte=180"`
}

// Response schema - Single Store
type SingleStoreResult struct {
    StoreID       int64          `json:"storeId"`
    StoreName     string         `json:"storeName"`
    ChainSlug     string         `json:"chainSlug"`
    Address       string         `json:"address,omitempty"`

    CoverageRatio float64        `json:"coverageRatio"`   // 0.0-1.0
    CoverageBin   int            `json:"coverageBin"`     // 4=100%, 3=90%+, 2=80%+, 1=<80%

    SortingTotal  int64          `json:"sortingTotal"`    // cents, includes penalties
    RealTotal     int64          `json:"realTotal"`       // cents, actual purchasable

    Distance      *float64       `json:"distance,omitempty"` // km, if location provided

    ItemPrices    []ItemPriceInfo `json:"itemPrices"`
    MissingItems  []MissingItem   `json:"missingItems"`
}

type ItemPriceInfo struct {
    ItemID        int64  `json:"itemId"`
    ItemName      string `json:"itemName"`
    Quantity      int    `json:"quantity"`
    UnitPrice     int64  `json:"unitPrice"`      // cents
    LineTotal     int64  `json:"lineTotal"`      // cents (unitPrice * quantity)
    HasDiscount   bool   `json:"hasDiscount"`
    DiscountPrice *int64 `json:"discountPrice,omitempty"` // cents, if discounted
}

type MissingItem struct {
    ItemID      int64  `json:"itemId"`
    ItemName    string `json:"itemName"`
    Quantity    int    `json:"quantity"`
    PenaltyUsed int64  `json:"penaltyUsed"`  // cents, for transparency
}

// Response schema - Multi Store
type MultiStoreResult struct {
    TotalCost       int64             `json:"totalCost"`       // cents, sum of allocations
    CombinedCoverage float64          `json:"combinedCoverage"` // 0.0-1.0
    StoreCount      int               `json:"storeCount"`
    Allocations     []StoreAllocation `json:"allocations"`
    UnassignedItems []MissingItem     `json:"unassignedItems"` // items no store has
}

type StoreAllocation struct {
    StoreID     int64           `json:"storeId"`
    StoreName   string          `json:"storeName"`
    ChainSlug   string          `json:"chainSlug"`
    Subtotal    int64           `json:"subtotal"`    // cents
    Distance    *float64        `json:"distance,omitempty"`
    Items       []ItemPriceInfo `json:"items"`
}

// Error response
type ErrorResponse struct {
    Code      string            `json:"code"`      // e.g., "VALIDATION_ERROR", "CACHE_UNAVAILABLE"
    Message   string            `json:"message"`   // Human-readable
    Details   map[string]string `json:"details,omitempty"` // Field-specific errors
    RequestID string            `json:"requestId,omitempty"`
}
```

**HTTP Status Codes:**
| Code | Condition |
|------|-----------|
| 200 | Success |
| 400 | Validation error (bad basket, invalid location) |
| 404 | Chain not found (if chainFilter specified) |
| 503 | Cache unavailable, warmup in progress |
| 504 | Optimization timeout |

### 3. Cache State Machine

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    ▼                                         │
              ┌──────────┐                                    │
     startup  │  EMPTY   │                                    │
        │     └────┬─────┘                                    │
        │          │ LoadChain()                              │
        ▼          ▼                                          │
   ┌──────────┐  ┌──────────┐     success    ┌──────────┐    │
   │ WARMING  │──│ LOADING  │ ─────────────► │  READY   │────┘
   └──────────┘  └────┬─────┘                └────┬─────┘   TTL expired
                      │ error                     │         + request
                      ▼                           │
                ┌──────────┐                      │ OnIngestionComplete()
                │  FAILED  │                      │ or TTL expired
                └────┬─────┘                      ▼
                     │ retry (backoff)      ┌──────────────┐
                     └────────────────────► │  REFRESHING  │
                                            │ (serve stale)│
                                            └──────┬───────┘
                                                   │ success
                                                   ▼
                                              ┌──────────┐
                                              │  READY   │
                                              └──────────┘
```

**Request Behavior by State:**

| State | Request Behavior |
|-------|------------------|
| EMPTY | Block until READY (warmup) or return 503 after timeout |
| LOADING | Block until READY or return 503 after timeout |
| READY | Serve from cache |
| REFRESHING | Serve stale snapshot (no blocking) |
| FAILED | Return 503, trigger retry |

### 4. Error Handling Matrix

| Error | Handler | User Response |
|-------|---------|---------------|
| DB timeout during load | Log, increment metric, retry with backoff | 503 if no stale snapshot |
| Store→Group missing | Log warn, skip store in results | Reduced results (ok) |
| Group→Prices missing | Log error, treat as no prices for group | Reduced results (ok) |
| Nil map access | **Must not happen** (code invariant) | N/A |
| Division by zero (avg) | Return fallback penalty (10000) | Transparent in response |
| Optimal timeout | Fallback to greedy, log warn | Greedy results returned |
| Context canceled | Return partial results or error | Depends on progress |
| oRPC upstream error | Map to client error code | Structured ErrorResponse |

### 5. Algorithm Specifications

#### Greedy Multi-Store Algorithm
```
Input: basket[], candidates[], maxStores
Output: allocation[]

1. Initialize: remaining = basket.copy(), allocation = []
2. While remaining.notEmpty() AND allocation.length < maxStores:
   a. For each store in candidates:
      - score = sum(price[item] for item in remaining if store.has(item))
      - itemsCovered = count(remaining if store.has(item))
   b. Select store with best (itemsCovered / score) ratio
   c. Assign covered items to store, remove from remaining
   d. Add to allocation
3. Return allocation (remaining items go to unassignedItems)
```

#### Optimal Multi-Store Algorithm
```
Input: basket[], candidates[], maxStores, timeout=100ms
Output: allocation[] or timeout_error

1. If |candidates| > 15 OR |basket| > 10: return timeout_error (force greedy)
2. Generate all combinations C(candidates, 1..maxStores)
3. For each combination (with timeout check):
   a. Assign each item to cheapest store in combination
   b. Calculate total cost
4. Return combination with minimum cost
5. On timeout: return partial best or timeout_error
```

#### Distance Calculation (Haversine)
```go
func HaversineKm(lat1, lon1, lat2, lon2 float64) float64 {
    const R = 6371.0 // Earth radius km
    dLat := toRad(lat2 - lat1)
    dLon := toRad(lon2 - lon1)
    a := math.Sin(dLat/2)*math.Sin(dLat/2) +
         math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*
         math.Sin(dLon/2)*math.Sin(dLon/2)
    c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
    return R * c
}
```
**Note:** Linear scan of storeLocations is acceptable for <1000 stores. For larger scale, consider PostGIS or R-tree.

#### Candidate Deduplication
```go
func dedupeCandidates(cheapest, nearest []Store) []Store {
    seen := make(map[int64]bool)
    result := make([]Store, 0, len(cheapest)+len(nearest))

    // Cheapest first (priority)
    for _, s := range cheapest {
        if !seen[s.ID] {
            seen[s.ID] = true
            result = append(result, s)
        }
    }
    // Then nearest
    for _, s := range nearest {
        if !seen[s.ID] {
            seen[s.ID] = true
            result = append(result, s)
        }
    }
    return result
}
```

### 6. Price Resolution Rules

```go
// Effective price calculation
func GetEffectivePrice(p CachedPrice) int64 {
    if p.HasDiscount && p.DiscountPrice > 0 && p.DiscountPrice < p.Price {
        return p.DiscountPrice
    }
    return p.Price
}
```

**Rules:**
1. If `HasDiscount=true` AND `DiscountPrice > 0` AND `DiscountPrice < Price`: use DiscountPrice
2. Otherwise: use Price
3. Invalid discount (discount >= price): log warning, use Price
4. Missing price: treat as missing item (apply penalty)

### 7. Tie-Breaking Rules

When stores have same coverage bin AND same SortingTotal:

1. **Primary:** Lower distance (if location provided)
2. **Secondary:** Alphabetical by chain slug
3. **Tertiary:** Lower store ID (deterministic)

```go
func compareResults(a, b SingleStoreResult) int {
    // Coverage bin (higher is better)
    if a.CoverageBin != b.CoverageBin {
        return b.CoverageBin - a.CoverageBin
    }
    // Sorting total (lower is better)
    if a.SortingTotal != b.SortingTotal {
        return int(a.SortingTotal - b.SortingTotal)
    }
    // Distance (lower is better, nil = infinity)
    distA, distB := math.MaxFloat64, math.MaxFloat64
    if a.Distance != nil { distA = *a.Distance }
    if b.Distance != nil { distB = *b.Distance }
    if distA != distB {
        if distA < distB { return -1 }
        return 1
    }
    // Chain slug alphabetical
    if a.ChainSlug != b.ChainSlug {
        return strings.Compare(a.ChainSlug, b.ChainSlug)
    }
    // Store ID (deterministic fallback)
    return int(a.StoreID - b.StoreID)
}
```

### 8. TTL and Refresh Behavior

```
Timeline:
────────────────────────────────────────────────────────────►
│                    │                    │
│ Load complete      │ TTL (1h)           │ Stale threshold (1h + jitter)
│ t=0                │ t=1h               │ t=1h+5m
│                    │                    │
│ State: READY       │ State: READY       │ On next request: trigger
│ Serve: fresh       │ Serve: fresh       │ async refresh, serve stale
```

**Refresh Triggers:**
1. `OnIngestionComplete(chainSlug)` → immediate async refresh
2. Request after TTL + jitter → lazy async refresh (serve stale)
3. Manual admin trigger → immediate async refresh

**Singleflight Behavior:**
- All refresh triggers go through singleflight
- First trigger wins, others wait for result
- Uses dedicated context (30s timeout), not request context
