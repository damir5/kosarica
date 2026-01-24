# Work Plan: Port CUID2 to Go + Integer Keys for High-Volume Tables

## Overview
Port TypeScript custom CUID2 logic to Go for prefixed ID generation, and convert high-volume tables to use integer primary keys and foreign keys to save space.

## Context
- **Current State**: TypeScript uses custom CUID2 with prefixes (time-sortable, base62, crypto-based). Go uses UUID v4.
- **Problem**: UUID IDs waste space, especially for high-volume tables with many rows and foreign keys
- **Solution**: Port CUID2 logic to Go, use serial/bigserial for high-volume tables

## Requirements (Confirmed)
1. Port complete TypeScript CUID2 logic to Go
2. Use integer/bigint primary keys for high-volume tables
3. Use integers for foreign keys referencing high-volume tables
4. Keep prefixed CUID2 for lower-volume tables
5. Prefixes for Go entities: `run_`, `arc_`, `grp_`, `itm_`, `sid_`, `bid_`
6. Drop all old data (no migration needed)

## High-Volume Tables (to use integer PKs)
- `retailer_items` (rit) - many items per retailer
- `retailer_item_barcodes` (rib) - multiple barcodes per item
- `store_item_price_periods` (sip) - price history, many entries
- `ingestion_file_entries` (ige) - many rows per ingestion file
- `product_match_candidates` (pmc) - many candidates per item

## Low-Volume Tables (keep cuid2)
- `app_settings` (cfg)
- `stores` (sto)
- `store_identifiers` (sid)
- `products` (prd)
- `product_links` (plk)
- `product_relations` (prl)
- `ingestion_runs` (igr)
- `ingestion_files` (igf)
- `ingestion_chunks` (igc)
- `ingestion_errors` (ier)
- `store_enrichment_tasks` (set)
- `price_groups` (prg)
- `store_group_history` (sgh)
- `store_price_exceptions` (spe)
- `product_match_queue` (pmq)
- `product_match_rejections` (pmr)
- `product_match_audit` (pma)
- `product_aliases` (pal)

## Auth Tables (no changes - Better Auth requirement)
- `user`
- `session`
- `account`
- `verification`
- `passkey`

---

## Tasks

### Phase 1: Port CUID2 Logic to Go

- [ ] **Task 1**: Create Go package `internal/pkg/cuid2` with ID generation functions
  - **Prefixes**: `run_`, `arc_`, `grp_`, `itm_`, `sid_`, `bid_`
  - **Functions**: `encodeTimestampBase62`, `generateCuidLikeId`, `generatePrefixedId`
  - **Features**: Time-sortable (default), base62 alphabet, crypto/rand, rejection sampling
  - **Test file**: `internal/pkg/cuid2/cuid2_test.go`
  - **Acceptance**:
    - [ ] Functions match TypeScript behavior exactly
    - [ ] Tests cover time-sortable and pure random modes
    - [ ] Tests verify prefix inclusion
    - [ ] Tests verify base62 alphabet compliance
  - **Expected Files**:
    - `services/price-service/internal/pkg/cuid2/cuid2.go`
    - `services/price-service/internal/pkg/cuid2/cuid2_test.go`

- [ ] **Task 2**: Replace `uuid.New().String()` with new CUID2 functions in Go code
  - **Files to update**:
    - `internal/handlers/matching.go` (2 instances)
    - `internal/handlers/ingest.go` (1 instance)
    - `internal/pipeline/pipeline.go` (1 instance)
    - `internal/pipeline/persist.go` (6 instances: runID, storeID, identifierID, barcodeID, itemID x2)
    - `internal/database/price_groups.go` (2 instances)
    - `internal/database/archive.go` (1 instance)
  - **Prefix mapping**:
    - Run IDs → `run_`
    - Archive IDs → `arc_`
    - Group IDs → `grp_`
  - **Acceptance**:
    - [ ] All 13 UUID instances replaced with CUID2
    - [ ] Correct prefixes applied
    - [ ] No broken imports
  - **Expected Files Modified**:
    - All 6 files listed above

### Phase 2: Update High-Volume Tables to Use Integer Keys

