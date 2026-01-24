# Integer/BigInteger Migration for High-Volume Tables

## Context

### Original Request
User wants to implement integer/biginteger types for high-volume tables in both Golang and TypeScript. Drop and recreate database (no data preservation needed).

### Interview Summary

**Key Decisions**:
- **Target fields**: IDs (primary keys only) - change from CUID2 (text) to bigint (64-bit)
- **Target tables** (high-volume only):
  1. `ingestion_runs`
  2. `ingestion_files`
  3. `ingestion_errors`
  4. `product_match_audit`
  5. `store_item_state`
  6. `store_item_price_periods`
- **ID size**: PostgreSQL `bigint` (8-byte), Golang `int64`, TypeScript `bigint`
- **Scope**: High-volume tables only, other tables remain with CUID2 IDs
- **Strategy**: Drop and recreate database (no data preservation), use sequence-based IDs
- **Test strategy**: Tests after implementation (not TDD)

### Research Findings

**Current State**:
- All IDs use CUID2 format stored as `text`
- Schema defined in `src/db/schema.ts` using Drizzle ORM
- Golang models in `services/price-service/internal/database/`
- Test infrastructure exists: vitest (TypeScript) and go test (Golang)

**Foreign Key Complexities**:
- Mixed-type foreign keys (bigint referencing CUID2):
  - `ingestion_files.source_id` → `sources.id` (unchanged, CUID2)
  - `store_item_state.store_id` → `stores.id` (unchanged, CUID2)
  - `store_item_state.retailer_item_id` → `retailer_items.id` (unchanged, CUID2)

**Files Affected**:
- `/workspace/src/db/schema.ts` - Drizzle schema definitions
- `/workspace/services/price-service/internal/database/models.go` - Go structs
- `/workspace/services/price-service/internal/database/models_price_groups.go` - Go price models
- All query files and handlers using these IDs
- Migration files in `/workspace/drizzle/`

---

## Work Objectives

### Core Objective
Migrate 6 high-volume tables from CUID2 (text) IDs to 64-bit bigint IDs with sequence-based auto-increment, preserving data integrity across mixed-type foreign key relationships.

### Concrete Deliverables
- Updated Drizzle schema with bigint columns for target tables
- Updated Golang models using `int64` for affected IDs
- Updated TypeScript types using `bigint` for affected IDs
- Database migration to drop and recreate tables with new schema
- All foreign key constraints working correctly (including mixed-type references)

### Definition of Done
- Database schema reflects bigint IDs for all 6 target tables
- All affected code compiles without errors
- Mixed-type foreign keys work correctly
- Existing tests pass, new tests added for ID types
- Application starts successfully and can create new records

### Must Have
- All 6 target tables use bigint primary keys
- Foreign key constraints preserved (both same-type and mixed-type)
- Both Golang and TypeScript code updated
- Database can be dropped and recreated from migration

### Must NOT Have (Guardrails)
- **DO NOT modify low-volume tables** (stores, retailer_items, sources, etc. remain with CUID2)
- **DO NOT change price fields** - prices stay as integer (cents/lipa)
- **DO NOT attempt data migration** - drop and recreate database
- **DO NOT create separate sequences** - use PostgreSQL `SERIAL` / `BIGSERIAL` for auto-increment
- **DO NOT change foreign key relationship semantics** - just change the type, keep the same relationships

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (vitest for TypeScript, go test for Golang)
- **User wants tests**: YES (Tests-after implementation)
- **Framework**: vitest (TS) and go test (Go)

### Implementation Flow

1. **Implement schema changes** in TypeScript (Drizzle)
2. **Implement model changes** in Golang
3. **Implement type changes** in TypeScript
4. **Generate and run migration** (drop and recreate)
5. **Write tests** to verify new schema and types
6. **Run all tests** to ensure nothing broke

### Verification Commands

**TypeScript:**
```bash
pnpm test              # Run vitest tests
pnpm build             # Verify TypeScript compilation
```

