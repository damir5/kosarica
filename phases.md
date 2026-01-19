# Testing Plan: Postgres + Golang Price Service Migration

## Overview

This document consolidates the testing strategy for the Kosarica migration from SQLite/TypeScript to Postgres/Golang. Tests are organized by phase and focus on **behavior and outcomes**, not implementation details.

**Current State:**
- Node.js/TypeScript with SQLite + Drizzle ORM
- 11 TypeScript scrapers in `src/ingestion/`
- Vitest test infrastructure (~5,300 lines of existing tests)
- No Go infrastructure exists yet

**Target State:**
- PostgreSQL database (single instance)
- Go service for price ingestion + optimization
- Node.js gateway for frontend/auth
- Immutable price groups for storage efficiency

---

## Global Invariants (Test After Every Phase)

These cross-cutting tests must pass continuously throughout migration.

### Database Invariants

| ID | Invariant | Test Method |
|----|-----------|-------------|
| DB-1 | No duplicate retailer items per chain | `SELECT chain_id, external_id, COUNT(*) FROM retailer_items GROUP BY 1,2 HAVING COUNT(*) > 1` returns 0 rows |
| DB-2 | At most one current price group per store | `SELECT store_id, COUNT(*) FROM store_group_history WHERE valid_to IS NULL GROUP BY 1 HAVING COUNT(*) > 1` returns 0 rows |
| DB-3 | No overlapping store group membership | GiST exclusion constraint prevents insert of overlapping ranges |
| DB-4 | Group immutability | Once created, `price_groups.price_hash` never changes |
| DB-5 | Historical price correctness | Query "price at store X on date Y" returns the price valid on that date |

### Hash & Grouping Invariants (Critical - Failure = Catastrophic)

| ID | Invariant | Test Method |
|----|-----------|-------------|
| HASH-1 | Same prices = same hash = same group | Identical price vectors produce identical SHA256 |
| HASH-2 | Any price difference = different hash | Change 1 cent in 1 item = different hash |
| HASH-3 | Order does not matter | Shuffled input produces same hash |
| HASH-4 | NULL discount == 0 discount | `{item:100, discount:null}` == `{item:100, discount:0}` |
| HASH-5 | Hash stable across runs/machines | Same input on different machines = same output |

### API Invariants

| ID | Invariant | Test Method |
|----|-----------|-------------|
| API-1 | Node.js is only public entrypoint | Direct browser call to Go port fails |
| API-2 | Auth enforced consistently | Unauthenticated requests rejected |
| API-3 | Idempotency | Re-running ingestion doesn't create duplicates |

---

## Phase 1: Port to Postgres

### Objective
Replace SQLite with PostgreSQL. Auth and core app functionality preserved.

### Behavioral Tests

#### E2E: Authentication Flow
```
TEST: User can sign up
  GIVEN: Clean database
  WHEN: User submits signup form
  THEN: User row created in PG `users` table
  AND: Session created
  AND: User redirected to dashboard

TEST: User can log in
  GIVEN: Existing user in database
  WHEN: User submits correct credentials
  THEN: Session created
  AND: Session persists across server restarts

TEST: User can log out
  GIVEN: Logged-in user
  WHEN: User clicks logout
  THEN: Session invalidated
  AND: Protected routes inaccessible
```

#### Data Integrity
```
TEST: All auth tables exist in Postgres
  VERIFY: users, sessions, accounts, verification tables present
  VERIFY: Correct column types (varchar, timestamp with timezone)

TEST: No SQLite remnants
  VERIFY: No `.db` files created in /data
  VERIFY: No better-sqlite3 in node_modules
  VERIFY: Build succeeds without SQLite deps

TEST: Migrations are reproducible
  GIVEN: Fresh Postgres database
  WHEN: drizzle-kit migrate runs
  THEN: Schema matches expected state
```

#### Regression
```
TEST: Existing frontend flows unchanged
  VERIFY: All existing routes load
  VERIFY: No console errors related to database
```

### Verification Commands
```bash
# Tables exist
psql $DATABASE_URL -c "\dt"

# TanStack starts
pnpm dev

# Auth works
# Manual: Complete signup/login flow
```

---

## Phase 2: Go Service + All Scrapers

### Objective
Port all 15 scrapers to Go. Ingestion runs successfully for all chains.

### Behavioral Tests

