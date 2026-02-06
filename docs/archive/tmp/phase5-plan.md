# Phase 5: Basket Optimization - Implementation Plan

## Overview

Implement basket optimization algorithms that find the cheapest store(s) for a user's shopping basket. The system will use an in-memory price cache for fast lookups and support both single-store and multi-store optimization strategies.

---

## Current State Analysis

### What Exists
- Price groups with content-addressable storage (50%+ deduplication)
- `store_group_history` for temporal store-to-group mappings
- `group_prices` table with prices per group
- `store_price_exceptions` for rare overrides
- `GetCurrentPriceForStore()` function for single item lookup
- No application-level caching (relies on PostgreSQL)

### What's Missing
- In-memory price cache for fast basket calculations
- Optimization algorithms (single/multi-store)
- API endpoints for optimization
- Node.js oRPC proxy routes

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend                                  │
│  User selects basket items → calls optimize endpoint             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Node.js (oRPC Gateway)                        │
│  POST /api/basket/optimize/single                                │
│  POST /api/basket/optimize/multi                                 │
│  → proxies to Go internal API                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Go Price Service                              │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │               In-Memory Price Cache                       │   │
│  │  map[storeID]map[itemID]Price                            │   │
│  │  • Refreshed after each ingestion run                    │   │
│  │  • Lazy load on first request per chain                  │   │
│  │  • TTL-based invalidation (1 hour)                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Optimization Engine                          │   │
│  │                                                           │   │
│  │  SingleStoreOptimizer:                                   │   │
│  │  • For each store: sum(basket item prices)               │   │
│  │  • Return store with lowest total                        │   │
│  │  • Handle missing items (penalty or skip)                │   │
│  │                                                           │   │
│  │  MultiStoreOptimizer:                                    │   │
│  │  • Greedy: pick cheapest store per item                  │   │
│  │  • Optimal: minimize total + travel cost                 │   │
│  │  • Constrained: max N stores                             │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Components

### 1. In-Memory Price Cache

**File:** `services/price-service/internal/optimizer/cache.go`

```go
type PriceCache struct {
    mu         sync.RWMutex
    // map[chainSlug]map[storeID]map[itemID]*CachedPrice
    prices     map[string]map[int64]map[int64]*CachedPrice
    loadedAt   map[string]time.Time  // per-chain load time
    ttl        time.Duration          // default 1 hour
    db         *database.DB
}

type CachedPrice struct {
    Price         int   // cents
    DiscountPrice *int  // nil if no discount
    IsException   bool  // from store_price_exceptions
}

// Core methods
func (c *PriceCache) GetPrice(chainSlug string, storeID, itemID int64) (*CachedPrice, bool)
func (c *PriceCache) GetStorePrices(chainSlug string, storeID int64) map[int64]*CachedPrice
func (c *PriceCache) LoadChain(ctx context.Context, chainSlug string) error
func (c *PriceCache) InvalidateChain(chainSlug string)
func (c *PriceCache) RefreshIfStale(ctx context.Context, chainSlug string) error
```

**Loading Strategy:**
1. Query all current store-group mappings for chain
2. Load all group_prices for those groups
3. Load all active store_price_exceptions
4. Merge into single map with exceptions taking priority
5. Store in memory with timestamp

**Refresh Triggers:**
- After ingestion run completes (explicit invalidation)
- TTL expiration (lazy refresh on next request)
- Manual API call for admin operations

### 2. Single-Store Optimizer

**File:** `services/price-service/internal/optimizer/single.go`

```go
type SingleStoreOptimizer struct {
    cache *PriceCache
    db    *database.DB
}

type OptimizeRequest struct {
    BasketItems []BasketItem   // items to optimize
    Location    *Location      // optional user location
    ChainFilter []string       // optional: only these chains
    MaxDistance float64        // optional: km radius
}

type BasketItem struct {
    ItemID   int64
    Quantity int
}

type Location struct {
    Lat float64
    Lon float64
}

type SingleStoreResult struct {
    StoreID      int64
    StoreName    string
    ChainSlug    string
    TotalPrice   int              // cents
    ItemPrices   []ItemPriceInfo  // breakdown per item
    Distance     *float64         // km, if location provided
    MissingItems []int64          // items not available
    Savings      int              // vs average price
}

func (o *SingleStoreOptimizer) Optimize(ctx context.Context, req OptimizeRequest) ([]SingleStoreResult, error)
```

**Algorithm:**
1. Get list of active stores (filtered by chain/distance if specified)
2. For each store:
   - Look up price for each basket item from cache
   - Calculate total (price × quantity)
   - Track missing items
3. Sort stores by total price (ascending)
4. Return top N results with breakdown

**Missing Item Handling:**
- Option A: Skip store if any item missing
- Option B: Include store with missing items flagged
- Option C: Apply penalty price for missing items

### 3. Multi-Store Optimizer

**File:** `services/price-service/internal/optimizer/multi.go`

