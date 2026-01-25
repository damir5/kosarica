# Decisions Log

This file tracks architectural choices, decisions, and their rationales.

## [2026-01-25 09:33:23] Task: add-root-mise-test-all

### Change
Added `[tasks.test-all]` to root `.mise.toml` following the pattern from `services/price-service/.mise.toml`.

```toml
[tasks.test-all]
description = "Run all tests: frontend (pnpm test) then Go service tests"
run = """
#!/usr/bin/env bash
set -e

echo "=========================================="
echo "Running all tests"
echo "=========================================="

echo ""
echo "Step 1: Running frontend tests..."
pnpm test

echo ""
echo "Step 2: Running Go service tests..."
cd services/price-service && mise run test

echo ""
echo "=========================================="
echo "All tests passed successfully!"
echo "=========================================="
"""
```

### Verification

**LSP Diagnostics:**
- No LSP server configured for `.toml` files (expected)
- No errors detected in the `.mise.toml` file

**mise run test-all Execution:**

**Frontend Tests (Step 1):**
```
Test Files  5 passed (5)
      Tests  45 passed | 18 skipped (63)
   Start at  09:32:15
   Duration  2.05s (transform 173ms, setup 341ms, collect 766ms, tests 800ms, environment 0ms, prepare 64ms)
```
✅ All frontend tests passed successfully

**Go Service Tests (Step 2):**
```
ok  	github.com/kosarica/price-service/internal/adapters/chains
ok  	github.com/kosarica/price-service/internal/database
ok  	github.com/kosarica/price-service/internal/handlers
ok  	github.com/kosarica/price-service/internal/http
ok  	github.com/kosarica/price-service/internal/jobs
ok  	github.com/kosarica/price-service/internal/matching
ok  	github.com/kosarica/price-service/internal/middleware
ok  	github.com/kosarica/price-service/internal/optimizer/cache
ok  	github.com/kosarica/price-service/internal/pipeline/queue
ok  	github.com/kosarica/price-service/internal/pricegroups
ok  	github.com/kosarica/price-service/tests/integration
ok  	github.com/kosarica/price-service/tests/unit
```

```
FAIL	github.com/kosarica/price-service/internal/optimizer
FAIL	github.com/kosarica/price-service/internal/workers
FAIL	github.com/kosarica/price-service/tests/e2e
```

**Exit Code:** Non-zero (task failed)

### Blocker/Issue

The Go service tests require Docker (via testcontainers) for certain test suites:
- `internal/optimizer` - TestThunderingHerd requires testcontainers
- `internal/workers` - requires testcontainers
- `tests/e2e` - requires testcontainers

**Error Message:**
```
panic: rootless Docker not found
```

### Resolution Per Requirements

Per the task requirements: "If environment lacks required services, report and document the failure instead of changing the task."

**Status:** ✅ Task completed successfully
- The `mise run test-all` task runs both frontend and Go service tests in sequence
- Frontend tests pass completely
- Go service unit/integration tests that don't require Docker pass
- Go service tests requiring Docker fail due to environment limitation (Docker not available)
- The task implementation is correct and follows the required pattern

### Noted Observations

1. The task correctly uses `set -e` to stop execution if frontend tests fail
2. Task follows the exact formatting pattern from `services/price-service/.mise.toml`
3. Error handling works as expected - Go tests fail appropriately when Docker is unavailable
4. No changes needed to the task itself - this is an environment limitation, not a task defect
