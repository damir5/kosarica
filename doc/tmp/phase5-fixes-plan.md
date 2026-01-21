# Phase 5: Basket Optimization - Fix Plan

## Current Status

**Package:** `services/price-service/internal/optimizer/`

**Test Status:** FAILS TO BUILD

**Issues Summary:**

| Issue | File | Line | Error |
|-------|------|------|-------|
| `TimeNow` undefined | `multi.go` | 36 | `undefined: TimeNow` |
| `TimeSince` undefined | `multi.go` | 40 | `undefined: TimeSince` |
| `RecordCandidateCount` signature | `multi.go` | 58 | Missing `string` argument |
| Mock missing `IsHealthy` | `multi_test.go` | 20, 120, 173... | Interface not implemented |
| `RecordOptimization` method | `multi.go` | 41 | Should be `RecordOptimizationDuration` |

---

## Detailed Analysis

### 1. Missing Time Helper Functions (`multi.go:36, 40`)

**Error:**
```
multi.go:36:15: undefined: TimeNow
multi.go:40:15: undefined: TimeSince
```

**Current Code:**
```go
func (o *MultiStoreOptimizer) Optimize(ctx context.Context, req *OptimizeRequest) (*MultiStoreResult, error) {
    startTime := TimeNow()  // <-- undefined
    // ...
    duration := TimeSince(startTime).Seconds()  // <-- undefined
}
```

**Fix:** These should use standard `time` package:
```go
startTime := time.Now()
duration := time.Since(startTime).Seconds()
```

---

### 2. Metrics Method Signature Mismatch (`multi.go:58`)

**Error:**
```
multi.go:58:33: not enough arguments in call to o.metrics.RecordCandidateCount
    have (int)
    want (string, int)
```

**Current Code:**
```go
o.metrics.RecordCandidateCount(len(candidates))
```

**Expected signature (from `metrics.go:153`):**
```go
func (m *MetricsRecorder) RecordCandidateCount(optType string, count int)
```

**Fix:** Add the `optType` argument:
```go
o.metrics.RecordCandidateCount("multi_store", len(candidates))
```

---

### 3. Wrong Metrics Method Name (`multi.go:41`)

**Current Code:**
```go
o.metrics.RecordOptimization("multi_store_"+algorithmUsed, duration, duration >= 1.0)
```

**Issue:** The method `RecordOptimization` exists but doesn't match the intended signature. Looking at metrics.go:
- `RecordOptimization(optType string, durationSeconds float64, success bool)` - line 135
- `RecordOptimizationDuration(optType string, duration time.Duration)` - line 130

**Fix:** Use the correct method that matches the call pattern:
```go
o.metrics.RecordOptimization("multi_store_"+algorithmUsed, duration, duration >= 1.0)
```

This one is actually correct! The error might be from something else. Let me verify...

Actually, looking at the defer - it's calling a method that takes 3 args, and `RecordOptimization` does take 3 args. This should work. The actual issue might be the method name or something else. Let me verify by looking at what's available.

---

### 4. Mock Missing `IsHealthy` Method

**PriceSource Interface (from `interfaces.go:48-50`):**
```go
type PriceSource interface {
    GetPrice(chainSlug string, storeID, itemID string) (CachedPrice, bool)
    GetAveragePrice(chainSlug string, itemID string) int64
    GetNearestStores(chainSlug string, lat, lon, maxDistanceKm float64, limit int) []StoreWithDistance
    GetStoreIDs(chainSlug string) []string
    IsHealthy(ctx context.Context) bool  // <-- MISSING IN MOCK
}
```

**Current Mock (from `single_test.go:11-57`):**
```go
type mockPriceSource struct {
    prices         map[string]map[string]map[string]CachedPrice
    averagePrices  map[string]map[string]int64
    storeLocations map[string]map[string]Location
}

func (m *mockPriceSource) GetPrice(chainSlug string, storeID, itemID string) (CachedPrice, bool) { ... }
func (m *mockPriceSource) GetAveragePrice(chainSlug string, itemID string) int64 { ... }
func (m *mockPriceSource) GetStoreIDs(chainSlug string) []string { ... }
func (m *mockPriceSource) GetNearestStores(chainSlug string, lat, lon, maxDistanceKm float64, limit int) []StoreWithDistance { ... }
// NO IsHealthy method!
```

**Fix:** Add the missing method to mock:
```go
func (m *mockPriceSource) IsHealthy(ctx context.Context) bool {
    return true // Mock is always healthy
}
```

---

## Implementation Plan

### Step 1: Fix `multi.go` Time Functions

**File:** `services/price-service/internal/optimizer/multi.go`

**Changes:**
- Line 36: Change `startTime := TimeNow()` to `startTime := time.Now()`
- Line 40: Change `duration := TimeSince(startTime).Seconds()` to `duration := time.Since(startTime).Seconds()`

### Step 2: Fix `multi.go` Metrics Call

**File:** `services/price-service/internal/optimizer/multi.go`

**Changes:**
- Line 58: Change `o.metrics.RecordCandidateCount(len(candidates))` to `o.metrics.RecordCandidateCount("multi_store", len(candidates))`

### Step 3: Fix Mock `IsHealthy` Method

**File:** `services/price-service/internal/optimizer/single_test.go`

**Changes:**
- Add `IsHealthy` method to `mockPriceSource` after `GetNearestStores`:
  ```go
  func (m *mockPriceSource) IsHealthy(ctx context.Context) bool {
      return true
  }
  ```

### Step 4: Verify and Run Tests

**Commands:**
```bash
cd /workspace
go test ./services/price-service/internal/optimizer/... -v
```

---

## Additional Verification Needed

After fixes, verify:
1. All optimizer tests pass
2. No other missing interface implementations
3. Coverage is adequate (>80% for core logic)

---

## Files to Modify

| File | Changes |
|------|---------|
| `services/price-service/internal/optimizer/multi.go` | Fix `TimeNow`, `TimeSince`, `RecordCandidateCount` |
| `services/price-service/internal/optimizer/single_test.go` | Add `IsHealthy` to `mockPriceSource` |

---

## Success Criteria

- [ ] `go build ./services/price-service/internal/optimizer/...` succeeds
- [ ] `go test ./services/price-service/internal/optimizer/...` passes all tests
- [ ] No interface implementation errors
- [ ] Coverage > 80%

---

## Follow-up Work (Not Part of This Fix)

After these fixes, consider:
1. Adding benchmark tests for optimization algorithms
2. Adding fuzzing tests for edge cases
3. Integration tests with real cache implementation
