# Fix Go Price Service Integration Tests

## Context

### Original Request
Review `test.md` and create a work plan to fix 4 failing integration tests in `src/orpc/router/__tests__/price-service.integration.test.ts`.

### Interview Summary
**Key Discussions**:
- User confirmed approach: Expand `retailer_items` table with product fields (denormalization), not join through `product_links`
- User decided: Convert Go handler to return runId as string (not update test)
- Test infrastructure exists: Vitest, integration tests require Go service running

**Research Findings**:
- Current `retailer_items` schema: Only 5 columns (id, retailer_item_id, barcode, is_primary, created_at)
- Go handlers expect 14 columns including: name, external_id, description, brand, category, subcategory, unit, unit_quantity, image_url, chain_slug
- Missing columns cause SQL errors → empty results → tests fail
- runId type mismatch: Go returns int64, test expects string

### Metis Review
**Identified Gaps (addressed in plan)**:
- Database migration safety: Use Drizzle's safe migration patterns
- Existing data handling: Default new columns to NULL (non-destructive)
- Test data scope: Define minimal set clearly (1-2 products across 1-2 chains)
- API impact: Only IngestChain handler changes, other handlers untouched
- Guardrails: Explicitly lock scope to prevent creep

---

## Work Objectives

### Core Objective
Fix 4 failing integration tests by aligning database schema with Go handler expectations and correcting runId type handling.

### Concrete Deliverables
1. Drizzle migration adding 9 columns to `retailer_items` table
2. Updated Go handler (IngestChain) returning runId as string
3. Test seed script populating minimal test data
4. All 4 integration tests passing

### Definition of Done
- [ ] Migration applies without errors: `pnpm db:migrate`
- [ ] retailer_items table has 14 columns
- [ ] IngestChain returns `{ runId: string, status: "started", pollUrl: string }`
- [ ] All 4 integration tests pass: `pnpm test:price-service`
- [ ] No new test failures introduced

### Must Have
- Add 9 columns to retailer_items via Drizzle migration
- Convert runId to string in Go IngestChain handler
- Seed minimal test data for 4 failing tests
- Verify all 4 tests pass after fixes

### Must NOT Have (Guardrails)
- DO NOT modify other tables (products, product_links, stores)
- DO NOT modify other Go handlers beyond IngestChain
- DO NOT update test expectations or test assertions
- DO NOT add indexes or performance optimizations (out of scope)
- DO NOT backfill data from product_links table
- DO NOT create comprehensive seeders (seed only what tests need)
- DO NOT update frontend code or other consuming systems
- DO NOT modify other integration tests
- DO NOT add validation logic beyond bare minimum

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (Vitest with integration tests)
- **User wants tests**: Tests-after (implementation first, then verify)
- **Framework**: vitest
- **Test command**: `pnpm test:price-service`

### Test Strategy

Since this is fixing existing tests (not writing new TDD tests), the approach is:
1. Implement changes (migration, handler fix, test data)
2. Run integration tests to verify fixes
3. Manual verification for each endpoint

**Integration Tests to Verify**:
- Test 1: Trigger Ingestion (lines 102-113)
- Test 2: Search Items (lines 124-134)
- Test 3: Search Items with chainSlug (lines 136-149)
- Test 4: Get Store Prices (lines 152-170)

**Manual Verification Commands** (optional, for debugging):
```bash
# Trigger ingestion
curl -X POST http://localhost:3003/internal/admin/ingest/dm \
  -H "X-Internal-API-Key: test-key" \
  -H "Content-Type: application/json"

# Search items
curl "http://localhost:3003/internal/items/search?q=milk&limit=10" \
  -H "X-Internal-API-Key: test-key"

# Get store prices
curl "http://localhost:3003/internal/prices/konzum/test-store-id?limit=10" \
  -H "X-Internal-API-Key: test-key"
```

---

## Task Flow

```
Task 1 → Task 2 → Task 3 → Task 4
                  ↘ Task 5 (test verification)
```

## Parallelization

| Group | Tasks | Reason |
|-------|-------|--------|
| A | 2, 3 | Independent changes (migration + handler) |

| Task | Depends On | Reason |
|------|------------|--------|
| 4 | 2 | Requires migration to add columns before seeding |
| 5 | 2, 3, 4 | Requires all fixes in place |

---

## TODOs

