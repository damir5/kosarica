# Draft: Fix mise run test-all errors

## Issues Identified

### 1. Go Build Failure - Duplicate Log Declaration
Both `worker.go` and `integration.go` declare a `log` variable at package level:
- `services/price-service/internal/workers/worker.go:15`: `var log = zerolog.New(os.Stdout).With().Timestamp().Logger()`
- `services/price-service/internal/workers/integration.go:15`: `var log = zerolog.New(os.Stdout).With().Timestamp().Str("component", "worker").Logger()`

This causes: `internal/workers/worker.go:15:5: log redeclared in this block`

### 2. Testcontainers Tests Failing
Multiple Go integration tests panic with "rootless Docker not found" because:
- Docker is not available in this environment
- Tests use testcontainers to spin up PostgreSQL containers
- The default `mise run test` runs `go test ./...` which includes all tests
- Environment variable `TESTCONTAINERS_ENABLED=false` is not set by default
- E2E tests check this env var but don't skip when unset (they default to running)

## Test Setup Analysis

- `mise run test-all` runs:
  1. `pnpm test` (frontend tests) - PASS
  2. `cd services/price-service && mise run test` (Go tests)
- `mise run test` runs: `go test ./...`
- This includes: unit tests, integration tests, and e2e tests
- E2E tests have `TestMain` that checks `TESTCONTAINERS_ENABLED=="false"` to skip containers
- But this env var is NOT set by default when running `go test ./...`

## User Requirements (Confirmed)

1. **"keep integration logger"** - Keep the logger from `integration.go` which has the `"component"` tag
2. **"set env var to disable test containers in mise run"** - Set `TESTCONTAINERS_ENABLED=false` in the test task

## Confirmed Fix Approach

### Fix 1: Duplicate Log Declaration
- **Remove** the `var log` declaration from `worker.go:15`
- **Keep** the logger from `integration.go:15` which includes `"component": "worker"` tag
- Both files are in the same package (`workers`), so worker.go's methods can access the package-level `log` variable from integration.go

### Fix 2: Disable Testcontainers
- **Add** `TESTCONTAINERS_ENABLED=false` environment variable to the `mise run test` task
- This will cause e2e tests' `TestMain` to skip container creation and just run tests without setup
- Integration tests can then use existing database via `DATABASE_URL`