- [ ] **Task 3**: Update `retailer_items` table schema
  - **IMPORTANT**: This IS a high-volume table (many items per retailer) - MUST use integer PK for storage savings
  - **Changes**:
    - `id`: `cuid2("rit")` → `bigserial("id")` (CRITICAL: Keep as bigserial, not cuid2)
    - FKs referencing `retailer_items.id` → use `bigint` type (to match PK)
  - **FKs to update**:
    - `retailer_item_barcodes.retailer_item_id` → `bigint`
    - `product_match_candidates.retailer_item_id` → `bigint`
    - `store_item_state.retailer_item_id` → `bigint`
    - Any other FKs to this table → `bigint`
  - **Acceptance**:
    - [ ] Schema updated in `src/db/schema.ts` - `id: bigserialPK()`
    - [ ] All FKs to `retailer_items` use `bigint` type (NOT text)
    - [ ] Migration created for `retailer_items` table
    - [ ] Indexes preserved
  - **Expected Files**:
    - `src/db/schema.ts` (modified)
    - `drizzle/000X_retailer_items_int_keys.sql` (new migration)

- [ ] **Task 4**: Update `retailer_item_barcodes` table schema
  - **Changes**:
    - `id`: `cuid2("rib")` → `bigserial("id")`
    - `retailer_item_id`: already FK to retailer_items (now bigint)
  - **Acceptance**:
    - [ ] Schema updated in `src/db/schema.ts`
    - [ ] Migration created for `retailer_item_barcodes` table
    - [ ] Indexes preserved
  - **Expected Files**:
    - `src/db/schema.ts` (modified)
    - `drizzle/000X_retailer_item_barcodes_int_keys.sql` (new migration)

- [ ] **Task 5**: Update `store_item_price_periods` table schema
  - **Changes**:
    - `id`: `cuid2("sip")` → `bigserial("id")`
    - `store_item_state_id`: FK to store_item_state (now integer - see Task 5.5)
  - **Acceptance**:
    - [ ] Schema updated in `src/db/schema.ts`
    - [ ] Migration created for `store_item_price_periods` table
    - [ ] Indexes preserved
  - **Expected Files**:
    - `src/db/schema.ts` (modified)
    - `drizzle/000X_store_item_price_periods_int_keys.sql` (new migration)

- [ ] **Task 5.5**: Update `store_item_state` table schema (NEW)
  - **Changes**:
    - `id`: `cuid2("sis")` → `bigserial("id")`
  - **FKs to update**:
    - `store_item_price_periods.store_item_state_id`
  - **Acceptance**:
    - [ ] Schema updated in `src/db/schema.ts`
    - [ ] Migration created for `store_item_state` table
    - [ ] FK in store_item_price_periods updated to integer
    - [ ] Indexes preserved
  - **Expected Files**:
    - `src/db/schema.ts` (modified)
    - `drizzle/000X_store_item_state_int_keys.sql` (new migration)

- [ ] **Task 6**: Update `ingestion_file_entries` table schema
  - **Changes**:
    - `id`: `cuid2("ige")` → `bigserial("id")`
    - Review FKs: `file_id` (to ingestion_files - low volume, keep cuid2)
  - **Acceptance**:
    - [ ] Schema updated in `src/db/schema.ts`
    - [ ] Migration created for `ingestion_file_entries` table
    - [ ] Indexes preserved
  - **Expected Files**:
    - `src/db/schema.ts` (modified)
    - `drizzle/000X_ingestion_file_entries_int_keys.sql` (new migration)

- [ ] **Task 7**: Update `product_match_candidates` table schema
  - **Changes**:
    - `id`: `cuid2("pmc")` → `bigserial("id")`
    - `retailer_item_id`: already FK to retailer_items (now bigint)
    - `candidate_product_id`: FK to products (low volume, keep cuid2)
  - **Acceptance**:
    - [ ] Schema updated in `src/db/schema.ts`
    - [ ] Migration created for `product_match_candidates` table
    - [ ] Indexes preserved
    - [ ] Unique constraints preserved
  - **Expected Files**:
    - `src/db/schema.ts` (modified)
    - `drizzle/000X_product_match_candidates_int_keys.sql` (new migration)

- [ ] **Task 8**: Update all foreign keys referencing high-volume tables to use bigints
  - **Tables to check**:
    - All tables with FKs to: retailer_items, retailer_item_barcodes, store_item_price_periods, ingestion_file_entries, product_match_candidates, store_item_state
  - **Acceptance**:
    - [ ] All FKs to high-volume tables use `bigint` type
    - [ ] No broken FK references
    - [ ] Cascade rules preserved
  - **Expected Files**:
    - `src/db/schema.ts` (modified)