```go
type MultiStoreOptimizer struct {
    cache  *PriceCache
    db     *database.DB
    config MultiStoreConfig
}

type MultiStoreConfig struct {
    MaxStores       int     // default 3
    TravelCostPerKm int     // cents per km
    MinSavingsRatio float64 // minimum savings to justify extra store
}

type MultiStoreResult struct {
    TotalPrice    int
    TotalDistance float64
    Stores        []StoreAllocation
    Savings       int  // vs best single store
}

type StoreAllocation struct {
    StoreID    int64
    StoreName  string
    ChainSlug  string
    Items      []ItemAllocation
    Subtotal   int
    Distance   float64
}

type ItemAllocation struct {
    ItemID   int64
    ItemName string
    Quantity int
    Price    int
}

func (o *MultiStoreOptimizer) Optimize(ctx context.Context, req OptimizeRequest) (*MultiStoreResult, error)
```

**Algorithms:**

#### Greedy Algorithm (Fast, O(n×m))
```
1. For each item, find cheapest store
2. Group items by their cheapest store
3. If stores > maxStores:
   a. Merge smallest allocations into nearest store
   b. Repeat until stores <= maxStores
4. Calculate total with travel costs
```

#### Optimal Algorithm (Slower, for small baskets)
```
1. Generate all valid store combinations (≤ maxStores)
2. For each combination:
   a. Assign each item to cheapest store in combination
   b. Calculate total + travel costs
3. Return minimum cost combination
```

#### Hybrid Approach (Recommended)
```
if basket.size <= 10 && stores.count <= 50:
    use optimal algorithm
else:
    use greedy with local optimization
```

### 4. API Handlers

**File:** `services/price-service/internal/handlers/optimize.go`

```go
// POST /internal/optimize/single
func (h *Handler) OptimizeSingle(w http.ResponseWriter, r *http.Request) {
    var req OptimizeRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "invalid request", http.StatusBadRequest)
        return
    }

    results, err := h.singleOptimizer.Optimize(r.Context(), req)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    json.NewEncoder(w).Encode(results)
}

// POST /internal/optimize/multi
func (h *Handler) OptimizeMulti(w http.ResponseWriter, r *http.Request)
```

**Router updates:**
```go
r.Route("/internal/optimize", func(r chi.Router) {
    r.Post("/single", h.OptimizeSingle)
    r.Post("/multi", h.OptimizeMulti)
})
```

### 5. Node.js oRPC Proxy

**File:** `src/orpc/router/basket.ts`

```typescript
import { z } from 'zod';
import { publicProcedure, router } from '../base';

const basketItemSchema = z.object({
  itemId: z.number(),
  quantity: z.number().min(1).default(1),
});

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
}).optional();

const optimizeRequestSchema = z.object({
  basketItems: z.array(basketItemSchema).min(1).max(100),
  location: locationSchema,
  chainFilter: z.array(z.string()).optional(),
  maxDistance: z.number().positive().optional(),
});

export const basketRouter = router({
  optimizeSingle: publicProcedure
    .input(optimizeRequestSchema)
    .mutation(async ({ input }) => {
      const res = await fetch('http://localhost:3003/internal/optimize/single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`Optimization failed: ${res.status}`);
      return res.json();
    }),

  optimizeMulti: publicProcedure
    .input(optimizeRequestSchema.extend({
      maxStores: z.number().min(2).max(5).default(3),
    }))
    .mutation(async ({ input }) => {
      const res = await fetch('http://localhost:3003/internal/optimize/multi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`Optimization failed: ${res.status}`);
      return res.json();
    }),
});
```

---

## Data Flow

### Single-Store Optimization
```
1. User Request: {items: [{itemId: 123, qty: 2}, ...], location: {lat, lon}}
2. Node.js validates input → proxies to Go
3. Go loads/refreshes cache for relevant chains
4. For each active store:
   - Lookup each item price from cache (O(1))
   - Calculate total
5. Sort by total, return top 10
6. Node.js returns to frontend
```

### Multi-Store Optimization
```
1. User Request: {items: [...], location: {...}, maxStores: 3}
2. Node.js validates → proxies to Go
3. Go loads cache
4. Run greedy/optimal algorithm
5. Return allocation with breakdown
6. Node.js returns to frontend
```

---

## Database Queries for Cache Loading

```sql
-- Get all current store-group mappings for a chain
SELECT sgh.store_id, sgh.price_group_id
FROM store_group_history sgh
JOIN stores s ON s.id = sgh.store_id
WHERE s.chain_slug = $1
  AND sgh.valid_to IS NULL
  AND s.status = 'approved';

-- Get all prices for those groups (batch)
SELECT price_group_id, retailer_item_id, price, discount_price
FROM group_prices
WHERE price_group_id = ANY($1);

-- Get active exceptions for chain's stores
SELECT spe.store_id, spe.retailer_item_id, spe.price, spe.discount_price
FROM store_price_exceptions spe
JOIN stores s ON s.id = spe.store_id
WHERE s.chain_slug = $1
  AND spe.expires_at > NOW();
```

