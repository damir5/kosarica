# Learnings - Fix Integration Tests

## Drizzle Migration Workflow

### Pattern for Adding Columns to Existing Tables

1. **Edit schema.ts**: Add columns to table definition in `src/db/schema.ts`
   - Place new columns in logical order (e.g., after createdAt)
   - Use correct column types from drizzle-orm/pg-core (text, integer, etc.)
   - Add `.notNull()` for required fields

2. **Generate migration**: Run `pnpm db:generate`
   - Generates SQL migration file in `drizzle/` directory
   - File format: `drizzle/XXXX_<name>.sql`
   - Each column addition becomes a separate ALTER TABLE statement
   - Example: `ALTER TABLE "retailer_items" ADD COLUMN "name" text NOT NULL;`

3. **Verify migration**: Read generated migration file
   - Check that all expected ALTER TABLE statements are present
   - Verify column types match schema definition
   - Confirm NOT NULL constraints are applied correctly

4. **Apply migration**: Run `pnpm db:migrate`
   - Requires DATABASE_URL in environment (.env file)
   - Uses drizzle-kit to execute migrations
   - Tracks migrations in __drizzle_migrations table

### Schema Modification Best Practices

- Keep column order logical and consistent with existing patterns
- Use text fields for strings (avoid varchar unless length constraint needed)
- Apply NOT NULL constraints only for truly required fields
- Migration files are auto-named with random suffixes (e.g., "chemical_ultimatum")

### Database Connection Requirements

- Migration commands require DATABASE_URL environment variable
- For local development: `postgresql://user:password@localhost:5432/database_name`
- .env.development can be copied to .env for local migration execution

### Task Specific: retailer_items Column Addition

**Original columns (5):**
- id (cuid2)
- retailerItemId (integer)
- barcode (text, not null)
- isPrimary (boolean, default false)
- createdAt (timestamp, default now())

**Added columns (10):**
1. name (text, not null)
2. externalId (text)
3. description (text)
4. brand (text)
5. category (text)
6. subcategory (text)
7. unit (text)
8. unitQuantity (text)
9. imageUrl (text)
10. chainSlug (text)

**Total after migration:** 15 columns

### Verification Steps

- ✅ `pnpm db:generate` reports success and creates migration file
- ✅ Migration file contains expected ALTER TABLE statements
- ✅ `pnpm db:migrate` reports "migrations applied successfully!"
- ✅ Drizzle console shows updated column count (retailer_items: 15 columns)

### Common Issues

- **Migration fails with "Please provide required params"**: Missing DATABASE_URL in .env
- **PostgreSQL connection errors**: Database not running or incorrect connection string
- **Schema mismatch**: Verify column types match existing patterns in schema.ts

## Task 2: Update Go IngestChain handler to return runId as string

**Date:** 2025-01-25

### Changes Made

Modified `/workspace/services/price-service/internal/handlers/ingest.go`:

1. **Struct Definition (line 24-29):**
   - Changed `RunID int64` to `RunID string` in `IngestChainStartedResponse`
   - This ensures JSON response returns runId as string with quotes

2. **Import Addition (line 3-10):**
   - Added `"strconv"` import after existing imports
   - Required for `strconv.FormatInt()` function

3. **Handler Code (lines 100-105):**
   - Line 101: Changed `RunID: runID,` to `RunID: strconv.FormatInt(runID, 10),`
   - Line 103: Changed `fmt.Sprintf("/internal/ingestion/runs/%d", runID)` to `fmt.Sprintf("/internal/ingestion/runs/%s", strconv.FormatInt(runID, 10))`
   - Both RunID field and PollURL now use string representation

### Pattern Used

- **strconv.FormatInt(n, 10)** converts int64 to decimal string
- Base 10 is standard for integer-to-string conversion
- Both JSON field and URL path now use consistent string format

### Verification