**Golang:**
```bash
cd services/price-service
go test ./internal/... -v          # Run all tests
go build ./cmd/server/main.go       # Verify Go compilation
```

**Database:**
```bash
pnpm db:generate       # Generate migration from schema changes
pnpm db:migrate        # Apply migration (drop and recreate)
```

---

## Task Flow

```
Task 1: Update Drizzle Schema (TypeScript)
      ↓
Task 2: Update TypeScript Types
      ↓
Task 3: Update Golang Models
      ↓
Task 4: Generate Migration
      ↓
Task 5: Run Migration (Drop & Recreate)
      ↓
Task 6: Write TypeScript Tests
      ↓
Task 7: Write Golang Tests
      ↓
Task 8: Verify All Tests Pass
```

**Parallelization**: None - sequential migration requires changes in order (schema → types → migration)

---

## TODOs

- [ ] 1. Update Drizzle Schema for High-Volume Tables

  **What to do**:
  - Modify `/workspace/src/db/schema.ts`
  - Change 6 target tables from `text()` (CUID2) to `bigSerial()` for primary keys
  - Update all foreign key columns referencing these tables to `bigint()`
  - Keep mixed-type foreign keys as `text()` (referencing unchanged tables)

  **Specific Changes per Table**:

  **ingestion_runs**:
  - `id`: `text()` → `bigSerial()`
  - Foreign key from `ingestion_files.ingestion_run_id` → update to `bigint()`
  - Foreign key from `ingestion_errors.ingestion_run_id` → update to `bigint()`

  **ingestion_files**:
  - `id`: `text()` → `bigSerial()`
  - `ingestion_run_id`: `text()` → `bigint()` (references ingestion_runs)
  - `source_id`: Keep as `text()` (references sources.id - unchanged)

  **ingestion_errors**:
  - `id`: `text()` → `bigSerial()`
  - `ingestion_run_id`: `text()` → `bigint()` (references ingestion_runs)

  **product_match_audit**:
  - `id`: `text()` → `bigSerial()`
  - No foreign keys to update

  **store_item_state**:
  - `id`: `text()` → `bigSerial()`
  - `store_id`: Keep as `text()` (references stores.id - unchanged)
  - `retailer_item_id`: Keep as `text()` (references retailer_items.id - unchanged)
  - Foreign key from `store_item_price_periods.state_id` → update to `bigint()`

  **store_item_price_periods**:
  - `id`: `text()` → `bigSerial()`
  - `state_id`: `text()` → `bigint()` (references store_item_state)

  **Must NOT do**:
  - DO NOT modify any other tables (stores, retailer_items, sources, etc.)
  - DO NOT change price fields or timestamp fields
  - DO NOT alter the `cuid()` function for unchanged tables

  **Parallelizable**: NO (depends on nothing, but must be first)

  **References**:

  **Pattern References** (existing code to follow):
  - `/workspace/src/db/schema.ts:1-100` - Review current table definitions and column types
  - `/workspace/drizzle/0000_puzzling_sphinx.sql` - Reference original migration structure
  - Drizzle docs: `https://orm.drizzle.team/docs/column-types/pg` - PostgreSQL column types, specifically `bigSerial()`

  **Documentation References**:
  - `/workspace/doc/planning/DATABASE.md` - Database schema authority
  - `/workspace/services/price-service/README.md` - Go service schema expectations

  **External References**:
  - Drizzle bigSerial: `https://orm.drizzle.team/docs/column-types/pg#bigserial` - Auto-incrementing 64-bit integer
  - PostgreSQL SERIAL types: `https://www.postgresql.org/docs/current/datatype-numeric.html` - SERIAL vs BIGSERIAL

  **WHY Each Reference Matters**:
  - `/workspace/src/db/schema.ts` - This is the single source of truth for database schema. All changes start here.
  - `/workspace/drizzle/0000_puzzling_sphinx.sql` - Shows the original table creation structure, helps verify relationships
  - Drizzle docs - `bigSerial()` is the correct way to create auto-incrementing bigint primary keys

  **Acceptance Criteria**:
  - [ ] All 6 target tables have `id` columns changed from `text()` to `bigSerial()`
  - [ ] All foreign keys referencing changed tables use `bigint()`
  - [ ] Mixed-type foreign keys remain as `text()` (references to unchanged tables)
  - [ ] No other tables are modified
  - [ ] `pnpm db:generate` runs successfully (creates migration file)
  - [ ] Generated migration file reflects all expected changes

  **Manual Execution Verification**:
  - [ ] Run: `pnpm db:generate`
  - [ ] Expected: New migration file created in `/workspace/drizzle/` with timestamp
  - [ ] Verify: Read generated migration file, confirm:
    - All 6 target tables have `bigserial` for primary key
    - Foreign keys to changed tables are `bigint`
    - Mixed-type foreign keys remain `text`
  - [ ] Command output shows: "Migration file created" (or similar success message)

  **Commit**: NO (wait for migration generation)