---

## Performance Considerations

### Memory Usage
- ~100 bytes per price entry
- 50,000 items × 500 stores = 25M entries = ~2.5GB worst case
- With price groups: ~500K entries = ~50MB (realistic)

### Cache Strategy
- Lazy loading per chain (first request triggers load)
- TTL of 1 hour (configurable)
- Explicit invalidation after ingestion
- Graceful degradation to DB queries if cache unavailable

### Optimization Complexity
| Algorithm | Basket Size | Stores | Complexity |
|-----------|-------------|--------|------------|
| Single-store | N items | M stores | O(N×M) |
| Multi greedy | N items | M stores | O(N×M + M log M) |
| Multi optimal | N items | M stores, K max | O(C(M,K) × N) |

### Recommended Limits
- Max basket size: 100 items
- Max stores considered: 500
- Max multi-store optimal: 5 stores
- Cache TTL: 1 hour (balance freshness vs DB load)

---

## Files to Create/Modify

### Create
| File | Purpose |
|------|---------|
| `services/price-service/internal/optimizer/cache.go` | In-memory price cache |
| `services/price-service/internal/optimizer/single.go` | Single-store optimizer |
| `services/price-service/internal/optimizer/multi.go` | Multi-store optimizer |
| `services/price-service/internal/optimizer/types.go` | Shared types |
| `services/price-service/internal/handlers/optimize.go` | HTTP handlers |
| `src/orpc/router/basket.ts` | Node.js oRPC routes |

### Modify
| File | Changes |
|------|---------|
| `services/price-service/cmd/server/main.go` | Initialize optimizer, register routes |
| `services/price-service/internal/pipeline/persist.go` | Invalidate cache after ingestion |
| `src/orpc/router/index.ts` | Add basket router |

---

## Testing Strategy

### Unit Tests
- Cache loading and invalidation
- Price lookup with exceptions
- Single-store algorithm correctness
- Multi-store greedy algorithm
- Multi-store optimal algorithm

### Integration Tests
- Full optimization flow with real DB
- Cache refresh after ingestion
- Edge cases: empty basket, no stores, all items missing

### Performance Tests
- Cache load time for 50K items
- Single-store optimization with 100 items, 500 stores
- Multi-store optimization benchmarks

### Test Cases
```go
func TestSingleStoreOptimizer(t *testing.T) {
    // Setup: 3 stores with different prices
    // Store A: item1=100, item2=200 → total=300
    // Store B: item1=150, item2=150 → total=300
    // Store C: item1=120, item2=170 → total=290
    // Expected: Store C wins (cheapest total)
}

func TestMultiStoreGreedy(t *testing.T) {
    // Setup: 3 stores, 3 items
    // Store A: item1=100, item2=200, item3=300
    // Store B: item1=150, item2=100, item3=350
    // Store C: item1=200, item2=250, item3=200
    // Greedy picks: A→item1, B→item2, C→item3
    // Total: 100+100+200 = 400 (vs single store minimum 600)
}

func TestMissingItems(t *testing.T) {
    // Store A has items 1,2 but not 3
    // Store B has all items
    // Verify missing items flagged correctly
}
```

---

## Rollout Plan

### Step 1: Cache Implementation
1. Create cache.go with core data structures
2. Implement LoadChain with DB queries
3. Add TTL-based invalidation
4. Unit tests for cache operations

### Step 2: Single-Store Optimizer
1. Implement basic algorithm
2. Add missing item handling
3. Add distance filtering
4. Integration tests

### Step 3: Multi-Store Optimizer
1. Implement greedy algorithm
2. Add travel cost calculation
3. Implement max stores constraint
4. Performance benchmarks

### Step 4: API Integration
1. Add handlers to Go service
2. Create oRPC routes in Node.js
3. End-to-end tests

### Step 5: Production Hardening
1. Add metrics/logging
2. Configure cache size limits
3. Add circuit breaker for cache loading
4. Documentation

---

## Open Questions for Review

1. **Missing Item Strategy**: Skip store, flag items, or apply penalty?
2. **Travel Cost Model**: Simple distance-based or time-based?
3. **Cache Size Limits**: Should we cap memory usage?
4. **Concurrent Cache Loads**: Lock per chain or global?
5. **Discount Price Handling**: Use discount if available, or configurable?
6. **Distance Calculation**: Haversine formula or external service?

---

## Success Criteria

- [ ] Single-store optimization returns correct cheapest store
- [ ] Multi-store optimization reduces total vs single store
- [ ] Cache loads in <5s for 50K items
- [ ] Optimization completes in <100ms for typical basket
- [ ] Memory usage <100MB per chain in cache
- [ ] Integration tests pass
- [ ] Frontend can call optimization endpoints
