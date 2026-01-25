# Backend Testing Guide

## Overview

This guide explains how to run the full backend test suite with the option to test Go service integration using a real running instance.

## Test Profiles

### Profile 1: Unit Tests Only
Fast iteration without external services. Ideal for development on code logic.

```bash
pnpm test:unit
```

**When to use:**
- Testing code logic and query functions
- Iterating on specific features
- Don't need integration testing

### Profile 2: Full Test Suite
Complete test suite with all services running including Go price service.

```bash
pnpm test
```

**When to use:**
- End-to-end testing
- Validating cross-service communication
- Pre-production validation

## Service Control

### Starting Services Manually

#### Unit Tests Only
No external services needed. Just run:

```bash
pnpm test:unit
```

#### Full Suite with Go Service

**Option A: Using Docker Compose (Recommended)**
```bash
# Start all services
docker compose -f docker-compose-test.yml up -d

# Run full test suite
pnpm test

# Stop services when done
docker compose -f docker-compose-test.yml down
```

**Option B: Using Native Development**
```bash
# Start Go service
cd services/price-service
go build -o price-service ./cmd/server/main.go
./price-service &

# Run full test suite
pnpm test

# Stop Go service
kill $(pgrep -f price-service)
```

### Stopping Services

```bash
# Stop Go service if running
pnpm dev:stop
```

### Checking Service Status

```bash
# Go service health
curl http://localhost:8080/health

# Database connection
curl http://localhost:8080/internal/health

# PostgreSQL
docker ps | grep postgres

# See logs
docker compose logs price-service
```

## Environment Variables

| Variable | Description | Default | When to Set |
|-----------|-------------|---------|-------------|
| `GO_SERVICE_FOR_TESTS` / `START_GO_SERVICE_FOR_TESTS` | (removed) | - | Do not use; orchestration handles Go service startup — use `GO_SERVICE_URL` and `mise run test-all` |
| `TEST_MOCK_GO_SERVICE` | Mock Go service (legacy, unused) | 0 | Legacy variable, no longer used |

## Test Scripts

| Script | Description |
|--------|-------------|
| `pnpm test` | Run all backend tests (63 tests) |
| `pnpm test:unit` | Run only unit tests (40 tests) |
| `pnpm test:integration` | Run full suite with Go service (63 tests) |
| `pnpm dev:start` | Start all services (postgres + Go) |
| `pnpm dev:stop` | Stop all services |
| `pnpm dev:start-services` | Start services with test profile |
| `pnpm dev:stop-services` | Stop services with test profile |

## Test Results

### Expected Results

**With an explicitly set `GO_SERVICE_URL`:**
- All 63 tests pass (unit + integration + price service)
- Go service is expected to be running at `GO_SERVICE_URL` (orchestrated via `mise run test-all`)
- Tests exercise real integration endpoints
- Full coverage of codebase
- Tests complete in ~2-3 seconds

**When GO service orchestration is external (default):**
- Unit tests pass (40 tests)
- Store integration tests pass (12 tests)
- Price service tests require a running Go service at `GO_SERVICE_URL` and will run when it is available
- Developer can iterate quickly on unit tests
- No automatic Go service startup within tests; use `mise run test-all` to run full suite

## Troubleshooting

### Tests Failing with "Go service not reachable"

**Problem:** Price service tests skip even though you started Go service

**Solutions:**

1. **Check Docker Compose profile:**
   ```bash
   docker compose ls
   ```
   Verify price-service is in the profile

2. **Check Go service logs:**
   ```bash
   docker compose logs price-service
   ```
   Look for startup errors

3. **Verify health endpoint:**
   ```bash
   curl http://localhost:8080/health
   curl http://localhost:8080/internal/health
   ```
   Both should return 200 OK

4. **Check internal API key:**
   ```bash
   docker compose exec price-service env | grep INTERNAL_API_KEY
   ```
   Must match between Go service and test setup

5. **Network connectivity:**
   ```bash
   docker network inspect kosarica-dev
   ```
   Verify Node app can reach Go service container

### Tests Failing with Database Errors

**Problem:** Tests fail with connection errors

**Solutions:**

1. **Check test database is running:**
   ```bash
   docker ps | grep postgres-test
   ```

2. **Verify database is clean before tests:**
   Tests run `cleanupTestDatabase()` in `beforeAll` hook

3. **Check for port conflicts:**
   ```bash
   lsof -i :15432
   ```
   Test database should use port 15432, not 5432

### Test Database vs Development Database

**Important:** Tests use separate database (`kosarica_test`) to avoid conflicts with development data.

- Test database: `kosarica_test` on port 15432
- Development database: `kosarica` on port 5432
- Never mix them!

### Running Tests in Docker Compose

For a self-contained test environment:

```bash
# Use test-specific compose file
docker compose -f docker-compose-test.yml up -d

# Run tests
docker exec -it kosarica-test pnpm test
```

## Best Practices

### 1. Development Workflow
```bash
# 1. Start Go service (if needed)
pnpm dev:start-services

# 2. Run full test suite
pnpm test

# 3. Make changes
# Edit code...

# 4. Re-run tests (fast!)
pnpm test:unit

# 5. Stop services when done
pnpm dev:stop-services
```

### 2. CI/CD Workflow
```yaml
# GitLab CI example
test:
  script:
    - pnpm install
    - pnpm test
  services:
    - postgres:latest
      alias: test-db
  variables:
    DATABASE_URL: postgresql://test:password@test-db:5432/testdb
```

## Migration from Old Mock Mode

The previous mock implementation (`TEST_MOCK_GO_SERVICE=1`) is now **legacy**.

To migrate:
1. Remove references to `TEST_MOCK_GO_SERVICE` from code
2. Delete `/workspace/src/test/go-service-mocks.ts` if no longer needed
3. Use `GO_SERVICE_URL` environment variable to point tests at a running Go service

The new approach uses real Go service instances controlled via orchestration (`mise run test-all`), providing true integration testing.
