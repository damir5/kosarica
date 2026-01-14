# Codebase Concerns

**Analysis Date:** 2026-01-14

## Tech Debt

**Type Safety Bypasses:**
- Issue: 17 `eslint-disable` directives and explicit `any` types
- Files: `src/ingestion/core/persist.ts` (lines 38-47), `src/ingestion/core/sql.ts` (lines 18-19, 59, 90, 112)
- Why: Drizzle ORM + D1 TypeScript compatibility issues
- Impact: Reduced type safety for database operations
- Fix approach: Create branded types or wrapper functions with proper typing

**Build-time Config at Runtime:**
- Issue: `VITE_APP_NAME` accessed from `process.env` instead of `import.meta.env`
- File: `src/config/serverConfig.ts` (line 13)
- Why: Developer oversight
- Impact: Variable won't exist at runtime, silent failures
- Fix approach: Use `import.meta.env.VITE_APP_NAME`

## Known Bugs

**No Critical Bugs Detected**

The codebase appears stable. Potential edge cases identified but not confirmed as bugs:

**Potential Race Condition in Concurrent Processing:**
- Symptoms: Multiple workers could process same store simultaneously
- Trigger: High concurrency during ingestion runs
- Workaround: Database-level locking via SQLITE_BUSY retry
- Root cause: No application-level locking for store processing

## Security Considerations

**External API Calls Without Timeout:**
- Risk: Nominatim geocoding API could hang indefinitely
- File: `src/ingestion/services/geocoding.ts` (lines 55-59)
- Current mitigation: None
- Recommendations: Add `AbortController` with 5-10s timeout

**Hardcoded User-Agent with Email:**
- Risk: Exposes contact email in HTTP headers
- File: `src/ingestion/services/geocoding.ts` (line 26)
- Current mitigation: Email is generic (`price-tracker@example.com`)
- Recommendations: Move to environment variable

**Auth Secret Requirements:**
- Risk: No validation message for `BETTER_AUTH_SECRET` length
- File: `.dev.vars.example`
- Current mitigation: Better Auth fails on short secrets
- Recommendations: Add documentation about 32+ character requirement

## Performance Bottlenecks

**No Critical Bottlenecks Detected**

The codebase implements good patterns:
- Batch processing with `computeBatchSize()` respecting D1 limits
- Rate limiting for external API calls
- Chunked processing for large files
- Queue-based async processing

**Potential Improvement Areas:**

**Static Regex Patterns:**
- Problem: Regex patterns recreated per adapter instance
- File: `src/ingestion/chains/base.ts` (lines 70-73)
- Measurement: Minimal impact, but unnecessary
- Cause: Patterns defined as instance properties
- Improvement path: Make static class properties

## Fragile Areas

**Ingestion Pipeline Message Routing:**
- File: `src/ingestion/worker.ts`
- Why fragile: Large switch/if chain for message type routing
- Common failures: Adding new message type without handler
- Safe modification: Follow existing pattern, add type guard
- Test coverage: `worker-zip-fanout.test.ts` covers key paths

**Database Batch Operations:**
- File: `src/ingestion/core/persist.ts`
- Why fragile: Complex batch size calculation for D1 limits
- Common failures: Exceeding 100 parameter limit
- Safe modification: `computeBatchSize()` helper handles this
- Test coverage: Comprehensive tests in `persist.test.ts`

## Scaling Limits

**Cloudflare D1:**
- Current capacity: SQLite-based, single-region
- Limit: Unknown transaction limits, no documented max
- Symptoms at limit: SQLITE_BUSY errors (handled with retry)
- Scaling path: Already implements retry with exponential backoff

**Cloudflare Queues:**
- Current capacity: Up to 100 messages per batch
- Limit: Standard Cloudflare Workers limits
- Symptoms at limit: Message processing delays
- Scaling path: Dead letter queue already implemented

## Dependencies at Risk

**No High-Risk Dependencies Detected**

All major dependencies are actively maintained:
- React 19.2.3 (current)
- TanStack ecosystem (actively developed)
- Drizzle ORM (actively developed)
- Better Auth (actively developed)

## Missing Critical Features

**Transaction Boundaries:**
- Problem: Batched inserts not wrapped in transactions
- File: `src/ingestion/core/persist.ts` (line 1719)
- Current workaround: Retry on failure, signature deduplication prevents duplicates
- Blocks: Could leave partial data on failure
- Implementation complexity: Low (wrap in `db.transaction()`)

## Test Coverage Gaps

**API Endpoints Untested:**
- What's not tested: `src/orpc/router/*.ts` handlers
- Risk: API behavior changes undetected
- Priority: Medium
- Difficulty to test: Low (ORPC provides good testing patterns)

**Auth Components Untested:**
- What's not tested: `src/components/auth/LoginForm.tsx`, `SetupWizard.tsx`
- Risk: Auth UI breaks silently
- Priority: Medium
- Difficulty to test: Medium (requires React Testing Library)

**Parser Edge Cases:**
- What's not tested: Edge cases in XML/XLSX parsing
- Risk: Malformed files cause unhandled errors
- Priority: Low (current parsers handle errors gracefully)
- Difficulty to test: Low (add test files with edge cases)

**Test Files (5 total for 33K lines):**
- `src/ingestion/__tests__/worker-zip-fanout.test.ts` - 968 lines
- `src/ingestion/chains/chains.test.ts` - 2,007 lines
- `src/ingestion/core/store-resolution.test.ts` - 1,011 lines
- `src/ingestion/core/persist.test.ts` - 1,093 lines
- `src/db/queries/stores.test.ts`

**Well Tested:**
- Price signature deduplication (comprehensive)
- Chain adapters and parsing
- Store resolution logic
- Queue message processing

---

*Concerns audit: 2026-01-14*
*Update as issues are fixed or new ones discovered*
