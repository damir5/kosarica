# Staff Engineer Review Report

**Project:** Kosarica (Grocery Price Comparison Platform)  
**Date:** 2026-01-30  
**Reviewer:** Staff Engineer Review  
**Scope:** Full codebase audit - Security, Architecture, Performance, Testing, Documentation

---

## Executive Summary

The Kosarica codebase is a hybrid Node.js/Go application for grocery price comparison with **functional implementation but significant architectural and operational concerns**. The project shows signs of rapid development prioritizing feature delivery over maintainability.

**Overall Grade: C+** (Functional but requires significant refactoring)

**Critical Issues:** 12  
**High Priority:** 28  
**Medium Priority:** 45  
**Low Priority:** 32

---

## 1. Critical Issues (Fix Immediately)

### 1.1 Security - Hardcoded Admin Password
**File:** `scripts/ensure-admin.ts:12`  
**Issue:** Hardcoded password "admin123456" for development admin user  
**Risk:** CRITICAL - If deployed to production, creates immediate security breach  
**Action:** Remove hardcoded credentials, generate random passwords or require env var input

### 1.2 Performance - Task Worker Memory Leak
**File:** `src/lib/taskqueue/worker.ts:133-138`  
**Issue:** Promise reference bug - tasks never removed from `runningTasks` Set  
**Risk:** Memory leak, incorrect shutdown behavior, potential crash  
**Action:** Store promise reference before adding to Set

### 1.3 Performance - N+1 Query Pattern
**File:** `services/price-service/internal/handlers/prices.go:347-392`  
**Issue:** Queries item details individually in a loop instead of batch query  
**Risk:** Database overload with large stores (1000+ queries instead of 1)  
**Action:** Implement batch query with `WHERE id IN (...)`

### 1.4 Architecture - Global State in Go Handlers
**File:** `services/price-service/internal/handlers/optimize.go:87-92`  
**Issue:** Global optimizer variables with `InitOptimizers()` function  
**Risk:** Race conditions, testing difficulties, unclear initialization order  
**Action:** Convert to dependency injection pattern

### 1.5 Testing - Near Zero Coverage on Critical Paths
**Files:** 
- `services/price-service/internal/middleware/*` - 0% coverage
- `services/price-service/internal/adapters/chains/*` - 0% coverage (11 adapters)
- `services/price-service/internal/handlers/ingest.go` - No tests
- `src/jobs/cron/*` - 0% coverage
**Risk:** Undetected bugs in production, regression issues  
**Action:** Add tests for all middleware, chain adapters, and cron system

### 1.6 Architecture - Shared Database Anti-Pattern
**Issue:** Both Node.js and Go services share PostgreSQL database directly  
**Risk:** Cannot deploy independently, schema changes require coordination, violates microservices principles  
**Action:** Document service boundaries clearly; plan migration to API-based communication

### 1.7 Performance - Unbounded Batch Operations
**File:** `services/price-service/internal/pipeline/persist.go:354-481`  
**Issue:** No size limits on batch upserts - can exceed PostgreSQL parameter limits  
**Risk:** OOM errors, query failures with large files (100K+ rows)  
**Action:** Implement chunking (batches of 1000)

### 1.8 Performance - Large Files Loaded into Memory
**File:** `services/price-service/internal/pipeline/fetch.go:20-135`  
**Issue:** Entire file contents loaded into `[]byte`  
**Risk:** OOM with large ZIP/CSV files (100MB+)  
**Action:** Stream file content using `io.Reader` interfaces

### 1.9 Code Quality - Panic Usage in Production
**File:** `services/price-service/internal/pipeline/metrics.go:30,40,50,60`  
**Issue:** Multiple `panic(err)` calls in init function  
**Risk:** Application crashes on startup if metrics init fails  
**Action:** Replace panics with proper error handling and logging

### 1.10 Error Handling - Silent Error Discarding
**File:** `services/price-service/internal/handlers/matching.go:181-213`  
**Issue:** 8+ database query errors silently ignored using `_ = h.db.QueryRow(...).Scan(...)`  
**Risk:** Silent failures, data inconsistencies  
**Action:** Log or handle all errors properly

### 1.11 Security - X-Forwarded-For Spoofing
**File:** `services/price-service/internal/middleware/ratelimit.go:88-91`  
**Issue:** Uses `X-Forwarded-For` header directly without validation  
**Risk:** IP spoofing to bypass rate limits  
**Action:** Validate proxy trust before using header