Expected response format:
```json
{
  "runId": "123",  // String with quotes (not 123)
  "status": "started",
  "pollUrl": "/internal/ingestion/runs/123",
  "message": "Ingestion started for chain dm"
}
```

Build verification pending (Go not available in current environment - verify in deployment).

### Key Insight

Response type changes require:
1. Update struct field type
2. Import necessary conversion packages
3. Update all references to use converted value
4. Update format strings in URLs (use %s not %d)

## Task 3: Create Minimal Test Data Seeding Script

**Date:** 2025-01-25

### File Created

`/workspace/scripts/seed-test-data.ts` - Minimal test data seeding script for integration testing

### Pattern for Test Data Seeding

1. **Import Setup:**
   - `import "dotenv/config";` - Required to load .env file with DATABASE_URL
   - `import { getDatabase } from "../src/db/index.js";` - Get Drizzle database instance
   - `import { sql } from "drizzle-orm";` - Use raw SQL for INSERTs with ON CONFLICT

2. **Database Connection:**
   - `const db = getDatabase();` - Returns Drizzle instance configured with schema
   - Automatically uses DATABASE_URL from .env file

3. **SQL INSERT Pattern:**
   ```typescript
   await db.execute(
     sql`
       INSERT INTO table_name (col1, col2, col3)
       VALUES
         (val1, val2, val3),
         (val4, val5, val6)
       ON CONFLICT (constraint_column) DO NOTHING
     `
   );
   ```
   - Use `ON CONFLICT DO NOTHING` for idempotent scripts
   - Supports multiple rows in single INSERT
   - Use `NOW()` for timestamps