#### Ingestion Success
```
TEST: All chains ingest successfully
  GIVEN: Go service running
  WHEN: Ingestion triggered for all chains
  THEN: ingestion_runs created per chain
  AND: status transitions: pending → completed
  AND: files_count, items_count populated
  AND: Errors recorded but don't abort run

TEST: Retailer items persisted correctly
  GIVEN: Successful ingestion run
  THEN: retailer_items table populated
  AND: Each item has chain_id, external_id, name
  AND: Unique constraint on (chain_id, external_id) holds

TEST: Stores discovered
  GIVEN: New store in source data
  WHEN: Ingestion runs
  THEN: Store created with status='pending'
  AND: Store NOT visible to users
```

#### Idempotency
```
TEST: Re-ingestion doesn't duplicate items
  GIVEN: Successful ingestion run
  WHEN: Same data ingested again
  THEN: retailer_items count unchanged
  AND: updatedAt timestamps updated
  AND: No duplicate stores

TEST: Re-ingestion doesn't duplicate stores
  VERIFY: SELECT store_id, COUNT(*) FROM stores GROUP BY 1 HAVING COUNT(*) > 1 returns 0
```

#### Partial Failure Resilience
```
TEST: Fetch failure doesn't block other chains
  GIVEN: One scraper configured to fail fetch
  WHEN: RunAll executes
  THEN: Error logged for failed chain
  AND: Other chains complete successfully
  AND: Run marked completed (with errors)

TEST: Parse failure doesn't block other files
  GIVEN: One file in chain has parse error
  WHEN: Chain ingestion runs
  THEN: Error recorded for specific file
  AND: Other files processed
  AND: ingestion_runs.error_count incremented

TEST: File-level isolation
  GIVEN: Multi-file chain
  WHEN: File 2 of 5 fails to parse
  THEN: Files 1,3,4,5 successfully persisted
  AND: Error details include file name
```

#### Per-Scraper Tests (15 scrapers)
```
For each: DM, Lidl, Kaufland, Spar, Interspar, Konzum, Plodine,
          Studenac, Tommy, Eurospin, KTC, Ribola, Metro, Trgocentar, NTL

TEST: {Chain} scraper parses correctly
  GIVEN: Sample data file for {chain}
  WHEN: Parser runs
  THEN: Expected item count extracted
  AND: Prices in cents (integer)
  AND: Required fields populated (external_id, name, price)
```

### Verification Commands
```bash
# Go builds
cd services/price-service && go build ./cmd/server

# Health check
curl localhost:8081/internal/health

# Trigger ingestion
curl -X POST localhost:8081/internal/admin/ingest/dm

# All 15 chains ingest
for chain in dm lidl kaufland spar interspar konzum plodine studenac tommy eurospin ktc ribola metro trgocentar ntl; do
  curl -X POST localhost:8081/internal/admin/ingest/$chain
done

# Verify items
psql $DATABASE_URL -c "SELECT chain_id, COUNT(*) FROM retailer_items GROUP BY 1"
```

---

## Phase 3: Node.js → Go Integration

### Objective
Frontend fetches prices via Node.js proxy to Go. TS ingestion deleted.

### Behavioral Tests

#### E2E: Price Display
```
TEST: Frontend loads prices
  GIVEN: Items in database from Phase 2
  WHEN: User navigates to price page
  THEN: Prices display correctly
  AND: Response comes through Node.js (not direct Go)

TEST: Price data matches database
  GIVEN: Known item with price=1299
  WHEN: Frontend queries price
  THEN: Displayed price = 12.99 kn
```

#### Security
```
TEST: Go service not publicly accessible
  WHEN: curl localhost:8081 from browser
  THEN: Connection refused (internal binding only)

TEST: Go service accessible from Node.js
  WHEN: Node.js calls http://localhost:8081/internal/prices/...
  THEN: Response received successfully
```

#### Contract Tests
```
TEST: Invalid storeId returns 404
  WHEN: GET /api/prices/konzum/99999999
  THEN: 404 Not Found (clean error)

TEST: Invalid chainSlug returns 404
  WHEN: GET /api/prices/invalid-chain/1
  THEN: 404 Not Found

TEST: Malformed request returns 400
  WHEN: GET /api/prices/konzum/abc
  THEN: 400 Bad Request
```

#### Regression
```
TEST: TS ingestion code deleted
  VERIFY: src/ingestion/ directory doesn't exist
  VERIFY: pnpm build succeeds
  VERIFY: No imports from src/ingestion in codebase
```