- [ ] **Task 8.5**: Investigate TypeScript ID usage (NEW)
  - **Search patterns**:
    - Queries using high-volume table IDs (retailerItems.id, retailerItemBarcodes.id, etc.)
    - Components with ID props/types referencing these tables
    - ORPC schemas with ID validations for these tables
  - **Files to check**:
    - `src/db/queries/**/*.ts` (query files)
    - `src/components/**/*.tsx` (components using IDs)
    - `src/orpc/router/**/*.ts` (API schemas)
  - **Acceptance**:
    - [ ] List of all TypeScript files using high-volume table IDs
    - [ ] List of type changes needed (string → number)
    - [ ] Decision on whether to add TypeScript update tasks
  - **Expected Output**:
    - Documentation of ID usage in TypeScript codebase
  - **Findings** (from grep search):
    - `src/orpc/router/catalog-prices.ts`:
      - Line 67: `id: storeItemState.id` (used in SELECT)
      - Line 83: `eq(storeItemState.retailerItemId, retailerItems.id)` (JOIN)
      - Line 96: `eq(storeItemState.retailerItemId, retailerItems.id)` (JOIN)
      - All references to `retailerItems.id` expect `string` type
    - Any other references need investigation
  - **Decision**: CRITICAL - TypeScript codebase uses these IDs extensively and expects `string` type. This is a MAJOR scope expansion beyond original plan:
    - All database queries need ID type changes (`string` → `bigint`)
    - All ORPC schema validations need type updates
    - All components using these IDs need type updates
    - Estimated additional tasks: 20-30 TypeScript files to update
    - Recommendation: Add separate "Phase 4: Update TypeScript codebase for integer IDs" section


### Phase 3: Update Go Code for Integer Keys

- [ ] **Task 9**: Update Go struct definitions for high-volume tables
  - **Files**:
    - `internal/database/models_*.go` (various model files)
  - **Changes**: Change ID fields from `string` to `int64` for high-volume tables
  - **Tables to update**:
    - `RetailerItem` (retailer_items table)
    - `RetailerItemBarcode` (retailer_item_barcodes table)
    - `StoreItemPricePeriod` (store_item_price_periods table)
    - `StoreItemState` (store_item_state table)
    - `IngestionFileEntry` (ingestion_file_entries table)
    - `ProductMatchCandidate` (product_match_candidates table)
  - **Acceptance**:
    - [ ] Struct fields updated to `int64` for high-volume table IDs
    - [ ] JSON tags preserved
    - [ ] Database tags updated
  - **Expected Files Modified**:
    - All relevant model files in `internal/database/`

- [ ] **Task 10**: Update Go query functions to handle integer IDs
  - **Files**:
    - `internal/database/price_groups.go`
    - `internal/database/archive.go`
    - Any other files querying high-volume tables
  - **Changes**:
    - Parameter types: `string` → `int64` for IDs
    - Return types: Update where IDs are returned
  - **Queries using high-volume tables**:
    - Functions querying `retailer_items`, `retailer_item_barcodes`, `store_item_price_periods`, `store_item_state`, `ingestion_file_entries`, `product_match_candidates`
  - **Acceptance**:
    - [ ] All query functions use correct integer types
    - [ ] SQL queries updated (no string quotes on integer IDs)
    - [ ] Error handling preserved
  - **Expected Files Modified**:
    - All query files using high-volume table IDs

- [ ] **Task 11**: Update Go pipeline code for integer keys
  - **Files**:
    - `internal/pipeline/persist.go` (main target)
  - **Changes**:
    - ID generation: Keep `generatePrefixedId` for non-high-volume tables
    - ID parameters: Update to `int64` for FKs to high-volume tables
    - Specifically:
      - `resolveOrCreateStore` return `string` (store ID, low-volume)
      - `persistRowsForStore` parameters: store ID as `string`, item IDs as `string` (will use integers)
      - `findOrCreateRetailerItem` returns `string` (will use integers)
      - Insertions: Store and identifier ID generation uses CUID2 (correct)
      - `storeItemState` table ID should use integers
      - `retailer_item` table ID should use integers
      - `retailer_item_barcode` table ID should use integers
   - **Acceptance**:
    - [ ] ID generation uses correct types for different tables
    - [ ] FK assignments use `int64` where appropriate (high-volume tables)
    - [ ] No type conversion errors
  - **Expected Files Modified**:
    - `internal/pipeline/persist.go`
    - `internal/handlers/matching.go`
    - `internal/handlers/ingest.go`