---

- [ ] 2. Update TypeScript Type Definitions

  **What to do**:
  - Find and update TypeScript type definitions for the 6 target tables
  - Change ID types from `string` to `bigint`
  - Update any derived types or interfaces

  **Files to Update**:
  - Check for type definitions in `/workspace/src/db/schema.ts` (inferred from Drizzle)
  - Check for explicit type files in `/workspace/src/types/` or `/workspace/src/db/types.ts`
  - Update any exported interfaces for the affected tables

  **Must NOT do**:
  - DO NOT modify types for low-volume tables
  - DO NOT change types for prices (keep as `number | null`)
  - DO NOT change types for timestamps

  **Parallelizable**: NO (must happen after schema changes, before migration)

  **References**:

  **Pattern References** (existing code to follow):
  - `/workspace/src/db/schema.ts` - Drizzle infers types from schema, verify inferred types are correct
  - `/workspace/src/orpc/router/__tests__/stores-integration.test.ts:1-50` - TypeScript type usage examples
  - `/workspace/src/db/custom-types.ts` - Custom type definitions pattern

  **WHY Each Reference Matters**:
  - `/workspace/src/db/schema.ts` - Drizzle automatically infers TypeScript types from schema changes
  - Test files show how these types are actually used in the codebase

  **Acceptance Criteria**:
  - [ ] TypeScript types for all 6 target tables use `bigint` for ID fields
  - [ ] Types for foreign keys to changed tables use `bigint`
  - [ ] Types for mixed-type foreign keys remain `string`
  - [ ] `pnpm build` completes without TypeScript errors
  - [ ] No type errors in IDE/editor

  **Manual Execution Verification**:
  - [ ] Run: `pnpm build`
  - [ ] Expected: Build completes successfully with 0 TypeScript errors
  - [ ] Verify: Output shows compiled files in `dist/` directory
  - [ ] Command output contains: "Built in [time]" (vite build success message)

  **Commit**: NO (wait for full migration)

---