- [x] 1. Create Drizzle migration to add 9 columns to retailer_items

  **What to do**:
  - Add columns to `src/db/schema.ts` retailer_items table:
    - `name: text().notNull()` - Product name
    - `external_id: text()` - Chain-specific external ID
    - `description: text()` - Product description
    - `brand: text()` - Product brand
    - `category: text()` - Product category
    - `subcategory: text()` - Product subcategory
    - `unit: text()` - Unit (kg, l, kom, etc.)
    - `unit_quantity: text()` - Quantity per unit (e.g., "1", "100", "1000")
    - `image_url: text()` - Product image URL
    - `chain_slug: text()` - Chain slug (konzum, lidl, etc.)
  - Run `pnpm db:generate` to create migration file
  - Review generated migration in `drizzle/` directory
  - Verify column types and defaults match Go handler expectations

  **Must NOT do**:
  - DO NOT add foreign key constraints (out of scope)
  - DO NOT add indexes (out of scope)
  - DO NOT add validation beyond NOT NULL on name

  **Parallelizable**: YES (with Task 3)

  **References**:

  **Pattern References** (existing migration patterns):
  - `drizzle/0000_warm_molecule_man.sql` - Baseline retailer_items table creation
  - `services/price-service/migrations/0005_add_retailer_items_failed.sql` - Column addition patterns

  **Schema References** (current retailer_items definition):
  - `src/db/schema.ts:179-191` - Current retailer_items table (5 columns)

  **Test References** (expected fields):
  - `src/orpc/router/__tests__/price-service.integration.test.ts:131` - `result.items` expectation
  - `src/orpc/router/__tests__/price-service.integration.test.ts:147` - `item.chainSlug` expectation

  **Go Handler References** (what queries expect):
  - `services/price-service/internal/handlers/prices.go:94` - `ri.name` query
  - `services/price-service/internal/handlers/prices.go:95-96` - `ri.external_id`, `ri.brand` queries
  - `services/price-service/internal/handlers/prices.go:223-232` - Full column list in SearchItems

  **Documentation References**:
  - `test.md:24` - Recommended column list for migration
  - `services/price-service/README.md` - Schema authority section (Drizzle defines schema)

  **External References** (libraries and frameworks):
  - Drizzle ORM: `https://orm.drizzle.team/docs/quick-postgresql` - Table schema and migration patterns
  - Drizzle Column Types: `https://orm.drizzle.team/docs/column-types/pg` - PostgreSQL column types

  **WHY Each Reference Matters**:
  - Current schema shows what exists (5 columns)
  - Go handlers show what's queried (14 columns)
  - Delta: 9 columns to add
  - Migration patterns show how to add columns safely

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] Migration file created: `drizzle/XXXX_add_retailer_items_columns.sql`
  - [ ] Migration contains: 9 ALTER TABLE statements
  - [ ] Migration contains: correct column types (text, etc.)
  - [ ] `pnpm db:generate` → PASS (migration generated)
  - [ ] `pnpm db:migrate` → PASS (migration applied)

  **Manual Execution Verification**:
  - [ ] Migration file exists in `drizzle/` directory
  - [ ] File contains ALTER TABLE retailer_items with 9 ADD COLUMN statements
  - [ ] Apply migration: `pnpm db:migrate`
  - [ ] Verify schema: Connect to DB, `\\d retailer_items`, shows 14 columns
  - [ ] Check existing data (if any): `SELECT * FROM retailer_items LIMIT 5;` shows NULL in new columns (data preserved)

  **Evidence Required**:
  - [ ] Migration file contents (copy-paste from drizzle/XXXX_*.sql)
  - [ ] Migration output: `pnpm db:migrate` terminal output showing "Migration applied"
  - [ ] Schema verification: `\\d retailer_items` psql output showing 14 columns

  **Commit**: YES
  - Message: `db(schema): add 9 columns to retailer_items for Go service integration`
  - Files: `src/db/schema.ts`, `drizzle/XXXX_add_retailer_items_columns.sql`
  - Pre-commit: `pnpm db:generate` (to verify migration regeneration)

---