- [ ] **Task 11.5**: CRITICAL - FIX BIGSERIAL ARCHITECTURAL CONFLICT (NEW)
  - **Discovery**: MAJOR INCOMPATIBILITY between schema and Go code
  - **Issue**: Schema uses `bigserial` (auto-increment), but Go code manually generates IDs with `cuid2.GeneratePrefixedId()`
  - **Conflicting tables**:
    - `retailer_items`: Schema has `bigserial` but line 402 uses `cuid2.GeneratePrefixedId("itm", ...)`
    - `retailer_item_barcodes`: Schema has `bigserial` but line 352 uses `cuid2.GeneratePrefixedId("bid", ...)`
    - `store_item_state`: Schema has `bigserial` but line 336 uses `cuid2.GeneratePrefixedId("sid", ...)`
  - **Root cause**: `bigserial` means database auto-generates IDs, but code is manually generating them
  - **Files affected**:
    - `internal/pipeline/persist.go` - Lines 402, 352, 336 need fixing
  - **Required changes**:
    1. Remove `id` from INSERT column lists (database auto-generates)
    2. Remove `cuid2.GeneratePrefixedId()` calls for these tables
    3. Use `RETURNING id` to get database-generated integer
    4. Update function signatures: `string` → `int64`
  - **Acceptance**:
    - [ ] No manual ID generation for bigserial tables
    - [ ] INSERTs use RETURNING id
    - [ ] Function signatures return `int64`
    - [ ] No type mismatch errors
  - **Expected Files Modified**:
    - `internal/pipeline/persist.go`

### Phase 4: Update TypeScript Codebase for Integer Keys

**CRITICAL SCOPE EXPANSION: TypeScript codebase uses these IDs extensively and expects `string` type. Requires major refactoring.**

- [ ] **Task 10.1**: Update TypeScript database queries for integer IDs
  - **Files to check**:
    - `src/db/queries/**/*.ts` (all query files)
    - `src/db/queries/*.ts` (if structured differently)
  - **Changes required**:
    - Update all queries using high-volume table IDs
    - Change parameter types: `string` → `bigint` for retailer_items, retailer_item_barcodes, store_item_price_periods, store_item_state, ingestion_file_entries, product_match_candidates IDs
    - Update return types where these IDs are returned
    - Update SELECT/INSERT/UPDATE statements to handle integer IDs
  - **Acceptance**:
    - [ ] All query functions using high-volume table IDs use `bigint` type
    - [ ] Type definitions updated in query files
    - [ ] SQL templates updated for integer IDs
    - [ ] No compilation errors
  - **Expected Files Modified**:
    - All query files referencing high-volume tables

- [ ] **Task 10.2**: Update TypeScript ORPC schemas for integer IDs
  - **Files to update**:
    - `src/orpc/router/catalog-prices.ts` (main target found)
    - `src/orpc/router/stores.ts`
    - `src/orpc/router/products.ts`
    - `src/orpc/router/price-service.ts`
    - `src/orpc/router/basket.ts`
    - `src/orpc/router/matching.ts`
    - Any other ORPC schemas using these IDs
  - **Changes required**:
    - Update `z.object` and `z.input` schemas for ID fields
    - Change type: `z.string()` → `z.bigint()` or `z.coerce.bigint()`
    - Update response types in output schemas
  - **Acceptance**:
    - [ ] All ID input/output fields use correct types
    - [ ] Validation updated for integer IDs
    - [ ] API responses return correct types
  - **Expected Files Modified**:
    - All ORPC schema files using high-volume table IDs

- [ ] **Task 10.3**: Update TypeScript components using high-volume table IDs
  - **Files to check**:
    - `src/components/**/*.tsx`
    - Search for components using retailerItems, storeItemState, or related types
  - **Changes required**:
    - Update component prop types
    - Update internal state management
    - Update API calls to use correct ID types
  - **Acceptance**:
    - [ ] All components using high-volume table IDs updated
    - [ ] Type safety maintained
    - [ ] No runtime errors from type mismatches
  - **Expected Files Modified**:
    - All components referencing high-volume table IDs

