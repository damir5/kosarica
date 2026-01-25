# Notepad: Fix Test-All Errors

## Session: ses_40b7b6d58ffeUiP8seqynm4mi8

## Timestamp: 2026-01-25T11:00:00Z

---

## Task 1 Results: Remove duplicate log declaration from worker.go

**Status**: ✅ COMPLETED

**Changes Made**:
- Removed line 15: `var log = zerolog.New(os.Stdout).With().Timestamp().Logger()`
- Removed unused `"github.com/rs/zerolog"` import from imports
- Removed unused `"os"` import from imports

**Verification**:
- ✅ Line 15 removed from worker.go
- ✅ File has 15 logging calls still intact (verified with grep)
- ⚠️  Go build verification NOT COMPLETED (Go not installed in environment)

**Issue Discovered During Verification**:
- `config/config.go` has unused `"github.com/rs/zerolog"` import causing build failures in cmd/cli, cmd/server, config packages

---

## Task 2 Results: Set TESTCONTAINERS_ENABLED=false in mise test task

**Status**: ✅ COMPLETED

**Changes Made**:
- Modified `services/price-service/.mise.toml` test task from: `run = "go test ./..."`
- To: `run = "export TESTCONTAINERS_ENABLED=false && go test ./..."`

**Verification**:
- ✅ Env var properly set in test task
- ❌ Tests still panic with "rootless Docker not found"

**Issue Discovered During Verification**:
- `TESTCONTAINERS_ENABLED=false` environment variable only helps tests that explicitly check for it (e2e tests have TestMain)
- **FIVE other test files** use testcontainers directly without checking env var:
  1. `internal/handlers/optimize_test.go` - calls testcontainers directly
  2. `internal/matching/integration_test.go` - calls testcontainers directly
  3. `internal/optimizer/cache_test.go` - calls testcontainers directly
  4. `tests/e2e/pipeline_test.go` - has TestMain but still panics (env var not working?)
  5. `internal/handlers/optimize_test.go` - another test file

**Root Cause**: Only e2e tests have `TestMain` that checks `TESTCONTAINERS_ENABLED`. Other test files call testcontainers directly in test functions.

---

## Task 3 Results: Verify test-all passes end-to-end

**Status**: ❌ FAILED

**Final Test Output**:
```
mise run test-all
```
**Frontend Tests**: ✅ PASSED
- All vitest tests completed successfully

**Go Tests**: ❌ PARTIAL

**Build Errors**:
- `config/config.go:10:2` - `"github.com/rs/zerolog" imported and not used`
- Causes: cmd/cli, cmd/server, config packages fail to build

**Docker Panics** (5 test suites):
1. `internal/handlers/optimize_test.go` - TestOptimizeSingleHappyPath
2. `internal/matching/integration_test.go` - TestBarcodeMatchingFlow
3. `internal/optimizer/cache_test.go` - TestThunderingHerd
4. `tests/e2e/pipeline_test.go` - TestE2EPipeline
5. `internal/handlers/optimize_test.go` - (duplicate in list?)

**Exit Code**: 1 (FAIL)

---

## Root Cause Analysis

### Issue 1: Unused Import Scope Creep

The original task was to fix duplicate log in `worker.go`. However:
- Removing `log` declaration from worker.go caused it to use logger from integration.go
- This made worker.go's imports of `os` and `zerolog` unused
- But another file `config/config.go` also has unused `zerolog` import
- This was NOT in original scope but causes build failures

### Issue 2: Testcontainers Not Checking Env Var

The env var `TESTCONTAINERS_ENABLED=false` was set in mise.toml, BUT:
- Only e2e tests have `TestMain` that checks it
- Other test files call testcontainers directly in test functions
- They don't have env var checks in their test code
- Result: Docker panics occur regardless of env var

### Issue 3: E2E TestMain Not Working

Even though e2e tests have TestMain that checks env var:
```go
if os.Getenv("TESTCONTAINERS_ENABLED") == "false" {
    os.Exit(m.Run())
}
```
- Tests still panic with Docker error
- Suggests env var is not propagating or TestMain isn't being invoked

---

## Recommendations

### Option A: Expand Scope (Broader Fix)

Add new tasks to fix all discovered issues:
1. Remove unused zerolog import from config/config.go
2. Add TestMain or build tags to 4 test files using testcontainers
3. Fix e2e TestMain to properly skip tests when Docker unavailable

### Option B: Skip Integration Tests (Quick Fix)

Modify mise test task to only run unit tests that don't require Docker:
```toml
[tasks.test]
description = "Run Go unit tests only (without Docker)"
run = "go test ./tests/unit/... ./internal/pkg/... ./internal/pricegroups/..."
```

### Option C: Use Go Build Tags (Long-term)

Add build tag to all testcontainer tests:
```go
//go:build !testcontainers

func setupTestDB() *pgxpool.Pool { ... }
```

Then use:
```toml
run = "go test -tags=!testcontainers ./..."
```

---

## Decision Required

Original plan objectives:
1. ✅ Remove duplicate log declaration - DONE
2. ✅ Set TESTCONTAINERS_ENABLED=false - DONE
3. ❌ Verify test-all passes - FAILED (scope creep revealed additional issues)

The original plan assumed 2 issues, but verification revealed 8+ issues across multiple files.

**Next action needed**: Decide whether to:
- A. Expand plan to fix all discovered issues
- B. Commit current partial fixes as-is
- C. Document blockers and stop