### Verification Commands
```bash
# Frontend works
pnpm dev
# Navigate to price pages

# No direct Go access from browser
curl http://localhost:8081 # Should fail

# TS ingestion deleted
ls src/ingestion/  # Should not exist
pnpm build  # Should succeed
```

---

## Phase 4: Price Groups (Core Logic)

### Objective
Implement content-addressable price storage. Storage reduced, prices correct.

### Behavioral Tests

#### Group Formation
```
TEST: Stores with identical prices share group
  GIVEN: Store A and Store B with identical price vectors
  WHEN: Group detection runs
  THEN: Both stores point to same price_group_id
  AND: group_prices contains ONE copy of prices

TEST: One item difference creates new group
  GIVEN: Store A with prices [item1:100, item2:200]
  AND: Store B with prices [item1:100, item2:201]  # 1 cent difference
  WHEN: Group detection runs
  THEN: Different price_group_ids assigned
  AND: Different price_hashes in price_groups
```

#### Group Reuse (Critical for Storage)
```
TEST: Same prices on different days reuse group
  GIVEN: Day 1 ingestion creates group G1
  WHEN: Day 2 ingestion has identical prices
  THEN: Same price_group_id reused
  AND: price_groups.last_seen_at updated
  AND: NO new group created

TEST: Conservation of prices
  GIVEN: Store with 100 items ingested
  THEN: group_prices has exactly 100 rows for that group
  AND: No duplicates, no missing items
```

#### Group Change & History
```
TEST: Price change moves store to new group
  GIVEN: Store in group G1 on Day 1
  WHEN: Price changes on Day 2
  THEN: New group G2 created (or existing matched)
  AND: store_group_history shows:
       - (store, G1, Day1, Day2)
       - (store, G2, Day2, NULL)

TEST: Historical query returns correct price
  GIVEN: Store was in G1 on Jan 15, G2 on Jan 20
  WHEN: Query "price on Jan 17"
  THEN: Returns price from G1
  WHEN: Query "price on Jan 25"
  THEN: Returns price from G2
```

#### Hash Invariants (Unit Tests in Go)
```go
func TestHashDeterminism(t *testing.T) {
    prices := []ItemPrice{{1, 1299, ptr(999)}, {2, 500, nil}}

    // Same input 1000x = same hash
    hash1 := ComputePriceHash(prices)
    for i := 0; i < 1000; i++ {
        assert.Equal(t, hash1, ComputePriceHash(prices))
    }
}

func TestHashOrderIndependent(t *testing.T) {
    a := []ItemPrice{{1, 100, nil}, {2, 200, nil}}
    b := []ItemPrice{{2, 200, nil}, {1, 100, nil}}
    assert.Equal(t, ComputePriceHash(a), ComputePriceHash(b))
}

func TestHashNullEqualsZero(t *testing.T) {
    a := []ItemPrice{{1, 100, nil}}
    b := []ItemPrice{{1, 100, ptr(0)}}
    assert.Equal(t, ComputePriceHash(a), ComputePriceHash(b))
}

func TestButterflyEffect(t *testing.T) {
    base := []ItemPrice{{1, 100, nil}, {2, 200, nil}}
    modified := []ItemPrice{{1, 100, nil}, {2, 201, nil}}  // +1 cent
    assert.NotEqual(t, ComputePriceHash(base), ComputePriceHash(modified))
}
```

#### Price Exceptions
```
TEST: Exception overrides group price
  GIVEN: Store in group G1 with item1=100
  AND: Exception for (store, item1, price=90)
  WHEN: Query price for item1 at store
  THEN: Returns 90 (not 100)
  AND: is_exception=true in response

TEST: Expired exception ignored
  GIVEN: Exception with expires_at in past
  WHEN: Query price
  THEN: Returns group price (not exception)

TEST: Cron job cleans expired exceptions
  GIVEN: 100 expired exceptions
  WHEN: Cleanup cron runs
  THEN: Expired exceptions deleted
```

#### Storage Efficiency
```
TEST: Storage reduced vs naive approach
  VERIFY: SELECT COUNT(*) FROM group_prices < SELECT COUNT(*) FROM retailer_items
  TARGET: At least 50% reduction for chains with shared pricing
```