- [ ] 3. Update Golang Models for High-Volume Tables

  **What to do**:
  - Update `/workspace/services/price-service/internal/database/models.go`
  - Update `/workspace/services/price-service/internal/database/models_price_groups.go` (if affected)
  - Change ID types from `string` to `int64` for affected tables
  - Update all foreign key fields referencing these tables

  **Specific Changes per Table**:

  **IngestionRun** struct:
  - `ID`: `string` → `int64`

  **IngestionFile** struct:
  - `ID`: `string` → `int64`
  - `IngestionRunID`: `string` → `int64`
  - `SourceID`: Keep as `string` (mixed-type foreign key)

  **IngestionError** struct:
  - `ID`: `string` → `int64`
  - `IngestionRunID`: `string` → `int64`

  **ProductMatchAudit** struct:
  - `ID`: `string` → `int64`

  **StoreItemState** struct:
  - `ID`: `string` → `int64`
  - `StoreID`: Keep as `string` (mixed-type foreign key)
  - `RetailerItemID`: Keep as `string` (mixed-type foreign key)

  **StoreItemPricePeriod** struct:
  - `ID`: `string` → `int64`
  - `StateID`: `string` → `int64`

  **Also update**:
  - Any database scanning code that reads these IDs
  - Any query building code that uses these IDs as parameters
  - JSON serialization (Go's `json` package handles `int64` correctly)

  **Must NOT do**:
  - DO NOT modify structs for low-volume tables (Store, RetailerItem, Source, etc.)
  - DO NOT modify price fields (keep as `*int`)
  - DO NOT modify timestamp fields

  **Parallelizable**: NO (can happen in parallel with task 2, but logically ordered)

  **References**:

  **Pattern References** (existing code to follow):
  - `/workspace/services/price-service/internal/database/models.go` - Current struct definitions
  - `/workspace/services/price-service/internal/database/models_price_groups.go` - Price-related models
  - `/workspace/services/price-service/internal/handlers/prices.go:1-50` - How models are used in handlers
  - `/workspace/services/price-service/tests/integration/chains_test.go:50-100` - Test usage patterns

  **WHY Each Reference Matters**:
  - `models.go` - Contains all the struct definitions that need to be updated
  - `handlers/prices.go` - Shows how these models are used in the API layer
  - Test files - Show how models are instantiated and used in practice

  **Acceptance Criteria**:
  - [ ] All 6 affected structs use `int64` for ID fields
  - [ ] Foreign key fields to changed tables use `int64`
  - [ ] Mixed-type foreign keys remain `string`
  - [ ] `cd services/price-service && go build ./cmd/server/main.go` completes without errors
  - [ ] No compilation errors in any Go files

  **Manual Execution Verification**:
  - [ ] Run: `cd services/price-service && go build ./cmd/server/main.go`
  - [ ] Expected: Binary builds successfully with 0 errors
  - [ ] Verify: Output shows no error messages, binary `main.go` (or `price-service`) is created
  - [ ] Command output ends with no errors (clean build output)

  **Commit**: NO (wait for full migration)

---

- [ ] 4. Generate Database Migration

  **What to do**:
  - Run Drizzle migration generation
  - Review the generated migration file
  - Ensure all expected changes are present

  **Commands**:
  ```bash
  pnpm db:generate
  ```

  **Expected Output**:
  - New migration file in `/workspace/drizzle/` with format `[timestamp]_[name].sql`
  - Migration should contain `DROP TABLE` and `CREATE TABLE` statements for target tables

  **Must NOT do**:
  - DO NOT manually edit the generated migration (let Drizzle handle it)
  - DO NOT proceed if generation fails with errors

  **Parallelizable**: NO (depends on task 1 schema changes)

  **References**:

  **Pattern References** (existing code to follow):
  - `/workspace/drizzle/0000_puzzling_sphinx.sql` - Example of initial migration format
  - `/workspace/drizzle/0001_ambiguous_grandmaster.sql` - Example of secondary migration format
  - `/workspace/package.json:15-16` - NPM scripts for db:generate and db:migrate

  **WHY Each Reference Matters**:
  - Existing migration files show the expected format and structure
  - The NPM scripts confirm the exact commands to run

  **Acceptance Criteria**:
  - [ ] New migration file created successfully
  - [ ] Migration contains all 6 table modifications
  - [ ] Migration uses `bigserial` for primary keys
  - [ ] Migration has correct foreign key types
  - [ ] No syntax errors in migration SQL

  **Manual Execution Verification**:
  - [ ] Run: `pnpm db:generate`
  - [ ] Expected: Success message with migration file path
  - [ ] Verify: Run `ls -la /workspace/drizzle/*.sql | tail -1` to see the newest migration
  - [ ] Read the new migration file, confirm:
    - Tables use `bigserial` for primary keys
    - Foreign keys are correct
    - Mixed-type foreign keys use `text`
  - [ ] Command output shows: New migration created successfully

  **Commit**: NO (wait for migration application)

---

- [ ] 5. Apply Migration (Drop and Recreate Database)

  **What to do**:
  - Apply the generated migration to the database
  - This will DROP existing tables and RECREATE with new schema
  - Verify the new schema is correct

  **Commands**:
  ```bash
  pnpm db:migrate
  ```

  **Expected Outcome**:
  - All 6 target tables are recreated with `bigserial` IDs
  - Foreign key constraints are correctly established
  - Mixed-type foreign keys work (bigint → text references)

  **Must NOT do**:
  - DO NOT proceed if migration fails
  - DO NOT manually drop tables (let the migration handle it)
  - DO NOT worry about data loss (user approved drop and recreate)

  **Parallelizable**: NO (depends on task 4 migration generation)

  **References**:

  **Pattern References** (existing code to follow):
  - `/workspace/doc/planning/DATABASE.md` - Migration workflow and authority
  - `/workspace/README.md:21-23` - Quick start database setup
  - `/workspace/services/price-service/README.md` - Schema authority note (Go doesn't define schema)

  **WHY Each Reference Matters**:
  - DATABASE.md confirms the migration workflow
  - Schema authority note confirms Drizzle is the source of truth

  **Acceptance Criteria**:
  - [ ] Migration applies successfully
  - [ ] No errors in migration output
  - [ ] Database schema reflects bigint IDs for all 6 target tables
  - [ ] Foreign key constraints exist and are valid
  - [ ] Can connect to database and query tables

  **Manual Execution Verification**:
  - [ ] Run: `pnpm db:migrate`
  - [ ] Expected: Migration success message (e.g., "Migrations completed successfully")
  - [ ] Verify: Connect to database (psql) and run:
    ```sql
    \d ingestion_runs
    \d ingestion_files
    \d ingestion_errors
    \d product_match_audit
    \d store_item_state
    \d store_item_price_periods
    ```
  - [ ] Verify each table shows: `id | bigint | not null default nextval(...)`
  - [ ] Command output contains: Success confirmation from Drizzle

  **Commit**: YES (first commit)
  - Message: `feat(db): migrate high-volume tables from CUID2 to bigint IDs`
  - Files: `src/db/schema.ts`, all affected TypeScript files, new migration in `/workspace/drizzle/`
  - Pre-commit: `pnpm build` and `pnpm test` (if tests exist)

---

- [ ] 6. Write TypeScript Tests for Bigint IDs

  **What to do**:
  - Create or update tests to verify bigint ID handling
  - Test ID creation, querying, and foreign key relationships
  - Test mixed-type foreign keys (bigint → text)

  **Test Files to Create/Update**:
  - `/workspace/src/db/queries/stores.test.ts` - Update if queries affected
  - Create new test file: `/workspace/src/db/queries/ingestion.test.ts` - Test ingestion tables
  - Update `/workspace/src/orpc/router/__tests__/stores-integration.test.ts` if needed

  **Test Cases**:
  - Create records in affected tables (ID should be bigint)
  - Query records by ID (bigint should work correctly)
  - Test foreign key relationships:
    - Same-type: `ingestion_files` → `ingestion_runs` (bigint → bigint)
    - Mixed-type: `ingestion_files` → `sources` (bigint → text)
    - Mixed-type: `store_item_state` → `stores` (bigint → text)
  - Test TypeScript type safety (no implicit string ↔ bigint conversions)

  **Must NOT do**:
  - DO NOT modify tests for low-volume tables
  - DO NOT break existing passing tests

  **Parallelizable**: NO (depends on task 5 migration being applied)

  **References**:

  **Pattern References** (existing code to follow):
  - `/workspace/src/db/queries/stores.test.ts:1-100` - Existing test patterns
  - `/workspace/src/orpc/router/__tests__/stores-integration.test.ts:1-50` - Integration test patterns
  - `/workspace/src/orpc/router/__tests__/stores-mutations.test.ts:1-50` - Mutation test patterns

  **Test References** (testing patterns to follow):
  - `/workspace/src/db/queries/stores.test.ts:describe("getStores")` - Query test structure
  - Vitest docs: `https://vitest.dev/guide/` - Vitest testing framework

  **WHY Each Reference Matters**:
  - Existing test files show the patterns and conventions used in this codebase
  - Integration tests show how to test database operations end-to-end

  **Acceptance Criteria**:
  - [ ] New test file created for ingestion tables
  - [ ] Tests cover ID creation and querying
  - [ ] Tests cover same-type foreign keys
  - [ ] Tests cover mixed-type foreign keys
  - [ ] `pnpm test` runs successfully with all tests passing

  **Manual Execution Verification**:
  - [ ] Run: `pnpm test`
  - [ ] Expected: All tests pass (including new tests)
  - [ ] Verify: Output shows "Test Files [N] passed ([N])" or similar success message
  - [ ] Verify: No failed tests, no skipped tests related to bigint migration
  - [ ] Command output contains: Test count and success confirmation

  **Commit**: YES
  - Message: `test(db): add bigint ID tests for high-volume tables`
  - Files: New and updated test files
  - Pre-commit: `pnpm test`

---

- [ ] 7. Write Golang Tests for Bigint IDs

  **What to do**:
  - Create or update tests to verify int64 ID handling
  - Test model struct changes and database operations
  - Test mixed-type foreign keys (int64 → string)

  **Test Files to Create/Update**:
  - Update `/workspace/services/price-service/internal/database/models_test.go` (if exists)
  - Update `/workspace/services/price-service/tests/integration/chains_test.go` if affected
  - Create new test: `/workspace/services/price-service/internal/database/models_bigint_test.go`

  **Test Cases**:
  - Model struct field types are int64 (not string)
  - Database scanning reads int64 IDs correctly
  - Insert operations with int64 IDs work
  - Foreign key constraints:
    - Same-type: IngestionFile → IngestionRun (int64 → int64)
    - Mixed-type: IngestionFile → Source (int64 → string)
  - JSON serialization of int64 IDs

  **Must NOT do**:
  - DO NOT modify tests for low-volume tables
  - DO NOT break existing passing tests
  - DO NOT create tests that rely on specific ID values (use auto-generated)

  **Parallelizable**: NO (depends on task 5 migration being applied)

  **References**:

  **Pattern References** (existing code to follow):
  - `/workspace/services/price-service/tests/unit/parsers_test.go:1-50` - Unit test patterns
  - `/workspace/services/price-service/tests/integration/chains_test.go:1-100` - Integration test patterns
  - `/workspace/services/price-service/internal/optimizer/single_test.go:1-50` - Test setup patterns

  **Test References** (testing patterns to follow):
  - `/workspace/services/price-service/tests/integration/chains_test.go:TestChains` - Integration test structure
  - testify docs: `https://pkg.go.dev/github.com/stretchr/testify` - Go testing assertions

  **WHY Each Reference Matters**:
  - Test files show how to use testify and testcontainers in this codebase
  - Integration tests show how to set up test database connections

  **Acceptance Criteria**:
  - [ ] New or updated tests cover int64 ID handling
  - [ ] Tests verify struct field types are int64
  - [ ] Tests verify database operations with int64
  - [ ] Tests cover mixed-type foreign keys
  - [ ] `go test ./internal/...` runs successfully with all tests passing

  **Manual Execution Verification**:
  - [ ] Run: `cd services/price-service && go test ./internal/... -v`
  - [ ] Expected: All tests pass (including new tests)
  - [ ] Verify: Output shows "PASS" for all test cases
  - [ ] Verify: Output shows test count summary (e.g., "ok  github.com/kosarica/price-service/internal/...")
  - [ ] Command output contains: Success confirmation with test count

  **Commit**: YES
  - Message: `test(db): add int64 ID tests for high-volume tables`
  - Files: New and updated Go test files
  - Pre-commit: `go test ./internal/...`

---

- [ ] 8. Verify Full Integration - Application Startup

  **What to do**:
  - Verify the full application starts successfully with the new schema
  - Verify TypeScript frontend and Golang service can both connect
  - Verify basic operations work (create, read, update with new ID types)

  **Steps**:
  1. Start PostgreSQL database
  2. Apply migrations (if not already done)
  3. Start Golang price service
  4. Start Node.js frontend application
  5. Perform basic operations through API

  **Manual Test Cases**:
  - Create an ingestion run (should get bigint ID)
  - Create an ingestion file referencing that run (bigint FK)
  - Create ingestion error referencing that run (bigint FK)
  - Create store item state (bigint ID, with mixed-type FKs)
  - Query records by ID to ensure bigint works correctly

  **Must NOT do**:
  - DO NOT skip this step - full integration verification is critical
  - DO NOT consider the migration complete until this passes

  **Parallelizable**: NO (final verification, depends on all previous tasks)

  **References**:

  **Pattern References** (existing code to follow):
  - `/workspace/README.md:21-27` - Quick start commands
  - `/workspace/services/price-service/README.md:28-40` - Running the server
  - `/workspace/src/orpc/router/__tests__/price-service.integration.test.ts:1-100` - Integration test patterns

  **API References** (to test):
  - `/workspace/doc/planning/API.md` - API endpoint documentation

  **WHY Each Reference Matters**:
  - Quick start shows the exact commands to start both services
  - API docs show which endpoints to test for verification

  **Acceptance Criteria**:
  - [ ] Golang service starts successfully
  - [ ] Node.js frontend starts successfully
  - [ ] Can create records with bigint IDs
  - [ ] Can query records by bigint ID
  - [ ] Foreign key constraints work (both same-type and mixed-type)
  - [ ] No errors in logs from either service

  **Manual Execution Verification**:

  **Start Golang Service**:
  - [ ] Command: `cd services/price-service && go run cmd/server/main.go`
  - [ ] Expected: Service starts on port 8080
  - [ ] Verify: Output shows "Starting server on :8080" or similar
  - [ ] Verify: Run `curl http://localhost:8080/internal/health` → 200 OK

  **Start Node.js Application** (new terminal):
  - [ ] Command: `pnpm dev`
  - [ ] Expected: Application starts on port 3000
  - [ ] Verify: Output shows Vite dev server ready

  **Test API Operations**:
  - [ ] Test health check: `curl http://localhost:8080/internal/health`
  - [ ] Expected: `{"status":"ok"}` or similar
  - [ ] Verify: Can list ingestion runs via API (even if empty)
  - [ ] Verify: Can trigger an ingestion (even if fails due to no data)
  - [ ] Command output contains: 200 status codes for successful requests

  **Evidence Required**:
  - [ ] Copy terminal output from Golang service startup
  - [ ] Copy terminal output from Node.js app startup
  - [ ] Copy curl response(s) showing API calls working
  - [ ] Screenshot: No (console output is sufficient)

  **Commit**: YES (final commit)
  - Message: `test(integration): verify full application with bigint IDs`
  - Files: Any configuration changes if needed (typically none)
  - Pre-commit: `pnpm build` and `go build ./cmd/server/main.go`

---

## Commit Strategy

| Task | Commit | Message | Files | Verification |
|------|--------|---------|-------|--------------|
| 1-5 | YES | `feat(db): migrate high-volume tables from CUID2 to bigint IDs` | src/db/schema.ts, affected TS files, migration | pnpm build |
| 6 | YES | `test(db): add bigint ID tests for high-volume tables` | TS test files | pnpm test |
| 7 | YES | `test(db): add int64 ID tests for high-volume tables` | Go test files | go test ./... |
| 8 | YES | `test(integration): verify full application with bigint IDs` | Config (if any) | pnpm build, go build |

---

## Success Criteria

### Verification Commands

**TypeScript**:
```bash
pnpm build        # Expected: Build succeeds
pnpm test         # Expected: All tests pass
```

**Golang**:
```bash
cd services/price-service
go build ./cmd/server/main.go  # Expected: Build succeeds
go test ./internal/...         # Expected: All tests pass
```

**Database**:
```bash
pnpm db:generate  # Expected: Migration generated
pnpm db:migrate   # Expected: Migration applied successfully
psql -d kosarica  # Expected: Can connect and query tables
```

**Integration**:
```bash
# Terminal 1
cd services/price-service && go run cmd/server/main.go  # Expected: Server starts on :8080

# Terminal 2
pnpm dev  # Expected: App starts on :3000

# Terminal 3
curl http://localhost:8080/internal/health  # Expected: 200 OK
```

### Final Checklist

- [ ] All 6 high-volume tables use `bigserial` primary keys
- [ ] Foreign keys to changed tables use `bigint`
- [ ] Mixed-type foreign keys (bigint → text) work correctly
- [ ] TypeScript types use `bigint` for affected IDs
- [ ] Golang structs use `int64` for affected IDs
- [ ] All TypeScript tests pass
- [ ] All Golang tests pass
- [ ] Application starts successfully (both services)
- [ ] Can create and query records with bigint IDs
- [ ] No errors in logs
- [ ] Low-volume tables remain unchanged (still use CUID2)
- [ ] Price fields remain unchanged (still use integer)

---

## Risk Mitigation

### Known Risks

1. **Mixed-type Foreign Keys**: bigint IDs referencing CUID2 text IDs
   - **Mitigation**: Test all foreign key relationships explicitly
   - **Rollback**: If fails, keep using CUID2 for affected tables too

2. **Sequence Reset**: Starting IDs from 1, not preserving old ID range
   - **Impact**: None - user approved drop and recreate
   - **No action needed**

3. **JSON Serialization**: JavaScript `bigint` vs JSON number
   - **Mitigation**: TypeScript bigint serializes correctly in modern runtimes
   - **Verification**: Test API endpoints returning bigint IDs

4. **Query Performance**: bigint vs text index performance
   - **Impact**: Expected improvement, not degradation
   - **Monitoring**: Check query plans after migration

### Rollback Plan

If migration fails or introduces issues:

1. **Drop new tables**:
   ```sql
   DROP TABLE IF EXISTS ingestion_runs CASCADE;
   DROP TABLE IF EXISTS ingestion_files CASCADE;
   DROP TABLE IF EXISTS ingestion_errors CASCADE;
   DROP TABLE IF EXISTS product_match_audit CASCADE;
   DROP TABLE IF EXISTS store_item_state CASCADE;
   DROP TABLE IF EXISTS store_item_price_periods CASCADE;
   ```

2. **Restore original schema**:
   - Revert `/workspace/src/db/schema.ts` to previous version
   - Revert Golang model changes
   - Revert TypeScript type changes
   - Run `pnpm db:generate` to create rollback migration
   - Run `pnpm db:migrate` to apply rollback

3. **Restore data** (if needed):
   - Not applicable - user approved drop and recreate

---

## Notes

- **CUID2 dependency**: Since we're dropping CUID2 for these tables, verify no CUID2 library calls remain in affected code paths
- **ID generation**: No custom ID generation code needed - PostgreSQL `bigserial` handles it
- **Timestamps**: No changes to timestamp fields - they remain as `timestamp with time zone`
- **Prices**: No changes to price fields - they remain as `integer` (cents/lipa)
- **Future**: If all tables eventually migrate to bigint, mixed-type foreign keys will be eliminated