### 1.12 Concurrency - Race Condition in Single Flight
**File:** `services/price-service/internal/optimizer/cache.go:653-679`  
**Issue:** Custom singleflight implementation with potential race conditions  
**Risk:** Cache corruption, inconsistent data  
**Action:** Use `golang.org/x/sync/singleflight` library

---

## 2. High Priority Issues

### 2.1 Architecture - Missing Repository Layer
**Issue:** Handlers directly use `sqlcgen.New(database.Pool())`  
**Impact:** Business logic mixed with data access, difficult to test  
**Action:** Create repository layer abstracting sqlcgen queries

### 2.2 Architecture - Inconsistent API Patterns
**File:** `src/orpc/router/price-service.ts`  
**Issue:** Mix of generated SDK and raw fetch calls (`goFetchWithRetry`)  
**Impact:** Inconsistent error handling, maintenance burden  
**Action:** Standardize on generated SDK exclusively

### 2.3 Performance - No Request Timeouts
**File:** `src/jobs/workers/daily-ingestion.ts:27-79`  
**Issue:** HTTP calls to Go service lack timeouts  
**Impact:** Hung workers if Go service is unresponsive  
**Action:** Add explicit timeout options (e.g., 30 seconds)

### 2.4 Performance - Sequential Chain Processing
**File:** `src/jobs/workers/daily-ingestion.ts:45-80`  
**Issue:** Chains processed sequentially with 1-second delays  
**Impact:** 50 chains take 50+ seconds unnecessarily  
**Action:** Use `Promise.all()` with concurrency limiting

### 2.5 Performance - Inefficient Search Queries
**File:** `services/price-service/internal/database/queries/prices.sql:36-68`  
**Issue:** `ILIKE '%' || query || '%'` cannot use indexes  
**Impact:** Full table scans on large tables  
**Action:** Add `pg_trgm` extension and GIN indexes

### 2.6 Code Quality - Complex Functions
**File:** `services/price-service/internal/pipeline/pipeline.go:54-364`  
**Issue:** 310-line `Run` function handling multiple phases  
**Impact:** Difficult to test, violates Single Responsibility Principle  
**Action:** Refactor into smaller, testable units

### 2.7 Documentation - Missing ADRs
**Issue:** No Architecture Decision Records for major decisions  
**Impact:** Future developers lack context for architectural choices  
**Action:** Create ADRs for: Node/Go split, price groups, task queue choice

### 2.8 Documentation - Outdated DEPLOYMENT.md
**File:** `doc/planning/DEPLOYMENT.md:36-37,100-115`  
**Issue:** References wrong port numbers (8080 vs actual 3003)  
**Impact:** Deployment failures following documentation  
**Action:** Update all port references and verify accuracy

### 2.9 Testing - Flaky Time-Dependent Tests
**File:** `services/price-service/internal/pkg/cuid2/cuid2_test.go:146-170`  
**Issue:** Uses `time.Sleep()` for ordering guarantees  
**Impact:** Tests fail on slow CI runners  
**Action:** Use mockable time source or inject timestamps

### 2.10 Testing - Sequential Test Execution
**File:** `vitest.config.ts:19-25`  
**Issue:** `singleThread: true` forces sequential execution  
**Impact:** Slow test suite  
**Action:** Fix migration conflicts and enable parallel execution

### 2.11 Code Quality - Hardcoded Magic Numbers
**Files:** Multiple files with hardcoded thresholds  
- `services/price-service/internal/handlers/matching.go:107-109` - 0.95, 0.80, 100
- `services/price-service/internal/handlers/ingest.go:22` - 10 concurrent runs
- `services/price-service/internal/optimizer/config.go:45` - 30s timeout
**Impact:** Non-configurable behavior, difficult to tune  
**Action:** Move to configuration with sensible defaults

### 2.12 Security - Path Traversal Risk
**File:** `services/price-service/internal/adapters/chains/dm.go:297`  
**Issue:** File path construction without validation  
**Impact:** Potential directory traversal  
**Action:** Add path traversal validation

### 2.13 Code Quality - Type Safety Issues
**Files:** 
- `src/db/queries/stores.ts:34` - `export type AnyDatabase = any`
- `src/orpc/router/products.ts:405,548-550` - Multiple `as any` assertions
- `src/routeTree.gen.ts:39-146` - 18 instances of `} as any)`
**Impact:** Defeats TypeScript type safety  
**Action:** Add proper types, avoid `any`