### Verification Commands
```bash
# Groups detected
psql $DATABASE_URL -c "SELECT COUNT(*) FROM price_groups"

# Storage reduction
psql $DATABASE_URL -c "
SELECT
  (SELECT COUNT(*) FROM group_prices) as group_prices,
  (SELECT COUNT(*) FROM retailer_items) as naive_count
"

# Price lookups correct
psql $DATABASE_URL -c "
SELECT gp.price
FROM store_group_history sgh
JOIN group_prices gp ON gp.price_group_id = sgh.price_group_id
WHERE sgh.store_id = 1 AND gp.item_id = 1 AND sgh.valid_to IS NULL
"
```

---

## Phase 5: Basket Optimization

### Objective
Single and multi-store basket optimization works correctly.

### Behavioral Tests

#### Single-Store Optimization
```
TEST: Returns cheapest store for basket
  GIVEN: Basket with items [A, B, C]
  AND: Store1 total=100, Store2 total=90, Store3 total=110
  WHEN: Optimize single-store
  THEN: Returns Store2
  AND: Total = 90

TEST: Handles missing items
  GIVEN: Basket with item X
  AND: Store1 has X, Store2 doesn't have X
  WHEN: Optimize
  THEN: Store1 eligible, Store2 NOT eligible
```

#### Multi-Store Optimization
```
TEST: Splits basket across stores
  GIVEN: Basket [A, B]
  AND: Store1: A=10, B=100
  AND: Store2: A=100, B=10
  WHEN: Optimize multi-store (max_stores=2)
  THEN: Returns split: Store1 for A, Store2 for B
  AND: Total = 20 (not 110 single-store)

TEST: Respects max_stores constraint
  GIVEN: Optimal split requires 5 stores
  AND: max_stores=3
  WHEN: Optimize
  THEN: Uses at most 3 stores
  AND: Returns best possible with constraint
```

#### Stability
```
TEST: Same inputs = same outputs
  GIVEN: Fixed basket and prices
  WHEN: Optimize called 10 times
  THEN: All results identical

TEST: Cache refresh doesn't change valid results
  GIVEN: Cached prices
  WHEN: Cache refreshed (no price changes)
  THEN: Optimization results unchanged
```

#### Edge Cases
```
TEST: Empty basket returns empty result
TEST: Single-item basket returns single store
TEST: All stores missing item returns error
TEST: Location-based filtering works
```

### Verification Commands
```bash
# Single-store optimization
curl -X POST localhost:8081/internal/optimize/single \
  -d '{"basket_items":[{"product_id":1,"quantity":2}], "location":{"lat":45.8, "lon":16.0}}'

# Multi-store optimization
curl -X POST localhost:8081/internal/optimize/multi \
  -d '{"basket_items":[...], "max_stores":3}'
```

---

## Phase 6: Store Enrichment UI

### Objective
Human approval gates store visibility.

### Behavioral Tests

#### Workflow
```
TEST: New store appears in admin
  GIVEN: Ingestion discovers new store
  WHEN: Admin views pending stores
  THEN: Store listed with status='pending'

TEST: Approve makes store visible
  GIVEN: Pending store
  WHEN: Admin approves store
  THEN: status='approved'
  AND: approvedAt set
  AND: Store appears in user-facing queries

TEST: Reject removes store from queue
  GIVEN: Pending store
  WHEN: Admin rejects store
  THEN: status='rejected'
  AND: Store NOT in pending list
  AND: Store NOT visible to users
```

#### Permissions
```
TEST: Non-admin cannot approve
  GIVEN: Regular user logged in
  WHEN: Attempt to approve store
  THEN: 403 Forbidden

TEST: Admin actions audited
  GIVEN: Admin approves store
  THEN: updatedAt reflects action time
  AND: (Optional) Audit log entry created
```

### Verification Commands
```bash
# Pending stores visible in admin
# Manual: Login as admin, view /admin/stores

# Approve flow
# Manual: Click approve, verify store appears in public
```

---

## Phase 7: Product Matching

### Objective
Products unified across chains. Manual review respected.

### Behavioral Tests

#### Auto Matching
```
TEST: Same barcode auto-links
  GIVEN: Retailer items with same barcode across chains
  WHEN: Matching pipeline runs
  THEN: product_links created
  AND: match_type='barcode'
  AND: confidence=1.0

TEST: No barcode = no auto-match
  GIVEN: Items without barcodes
  THEN: Not auto-matched
  AND: Available for AI/manual matching
```