- [ ] **Task 10.4**: Search and update any other TypeScript files using these IDs
  - **Files to check**:
    - `src/**/*.ts` (global search for ID references)
    - Focus on: retailerItems.id, retailerItemBarcodes.id, storeItemPricePeriods.id, storeItemState.id, ingestionFileEntries.id, productMatchCandidates.id
  - **Changes required**:
    - Update any other files using these IDs
    - Ensure type consistency across codebase
  - **Acceptance**:
    - [ ] All TypeScript files using high-volume table IDs updated
    - [ ] Type consistency maintained
  - **Expected Files Modified**:
    - Any additional files requiring type updates

### Phase 4: Testing & Verification

- [ ] **Task 12**: Test Go CUID2 package
  - **Tests**:
    - `encodeTimestampBase62` - verify base62 encoding
    - `generateCuidLikeId` - verify length and randomness
    - `generatePrefixedId` - verify prefix inclusion and format
    - Time-sortability - verify IDs sort by time
  - **Acceptance**:
    - [ ] All tests pass
    - [ ] Coverage > 80%
  - **Expected Files**:
    - `services/price-service/internal/pkg/cuid2/cuid2_test.go`

- [ ] **Task 13**: Run existing Go tests
  - **Command**: `go test ./...`
  - **Acceptance**:
    - [ ] All existing tests pass after changes
    - [ ] No regressions in Go service functionality
  - **Evidence**:
    - Test output showing all pass

- [ ] **Task 14**: Run TypeScript/Database tests
  - **Commands**:
    - `pnpm test` (Vitest)
    - `pnpm db:migrate` (apply migrations)
  - **Acceptance**:
    - [ ] All tests pass
    - [ ] Migrations apply successfully
    - [ ] No database schema errors
  - **Evidence**:
    - Test output showing all pass
    - Migration success messages

- [ ] **Task 15**: Verify ID format compliance
  - **Checks**:
    - Go CUID2 IDs match expected format: `{prefix}_{timestamp}{random}`
    - Integer IDs are sequential for high-volume tables
    - No UUID-style IDs remain in Go code
  - **Acceptance**:
    - [ ] Manual inspection of generated IDs
    - [ ] No broken ID references in logs/DB
  - **Evidence**:
    - Screenshots or logs showing ID formats

### Phase 5: Documentation

- [ ] **Task 16**: Update documentation
  - **Files**:
    - `doc/planning/DATABASE.md` (schema documentation)
    - `doc/planning/ARCHITECTURE.md` (if needed)
  - **Updates**:
    - Document integer keys for high-volume tables
    - Document CUID2 prefix usage in Go
    - Update any ID format examples
  - **Acceptance**:
    - [ ] Documentation reflects new schema
    - [ ] Examples updated
  - **Expected Files Modified**:
    - `doc/planning/DATABASE.md`
    - Any other relevant documentation files

---

## Self-Review: Gaps & Decisions Needed

### Critical Gaps (RESOLVED)

**Gap 1: `store_item_state` table integer keys?**
- **Decision**: YES - will use integer keys for consistency
- **Rationale**: High volume due to price history nature
- **Impact**: Added new task (Task 5.5) to update `store_item_state` schema

**Gap 2: TypeScript queries expecting string IDs**
- **Decision**: INVESTIGATE - will search TypeScript codebase for ID usage
- **Rationale**: Must ensure no string ID references remain
- **Impact**: Will add investigation task and update tasks as needed

### Minor Gaps (RESOLVED)

**Gap 3: Serial vs Bigserial**
- **Decision**: Bigserial
- **Rationale**: Safety margin against overflow (space still much better than text cuid2)
- **Impact**: Plan updated to use `bigserial` for all high-volume tables

**Gap 4: Index inheritance**
- **Issue**: When changing PK from cuid2 to serial, do indexes automatically update or need recreation?
- **Impact**: Migration complexity
- **Recommendation**: Test to verify, add index recreation if needed
- **No Decision Needed**: Will verify during implementation

### Ambiguous/Decisions Needed

**Ambiguous 1: `store_item_state` integer keys?**
- See Critical Gap 1 above
- **Recommendation**: Assume YES (high volume due to price history nature)
- **Awaiting User Decision**