- [x] 2. Update Go IngestChain handler to return runId as string

  **What to do**:
  - Edit `services/price-service/internal/handlers/ingest.go`
  - Find `IngestChainStartedResponse` struct (line 24-29)
  - Change `RunID int64` to `RunID string`
  - Update handler code (line 100-105) to convert int64 to string:
    ```go
    // Before:
    c.JSON(http.StatusAccepted, IngestChainStartedResponse{
        RunID:   runID,  // int64
        Status:  "started",
        PollURL: fmt.Sprintf("/internal/ingestion/runs/%d", runID),
        Message: fmt.Sprintf("Ingestion started for chain %s", chainID),
    })

    // After:
    c.JSON(http.StatusAccepted, IngestChainStartedResponse{
        RunID:   strconv.FormatInt(runID, 10),  // string
        Status:  "started",
        PollURL: fmt.Sprintf("/internal/ingestion/runs/%s", strconv.FormatInt(runID, 10)),
        Message: fmt.Sprintf("Ingestion started for chain %s", chainID),
    })
    ```
  - Import `strconv` package if not already imported (check line 3)

  **Must NOT do**:
  - DO NOT modify any other handlers (SearchItems, GetStorePrices)
  - DO NOT modify database queries
  - DO NOT change any other response fields

  **Parallelizable**: YES (with Task 1)

  **References**:

  **Pattern References** (existing handler patterns):
  - `services/price-service/internal/handlers/ingest.go:24-29` - Response struct definition
  - `services/price-service/internal/handlers/ingest.go:100-105` - Response construction
  - `services/price-service/internal/handlers/ingest.go:172-174` - Other handler string formatting examples

  **Test References** (what tests expect):
  - `src/orpc/router/__tests__/price-service.integration.test.ts:108-111` - Expected response shape

  **Go Service Client References** (how response is used):
  - `src/lib/go-service-client.ts:95-109` - `scheduleIngestion` function expecting `{ id: string }`

  **Documentation References**:
  - `test.md:12` - Documented runId type mismatch
  - `services/price-service/README.md` - API endpoint documentation

  **External References** (libraries and frameworks):
  - Go strconv: `https://pkg.go.dev/strconv#FormatInt` - int64 to string conversion

  **WHY Each Reference Matters**:
  - Response struct shows exact field to change (RunID int64 → string)
  - Handler code shows where conversion happens (line 100-105)
  - Test expectations confirm string type is correct
  - Client usage shows downstream code expects string

  **Acceptance Criteria**:

  **Manual Execution Verification**:
  - [ ] Go file edited: `services/price-service/internal/handlers/ingest.go` has `RunID string`
  - [ ] Import added: `import "strconv"` at top of file
  - [ ] Conversion applied: `strconv.FormatInt(runID, 10)` used twice
  - [ ] Build Go service: `cd services/price-service && go build`
  - [ ] Verify build succeeds: No compile errors
  - [ ] Run Go service: `./price-service` (or docker compose)
  - [ ] Trigger ingestion: `curl -X POST http://localhost:3003/internal/admin/ingest/dm -H "X-Internal-API-Key: test-key"`
  - [ ] Verify response: `runId` is string (e.g., "123", not 123)
  - [ ] Verify pollUrl: `pollUrl` also uses string ID (e.g., "/internal/ingestion/runs/123")

  **Evidence Required**:
  - [ ] Build output: `go build` terminal output showing success
  - [ ] Response JSON: `curl` output showing `"runId": "123"` (string with quotes)

  **Commit**: YES (groups with Task 3)
  - Message: `fix(price-service): return runId as string in IngestChain handler`
  - Files: `services/price-service/internal/handlers/ingest.go`
  - Pre-commit: `go build ./...` (verify no compile errors)

---