#### AI Matching
```
TEST: Similar names suggested
  GIVEN: "Mlijeko 1L" in Chain A
  AND: "Svježe mlijeko 1 litra" in Chain B
  WHEN: AI matching runs
  THEN: Match suggested
  AND: confidence < 1.0
  AND: Queued for review

TEST: Low confidence = review required
  GIVEN: AI match with confidence < 0.7
  THEN: NOT auto-linked
  AND: Appears in admin review queue
```

#### Manual Review
```
TEST: Admin can link products
  GIVEN: Unlinked retailer items
  WHEN: Admin creates link
  THEN: product_links row created
  AND: match_type='manual'

TEST: Admin can unlink products
  GIVEN: Linked products
  WHEN: Admin removes link
  THEN: product_links row deleted

TEST: Search returns unified prices
  GIVEN: Product P linked to items in 3 chains
  WHEN: User searches for P
  THEN: Prices from all 3 chains displayed
```

### Verification Commands
```bash
# Products linked
psql $DATABASE_URL -c "SELECT product_id, COUNT(*) FROM product_links GROUP BY 1"

# Search returns multiple chains
curl "/api/products/search?q=mlijeko"
```

---

## Phase 8: Documentation

### Objective
System operable by someone else. Docs match reality.

### Documentation Tests
```
TEST: Fresh clone to running system
  GIVEN: Fresh git clone
  WHEN: Follow README instructions
  THEN: System runs
  AND: All tests pass

TEST: Deployment doc works
  GIVEN: Fresh server
  WHEN: Follow deployment guide
  THEN: Production system running

TEST: API docs match implementation
  GIVEN: Documented endpoint
  WHEN: Call endpoint per docs
  THEN: Response matches documented format
```

### Verification
```bash
# Clone fresh, follow docs
git clone ... && cd ... && pnpm install && pnpm dev

# API docs accurate
# Compare each endpoint in docs vs actual response
```

---

## Test Infrastructure Setup

### Required Test Libraries

**Node.js (existing + additions):**
```json
{
  "vitest": "^3.2.4",
  "@testing-library/react": "^16.3.1",
  "playwright": "^1.57.0"
}
```

**Go (new):**
```go
// go.mod additions
require (
    github.com/stretchr/testify v1.9.0
    github.com/pashagolub/pgxmock/v4 v4.0.0
)
```

### Test Organization

```
kosarica/
├── src/
│   └── __tests__/
│       └── e2e/
│           ├── auth.test.ts       # Phase 1
│           ├── prices.test.ts     # Phase 3, 4
│           └── basket.test.ts     # Phase 5
├── services/price-service/
│   └── internal/
│       ├── pricegroups/
│       │   └── hash_test.go       # Phase 4 (critical)
│       ├── scrapers/
│       │   └── *_test.go          # Phase 2 (per-scraper)
│       └── optimizer/
│           └── engine_test.go     # Phase 5
└── tests/
    └── integration/
        └── invariants.test.ts     # Global invariants
```

### CI Pipeline (GitHub Actions)

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  test-node:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install
      - run: pnpm test
      - run: pnpm run test:e2e

  test-go:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.23'
      - run: cd services/price-service && go test ./...
```

---

## Summary: Critical Tests to Automate First

If time is limited, automate these first (in priority order):

| Priority | Test | Phase | Risk if Skipped |
|----------|------|-------|-----------------|
| P0 | Hash determinism & stability | 4 | Catastrophic group duplication |
| P0 | Group reuse vs duplication | 4 | Storage explosion |
| P0 | Historical price correctness | 4 | Wrong prices to users |
| P1 | Ingestion idempotency | 2 | Data corruption |
| P1 | Auth flow E2E | 1 | Users can't login |
| P1 | Node → Go integration | 3 | Frontend broken |
| P2 | Basket optimization correctness | 5 | Wrong recommendations |
| P2 | Per-scraper parsing | 2 | Missing/wrong data |

---

## Final Checklist (Before "Done")

- [ ] Hash determinism validated (1000 runs, same output)
- [ ] Overlapping history ranges rejected (exclusion constraint)
- [ ] Largest chain ingestion completes < 2 minutes
- [ ] SQLite dependencies removed from package.json
- [ ] All 15 scrapers have sample data tests
- [ ] E2E tests pass in CI
- [ ] Documentation matches implementation