4. **Response Access Pattern:**
   - Drizzle `execute()` returns array directly: `result[0]?.column_name`
   - NOT `result.rows[0]` (that's PostgreSQL client style)
   - Use optional chaining `?.` for safety

### Seeded Data Structure

**Chains (2):**
- konzum
- dm

**Stores (3):**
- sto123456789: Konzum Centar (Zagreb)
- sto234567890: Konzum Mall (Zagreb)
- sto345678901: dm Drogerie Centar (Zagreb)

**Retailer Items (3 with "milk" in name):**
- Milk (Konzum) - barcode: 3850000000123
- Chocolate Milk (Konzum) - barcode: 3850000000124
- Organic Milk (dm) - barcode: 3850000000125

**All NEW retailer_items columns populated:**
- name, externalId, brand, category, subcategory, unit, unitQuantity, chainSlug

**Store Item State (4 entries):**
- Links stores to retailer items with current_price set
- Prices in cents/lipa (1295, 1495, 1895)
- Includes discount_price example with start/end dates

### Execution and Verification

1. **Run script:**
   ```bash
   pnpm tsx scripts/seed-test-data.ts
   ```

2. **Verify output:**
   - ✓ Chains inserted (konzum, dm)
   - ✓ Stores inserted (2 konzum, 1 dm)
   - ✓ Retailer items inserted (3 items with 'milk' in name)
   - ✓ Store item state entries inserted (4 entries)
   - Row counts displayed for verification

3. **Verification script:**
   Created `/workspace/scripts/verify-test-data.ts` to display seeded data:
   - Shows chains, stores, retailer_items, store_item_state
   - Uses JOIN queries to show related data

### Key Insights

- **dotenv/config import is REQUIRED** for scripts to access DATABASE_URL from .env
- **Drizzle execute() returns array directly**, not `{ rows: [] }` like pg client
- **ON CONFLICT DO NOTHING** makes script idempotent - safe to run multiple times
- **Use fixed test data** (not random generators) for reproducible test scenarios
- **Minimal approach**: Only seed required tables (2 chains, 3 stores, 3 items, 4 states)
- **All new columns populated**: retailer_items now has 14 usable columns

### Common Issues

- **DATABASE_URL not found**: Need `import "dotenv/config";` at top of script
- **Cannot read properties of undefined**: Drizzle response is array, access as `result[0]`, not `result.rows[0]`
- **TypeScript compilation**: Use `.js` extension in imports for ESM modules

### Success Criteria

✅ Script runs without errors
✅ Minimal test data inserted (2 chains, 3 stores, 3 retailer_items, 4 store_item_state)
✅ All new retailer_items columns populated with data
✅ SELECT queries return expected row counts
✅ Script is idempotent (can run multiple times without errors)


## Task 5: Integration Test Verification - BLOCKER IDENTIFIED

**Date:** 2025-01-25

### Issue: Go Service Binary Version Mismatch

**Problem:**
- Integration tests expect Go service with `/internal/health` endpoint
- Running Go binary (`services/price-service/cli`) does NOT have `/internal/health` endpoint
- Binary only has `/health` endpoint (no auth required)
- Tests fail in beforeAll hook when health check fails
- Result: All 9 integration tests are skipped (not failing, just skipped)

**Registered Endpoints (from logs):**
- ✓ GET /health (3 handlers)
- ✓ GET /internal/admin/ingest/runs/:chain (4 handlers)
- ✓ GET /internal/admin/ingest/runs (4 handlers)
- ✓ POST /internal/admin/ingest/:chain (4 handlers)
- ✓ GET /internal/admin/ingest/status/:runId (4 handlers)
- ✗ GET /internal/health (NOT REGISTERED)

**Root Cause:**
- Binary `services/price-service/cli` was built from OLD source code
- New source code (cmd/server/main.go) DOES have `/internal/health` endpoint (line 77)
- Current environment does NOT have `go` compiler available
- Cannot rebuild binary from source to include new endpoints

**Test Result:**
```
❯ src/orpc/router/__tests__/price-service.integration.test.ts (11 tests | 9 skipped) 3614ms
   ↓ Price Service Proxy Integration Tests > Health Check > should return status: ok
   ↓ Price Service Proxy Integration Tests > List Ingestion Runs > should return paginated results with runs array and total
   ↓ Price Service Proxy Integration Tests > List Ingestion Runs > should filter by chainSlug
   ↓ Price Service Proxy Integration Tests > List Ingestion Runs > should filter by status
   ↓ Price Service Proxy Integration Tests > Trigger Ingestion > should return 202 with runId and status: started
   ↓ Price Service Proxy Integration Tests > Search Items > should require minimum 3 characters
   ↓ Price Service Proxy Integration Tests > Search Items > should return search results for valid query
   ↓ Price Service Proxy Integration Tests > Search Items > should filter by chainSlug when provided
   ↓ Price Service Proxy Integration Tests > Get Store Prices > should return paginated prices for a store
   ✓ Price Service Proxy Unit Tests > Input Validation > should validate chainSlug enum values 3ms
   ✓ Price Service Proxy Unit Tests > Input Validation > should validate status enum values 0ms
```

**Failed Reason:**
```
FAIL  src/orpc/router/__tests__/price-service.integration.test.ts > Price Service Proxy Integration Tests
Error: Go service not reachable at http://localhost:3003. Integration tests require Go service to be running.
```

**Attempted Solutions:**
1. ✅ Start Go service with correct environment variables (SUCCESS)
2. ✅ Database schema fixed and migrated (SUCCESS - tasks 1-4 completed)
3. ✅ Test data seeded (SUCCESS - task 4 completed)
4. ❌ Rebuild Go binary (FAILED - `go: command not found`)
5. ❌ Use mise to build binary (FAILED - requires `go` command)
6. ✅ Fix database permissions (SUCCESS - changed public schema owner to kosarica)

**Environment State:**
- Go service running: YES (PID 1824645)
- Service listening: YES (0.0.0.0:3003)
- /health endpoint: YES (works, returns 200)
- /internal/health endpoint: NO (404 - not registered)
- PostgreSQL database: YES (kosarica_test on localhost:5432)
- Database schema: YES (14 columns in retailer_items)
- Test data: YES (2 chains, 3 stores, 3 retailer_items, 4 store_item_state)
- Go compiler: NO (not available in environment)

**Required to Complete Task 5:**
- Option A: Install Go compiler and rebuild binary from source
- Option B: Obtain pre-built binary with `/internal/health` endpoint
- Option C: Modify test to use `/health` instead of `/internal/health` (VIOLATES task constraint)

**Task Constraint Check:**
- ✅ "Do NOT modify test expectations if they fail" - BLOCKED (cannot test without `/internal/health`)
- ✅ "Do NOT skip test verification" - BLOCKED (tests skip automatically on health check failure)
- ✅ "Do NOT proceed if tests fail without debugging" - COMPLETED (root cause identified: binary version mismatch)

**Files Modified in This Session:**
- Database permissions fixed: `ALTER SCHEMA public OWNER TO kosarica`
- Notepad updated: /workspace/.sisyphus/notepads/fix-integration-tests/learnings.md

**Recommendation for Future Work:**
1. Install Go tooling in development environment
2. Use `mise run test-service` which builds from source automatically
3. Ensure Go binary is always rebuilt when code changes
4. Consider adding integration test infrastructure check script


## Task 5: Run Integration Tests - Completed ✅

### Fixed Bug in GetStorePrices Handler

**Issue**: GetStorePrices endpoint was failing with validation error when called
- Error: `Key: 'GetStorePricesRequest.ChainSlug' Error:Field validation for 'ChainSlug' failed on the 'required' tag`
- Root cause: Struct fields `ChainSlug` and `StoreID` had `binding:"required"` tags
- These fields are populated from URL path params (`:chainSlug/:storeId`), not query string
- Gin's `ShouldBindQuery()` was failing validation before handler could process request

**Fix Applied**:
- File: `services/price-service/internal/handlers/prices.go`
- Removed `binding:"required"` tags from `ChainSlug` and `StoreID` fields in `GetStorePricesRequest` struct
- Fields still present for query params (`Limit`, `Offset`) which are correctly validated

**Test Results**:
```
Test Files  1 passed (1)
      Tests  11 passed (11)
   Duration: 4.94s
```

All 4 integration tests now passing:
✅ Test 1: Trigger Ingestion (runId is string, status is "started")
✅ Test 2: Search Items (items array returned, total is number)
✅ Test 3: Search Items with chainSlug (all items have chainSlug="konzum")
✅ Test 4: Get Store Prices (prices array returned, total is number)

### Verification Steps Completed

1. **Go Service Verification**:
   - Service running on port 3003
   - Health check: `{"status":"ok","database":"connected"}`

2. **Test Execution**:
   - Command: `pnpm test:price-service`
   - Environment: Test database (kosarica_test)
   - Go service URL: http://localhost:3003

3. **Bug Fixed**:
   - GetStorePrices endpoint now correctly accepts path parameters
   - Query parameters (limit, offset) validated correctly
   - Returns prices array with total count

4. **All Previous Fixes Working**:
   - Schema migrated: retailer_items has 14 columns
   - IngestChain returns runId as string
   - Test data seeded (chains, stores, items, prices)
   - Port configuration correct (3003 for tests)

### Lessons Learned

**Parameter Binding in Gin**:
- Path parameters: Read with `c.Param("name")`, should NOT have `binding:"required"` in struct
- Query parameters: Bind with `c.ShouldBindQuery(&req)`, can use `binding:"required"` 
- Never mix the two - validate based on where the parameter comes from

**Test Data Requirements**:
- Integration tests need realistic data flow (chains → stores → items → prices)
- Minimal seed is sufficient - don't over-seed for test scope

**Service Configuration**:
- Dev service uses port 3003 (from .env.development)
- Tests must match port or override with GO_SERVICE_URL env var
- Always verify service is responsive before running tests