### 2.14 Architecture - Database Schema Ownership Confusion
**Issue:** Schema source of truth in TypeScript but Go service writes directly  
**Impact:** Schema changes can break Go service  
**Action:** Document ownership clearly; add CI checks for schema sync

### 2.15 Performance - Unbounded Cache Growth
**File:** `services/price-service/internal/optimizer/cache.go:71-93`  
**Issue:** No eviction policy for price cache  
**Impact:** Memory grows unbounded  
**Action:** Implement LRU eviction or use external cache (Redis)

### 2.16 Configuration - Environment Variable Chaos
**Issue:** Multiple `.env` files with different formats  
- Root: `.env`, `.env.development`, `.env.test`
- Go service: `services/price-service/.env`
**Impact:** Configuration drift, difficult to track  
**Action:** Consolidate to single source of truth

### 2.17 Documentation - Missing README Files
**Directories:** 
- `/workspace/src/` - No README
- `/workspace/services/price-service/internal/` - No README
- `/workspace/src/components/` - No README
**Impact:** Poor developer onboarding  
**Action:** Create README files explaining structure and integration

### 2.18 Code Quality - Debug Print Statements
**File:** `services/price-service/internal/pipeline/persist.go:233-238`  
**Issue:** Debug print statements in production code  
**Impact:** Log pollution, potential data leakage  
**Action:** Remove or guard with proper log levels

---

## 3. Medium Priority Issues

### 3.1 Performance - O(N^2) Store Distance Calculation
**File:** `services/price-service/internal/optimizer/cache.go:512-555`  
**Impact:** Expensive for 1000+ stores  
**Action:** Use spatial indexing (R-tree or PostGIS)

### 3.2 Performance - Inefficient Sorting
**File:** `services/price-service/internal/optimizer/multi.go:114-123`  
**Impact:** Full sort when only top K needed  
**Action:** Use `container/heap` for top-K selection

### 3.3 Code Quality - Inconsistent Naming
**Issue:** Mix of `runId`, `runID`, `RunId`, `RunID` across Go files  
**Action:** Standardize on `ID` suffix (Go convention)

### 3.4 Testing - No Test Data Factories
**Issue:** Each test manually constructs database records  
**Action:** Create test fixtures/factories in `/src/test/fixtures/`

### 3.5 Documentation - Undocumented Business Logic
**Files:**
- `services/price-service/internal/optimizer/multi.go:64-91` - Algorithm selection
- `services/price-service/internal/pipeline/persist.go:680-690` - Price review criteria
**Action:** Add inline comments explaining business rules

### 3.6 Architecture - Tight Coupling to Global Registry
**File:** `services/price-service/internal/pipeline/pipeline.go:61-62`  
**Issue:** Direct calls to `registry.InitializeDefaultAdapters()`  
**Action:** Use dependency injection for adapters

### 3.7 Security - Weak Randomness Fallback
**File:** `services/price-service/internal/pkg/cuid2/cuid2.go:24,159`  
**Issue:** Falls back to `math/rand` if `crypto/rand` fails  
**Action:** Consider failing hard instead

### 3.8 Performance - No Connection Pooling Config
**File:** `services/price-service/internal/http/client.go`  
**Issue:** HTTP client may not have optimal connection pooling  
**Action:** Configure `MaxIdleConns`, `MaxConnsPerHost`

### 3.9 Code Quality - Context Usage Issues
**Files:**
- `services/price-service/internal/handlers/ingest.go:91` - `context.Background()` in goroutine
- `services/price-service/internal/optimizer/cache.go:144,195,262` - Background context doesn't respect cancellation
**Action:** Derive from parent context properly

### 3.10 Testing - Integration Tests Skip in CI
**File:** `src/orpc/router/__tests__/price-service.integration.test.ts:16-27`  
**Issue:** Tests silently skip without Go service  
**Action:** Use testcontainers or mock Go service

---

## 4. Low Priority Issues

### 4.1 Code Quality - Unused Code
**File:** `services/price-service/internal/handlers/matching.go:296-307`  
**Issue:** Legacy wrapper functions with TODO comments  
**Action:** Remove or implement

### 4.2 Documentation - Missing Environment Variables
**File:** `.env.example`  
**Issue:** Missing `LOG_TYPES`, `PORT`, `HOST`, `STORAGE_PATH`, etc.  
**Action:** Document all used environment variables