- [x] 3. Create minimal test data seeding script

  **What to do**:
  - Create file `scripts/seed-test-data.ts` (or similar)
  - Write SQL to insert minimal test data:
    - Insert 1-2 chains (konzum, dm)
    - Insert 1-2 stores per chain
    - Insert 2-3 retailer_items per chain with NEW columns populated
    - Insert store_item_state entries for prices
  - Use existing connection setup from database code
  - Make script executable with `pnpm` or direct Node execution
  - Handle errors gracefully (if data already exists, skip or update)

  **Test Data Requirements** (minimal to pass 4 tests):
  - **Chains**: konzum, dm (tests query both)
  - **Stores**: At least 1 store per chain
  - **Retailer Items**:
    - For SearchItems test: 2-3 items with name containing "milk"
    - For GetStorePrices test: 2-3 items with prices
    - Required fields: name, chain_slug, barcode, etc.
  - **Store Item State**:
    - Prices for items at stores
    - Current price set (not NULL)

  **Must NOT do**:
  - DO NOT seed all retailers (11 chains) - out of scope
  - DO NOT create comprehensive production-like data
  - DO NOT use random/mock generators - keep it simple
  - DO NOT populate product_links or products tables (out of scope)

  **Parallelizable**: NO (depends on Task 1 - columns must exist)

  **References**:

  **Pattern References** (existing seed/setup patterns):
  - `src/db/schema.ts` - Drizzle schema for table structures
  - `drizzle.config.ts` - Database connection configuration
  - Look for existing seed scripts in `scripts/` directory

  **Database References** (table structures to populate):
  - `src/db/schema.ts:110-116` - chains table structure
  - `src/db/schema.ts:118-155` - stores table structure
  - `src/db/schema.ts:179-191` - retailer_items table (after Task 1, will have 14 columns)
  - `src/db/schema.ts:260-297` - store_item_state table structure

  **Test References** (what tests query):
  - `src/orpc/router/__tests__/price-service.integration.test.ts:126` - Query for "milk"
  - `src/orpc/router/__tests__/price-service.integration.test.ts:139` - chainSlug filter "konzum"
  - `src/orpc/router/__tests__/price-service.integration.test.ts:158-160` - Store prices query params

  **Go Handler References** (what handlers query):
  - `services/price-service/internal/handlers/prices.go:220-253` - SearchItems query joins store_item_state
  - `services/price-service/internal/handlers/prices.go:77-83` - GetStorePrices counts rows

  **External References** (libraries and frameworks):
  - Node.js postgres: `https://node-postgres.com/` - Database connection and queries
  - Drizzle seed patterns: `https://orm.drizzle.team/docs/seed` - Seeding patterns

  **WHY Each Reference Matters**:
  - Schema files show exact column names and types
  - Test queries show what data must exist for tests to pass
  - Handler queries show joins and conditions needed for data

  **Acceptance Criteria**:

  **Manual Execution Verification**:
  - [ ] Seed script created: `scripts/seed-test-data.ts` exists
  - [ ] Script runs: `pnpm tsx scripts/seed-test-data.ts` succeeds
  - [ ] Chains seeded: `SELECT * FROM chains WHERE slug IN ('konzum', 'dm');` returns 2 rows
  - [ ] Stores seeded: `SELECT * FROM stores WHERE chain_slug IN ('konzum', 'dm');` returns ≥2 rows
  - [ ] Retailer items seeded: `SELECT * FROM retailer_items WHERE name ILIKE '%milk%';` returns ≥2 rows
  - [ ] New columns populated: `SELECT name, brand, chain_slug FROM retailer_items LIMIT 5;` shows non-NULL values
  - [ ] Store item state seeded: `SELECT * FROM store_item_state WHERE current_price IS NOT NULL LIMIT 5;` returns ≥2 rows

  **Evidence Required**:
  - [ ] Seed script output: `pnpm tsx scripts/seed-test-data.ts` terminal output
  - [ ] Query results: `psql` SELECT commands output showing data exists
  - [ ] Row counts: Each SELECT returns expected row count

  **Commit**: YES (groups with Task 1)
  - Message: `test(db): add minimal seed data for integration tests`
  - Files: `scripts/seed-test-data.ts`
  - Pre-commit: Run seed script to verify it works

---

- [x] 4. Apply migration and seed test data

  **What to do**:
  - Run migration: `pnpm db:migrate`
  - Verify migration applied (check terminal output)
  - Run seed script: `pnpm tsx scripts/seed-test-data.ts`
  - Verify data seeded successfully
  - Check for any errors or conflicts

  **Must NOT do**:
  - DO NOT run migrations on production without backup
  - DO NOT skip verification steps
  - DO NOT proceed if migration fails (stop and fix)

  **Parallelizable**: NO (depends on Tasks 1 and 3)

  **References**:

  **Pattern References** (existing migration patterns):
  - `drizzle.config.ts` - Migration configuration
  - `package.json:15-16` - `db:generate` and `db:migrate` scripts

  **Database References** (migration system):
  - `drizzle/` directory - Generated migration files
  - Drizzle journal table (automatically managed by Drizzle)

  **WHY Each Reference Matters**:
  - Package.json shows correct commands to run
  - Migration directory is where files are applied from

  **Acceptance Criteria**:

  **Manual Execution Verification**:
  - [ ] Migration applied: `pnpm db:migrate` shows "No migrations to apply" or "Migration applied"
  - [ ] Seed script executed: `pnpm tsx scripts/seed-test-data.ts` completes without errors
  - [ ] No duplicate key errors in seed output
  - [ ] No foreign key violations in seed output
  - [ ] Verify data: Connect to DB, query each table, confirm rows exist

  **Evidence Required**:
  - [ ] Migration output: `pnpm db:migrate` terminal output
  - [ ] Seed output: `pnpm tsx scripts/seed-test-data.ts` terminal output
  - [ ] Row counts: `SELECT COUNT(*) FROM chains;`, `SELECT COUNT(*) FROM retailer_items;` etc.

  **Commit**: NO (already grouped with Tasks 1 and 3)