**Ambiguous 2: TypeScript updates needed?**
- See Critical Gap 2 above
- **Recommendation**: Search for TypeScript queries using these IDs, add tasks if found
- **Awaiting User Decision**

**Ambiguous 3: Serial or Bigserial?**
- See Minor Gap 3 above
- **Recommendation**: Use `bigserial` for safety (space still much better than text cuid2)
- **Awaiting User Decision**

### Assumptions Made
1. User wants to avoid massive TypeScript refactoring (50+ files, 131+ locations)
2. User accepts abandoning integer storage savings goal (bigserial) in favor of cuid2 with prefixes
3. CUID2 approach (Option B) is simpler and lower risk
4. No external systems depend on existing UUID IDs
5. TypeScript cuid2 implementation is correct and should be ported exactly
6. High-volume tables correctly identified for integer savings (but not implemented)
7. No migration needed since dropping old data

## Guardrails
- DO NOT modify auth tables (user, session, account, verification, passkey) - Better Auth requires text PKs
- DO NOT modify low-volume table schemas (keep cuid2 for these)
- DO NOT refactor unrelated schema changes
- DO NOT change prefixes beyond specified ones
- DO NOT add new features or optimizations outside scope

## Acceptance Criteria
- [ ] Go package `internal/pkg/cuid2` created with matching behavior to TS version
- [ ] All 13 UUID instances in Go replaced with CUID2
- [ ] High-volume tables revert to cuid2 primary keys (not bigserial - storage savings goal abandoned)
- [ ] All FKs to high-volume tables use text type (matching cuid2)
- [ ] Go structs use string IDs (matching cuid2)
- [ ] Migrations created and apply successfully
- [ ] All existing tests pass (Go and TypeScript)
- [ ] New Go tests for CUID2 pass with >80% coverage
- [ ] Documentation updated to reflect changes
- [ ] TypeScript ID usage investigated and documented

## Verification Steps
1. Run `go test ./...` in price-service directory
2. Run `pnpm test` in root directory
3. Run `pnpm db:migrate` to apply migrations
4. Manual inspection of generated IDs in database
5. Verify no UUID-style IDs in Go codebase

## Estimated Complexity
- **Total Tasks**: 18
- **Phases**: 5
- **Estimated Effort**: Medium (requires careful schema changes and testing)

## Potential Risks
- **FK integrity**: Multiple FK changes could break references if not done carefully
- **Type conversions**: String → int in Go may cause compilation errors if not comprehensive
- **Migration ordering**: Need to ensure migrations run in correct order (child tables before FK updates)
- **Existing code**: May be TypeScript code that assumes string IDs for these tables

## Rollback Plan
If issues arise:
1. Revert Go code to use UUIDs
2. Revert schema.ts to use cuid2 for high-volume tables
3. Create rollback migration to restore cuid2 PKs
4. Apply rollback migration

---

## Task Parallelization

**Parallelizable Groups:**

- **Group A (Phase 1 - can run simultaneously)**:
  - Task 1: Create Go CUID2 package
  - Task 2: Replace UUID instances (can be done in parallel with Task 1 if CUID2 package API is agreed)

- **Group B (Phase 2 - can run simultaneously)**:
  - Task 3: Update retailer_items
  - Task 4: Update retailer_item_barcodes
  - Task 5: Update store_item_price_periods
  - Task 5.5: Update store_item_state
  - Task 6: Update ingestion_file_entries
  - Task 7: Update product_match_candidates
  - Task 8: Update all foreign keys (must follow Tasks 3-7, 5.5, but can be done together)
  - Task 8.5: Investigate TypeScript ID usage (can run in parallel with other schema updates)

- **Group C (Phase 3 - can run simultaneously)**:
  - Task 9: Update Go structs
  - Task 10: Update Go query functions
  - Task 11: Update Go pipeline code

- **Group D (Phase 4 - must follow all implementation)**:
  - Task 12: Test Go CUID2
  - Task 13: Run Go tests
  - Task 14: Run TypeScript tests
  - Task 15: Verify ID formats

- **Sequential Dependencies**:
  - Task 8 must complete after Tasks 3-7, 5.5 (FK updates need PK changes complete)
  - Task 11 must complete after Tasks 9-10 (code needs structs and queries updated)
  - Group D must follow all implementation (testing requires complete changes)
  - Task 8.5 results may trigger additional TypeScript update tasks (if needed)