### 4.3 Performance - Retries Without Backoff
**File:** `services/price-service/internal/http/client.go:115`  
**Issue:** Immediate retries without exponential backoff  
**Action:** Implement exponential backoff with jitter

### 4.4 Code Quality - Direct Environment Access
**Files:**
- `services/price-service/internal/middleware/auth.go:14`
- `services/price-service/internal/pipeline/pipeline.go:36`
**Issue:** Bypass centralized config system  
**Action:** Use config package consistently

### 4.5 Documentation - Outdated Testing Guide
**File:** `docs/testing-guide.md:87-88,209-216`  
**Issue:** References removed environment variables  
**Action:** Update to match current setup

---

## 5. Positive Findings

### 5.1 Security Practices
- Proper use of parameterized queries (sqlc, Drizzle)
- Timing attack protection with `subtle.ConstantTimeCompare`
- Log sanitization redacting passwords and API keys
- ZIP slip protection in file extraction

### 5.2 Architecture Patterns
- Clear separation between Node.js (frontend) and Go (ingestion/optimization)
- oRPC for type-safe API routes
- Content-addressable price storage (50% storage reduction)
- Distributed cron system with PostgreSQL coordination

### 5.3 Development Workflow
- Comprehensive documentation in `doc/planning/`
- Mise task runner for consistent commands
- Automated code generation for type safety
- CI checks for schema synchronization

---

## 6. Recommendations by Timeline

### This Week (Critical)
1. Fix hardcoded admin password in `scripts/ensure-admin.ts`
2. Fix task worker memory leak in `src/lib/taskqueue/worker.ts`
3. Add request timeouts to all HTTP calls
4. Remove panics from production code
5. Fix N+1 query pattern in prices handler

### Next 2 Weeks (High Priority)
1. Add tests for middleware and chain adapters
2. Implement batch size limits in persist.go
3. Create repository layer for Go service
4. Standardize on generated SDK
5. Add ADRs for major architectural decisions
6. Update DEPLOYMENT.md with correct ports

### Next Month (Medium Priority)
1. Refactor pipeline.go into smaller functions
2. Add search indexes (pg_trgm)
3. Implement proper caching with Redis
4. Fix test flakiness and enable parallel execution
5. Document all business logic and algorithms
6. Add path traversal validation

### Long-term (Strategic)
1. Reconsider microservices architecture vs modular monolith
2. Implement event-driven communication between services
3. Add comprehensive observability (metrics, tracing)
4. Create proper API gateway
5. Add E2E tests with Playwright

---

## 7. Files Requiring Immediate Attention

| Priority | File | Issue |
|----------|------|-------|
| P0 | `scripts/ensure-admin.ts:12` | Hardcoded password |
| P0 | `src/lib/taskqueue/worker.ts:133-138` | Memory leak bug |
| P0 | `services/price-service/internal/handlers/prices.go:347-392` | N+1 queries |
| P0 | `services/price-service/internal/handlers/optimize.go:87-92` | Global state |
| P0 | `services/price-service/internal/pipeline/metrics.go:30,40,50,60` | Panic usage |
| P0 | `services/price-service/internal/handlers/matching.go:181-213` | Silent errors |
| P1 | `services/price-service/internal/pipeline/persist.go:354-481` | Unbounded batches |
| P1 | `services/price-service/internal/pipeline/fetch.go:20-135` | Memory loading |
| P1 | `services/price-service/internal/middleware/ratelimit.go:88-91` | IP spoofing |
| P1 | `services/price-service/internal/optimizer/cache.go:653-679` | Race condition |

---

## 8. Conclusion

The Kosarica codebase has solid functional foundations but requires significant investment in:

1. **Testing** - Critical paths have near-zero coverage
2. **Architecture** - Global state and tight coupling need refactoring
3. **Performance** - Multiple O(N^2) algorithms and memory issues
4. **Documentation** - Missing ADRs and outdated deployment guides
5. **Security** - Several medium-risk issues to address

**Recommended Approach:**
- Fix critical security and performance issues immediately
- Establish testing baseline for all new code
- Refactor global state incrementally
- Document architectural decisions as they're made

The project is salvageable but requires disciplined engineering practices going forward.

---

*Report generated by staff engineer review process*  
*For questions or clarifications, see individual detailed reports in `/workspace/doc/reports/`*