---

- [x] 5. Run integration tests and verify all 4 pass

  **What to do**:
  - Ensure Go service is running: `docker compose ps` or check port 3003
  - Run integration tests: `pnpm test:price-service`
  - Verify all 4 tests pass
  - Check test output for any new failures or warnings
  - If any test fails, debug and fix before proceeding

  **Expected Test Results**:
  - **Test 1: Trigger Ingestion** → PASS (runId is string, status is "started")
  - **Test 2: Search Items** → PASS (items array returned, total is number)
  - **Test 3: Search Items with chainSlug** → PASS (all items have chainSlug="konzum")
  - **Test 4: Get Store Prices** → PASS (prices array returned, total is number)

  **Must NOT do**:
  - DO NOT modify test expectations if they fail
  - DO NOT skip test verification
  - DO NOT proceed if tests fail without debugging

  **Parallelizable**: NO (depends on Tasks 2, 4)

  **References**:

  **Test References** (what to verify):
  - `src/orpc/router/__tests__/price-service.integration.test.ts:102-170` - All 4 failing tests
  - `package.json:21` - `test:price-service` script definition

  **Documentation References**:
  - `test.md:10-15` - Failing test descriptions and expected behavior

  **WHY Each Reference Matters**:
  - Test file shows exact assertions that must pass
  - Package.json shows correct command to run tests

  **Acceptance Criteria**:

  **Manual Execution Verification**:
  - [ ] Go service running: `curl http://localhost:3003/internal/health` returns 200 OK
  - [ ] Tests executed: `pnpm test:price-service` completes
  - [ ] Test 1 passes: `Trigger Ingestion` ✓ in test output
  - [ ] Test 2 passes: `should return search results for valid query` ✓
  - [ ] Test 3 passes: `should filter by chainSlug when provided` ✓
  - [ ] Test 4 passes: `should return paginated prices for a store` ✓
  - [ ] No new test failures: All other tests still pass
  - [ ] Test execution time: Completes in < 60 seconds (reasonable for 4 integration tests)

  **Evidence Required**:
  - [ ] Test output: `pnpm test:price-service` terminal output showing "PASS" for all 4 tests
  - [ ] Test count: Output shows "X passed" where X = 4+ (including other tests)
  - [ ] Screenshot: If running in IDE, screenshot of test results panel showing green ✓

  **Commit**: YES (final commit if all tests pass)
  - Message: `test(integration): verify all 4 price-service tests pass after schema and handler fixes`
  - Files: No code changes (just verification commit, optional)
  - Pre-commit: `pnpm test:price-service` (all tests pass)

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `db(schema): add 9 columns to retailer_items for Go service integration` | `src/db/schema.ts`, `drizzle/XXXX_add_retailer_items_columns.sql` | `pnpm db:generate` |
| 2 | `fix(price-service): return runId as string in IngestChain handler` | `services/price-service/internal/handlers/ingest.go` | `go build ./...` |
| 3 | `test(db): add minimal seed data for integration tests` | `scripts/seed-test-data.ts` | Run script successfully |
| 5 | `test(integration): verify all 4 price-service tests pass after fixes` | (optional verification commit) | `pnpm test:price-service` |

---

## Success Criteria

### Verification Commands
```bash
# Apply migration
pnpm db:migrate
# Expected: "Migration applied" or "No migrations to apply"

# Seed test data
pnpm tsx scripts/seed-test-data.ts
# Expected: No errors, rows inserted

# Verify Go service
curl http://localhost:3003/internal/health
# Expected: {"status": "ok"}

# Run integration tests
pnpm test:price-service
# Expected: All 4 tests PASS
```

### Final Checklist
- [ ] retailer_items table has 14 columns (was 5, added 9)
- [ ] IngestChain returns runId as string (not int64)
- [ ] Test data exists for chains (konzum, dm)
- [ ] Test data exists for stores (≥2 rows)
- [ ] Test data exists for retailer_items (≥5 rows with name containing "milk")
- [ ] Test 1 passes: Trigger Ingestion
- [ ] Test 2 passes: Search Items
- [ ] Test 3 passes: Search Items with chainSlug
- [ ] Test 4 passes: Get Store Prices
- [ ] No new test failures introduced
- [ ] All "Must NOT Have" guardrails respected
