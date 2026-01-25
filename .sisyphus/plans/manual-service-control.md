# Plan: Manual Service Control for Full Test Suite

## Problem
Full backend test suite (63 tests) cannot run completely because:
- Price service integration tests (9 tests) skip when Go service is unavailable
- User wants to run tests "without them makes no sense" - meaning they want full integration testing with real Go service
- Current mocking approach doesn't exercise real integration paths

## Solution
Implement manual service control with explicit start/stop commands and test profiles.

## Implementation

### 1. Update Test Setup for Manual Service Control
**File:** `src/test/setup.ts`

Add service management functions:
```typescript
export async function startGoService(): Promise<void> {
  // Start Go service via docker compose or binary
  // Wait for health check with timeout
  // Throw error if service doesn't start
}

export async function stopGoService(): Promise<void> {
  // Stop Go service via docker compose or process signal
  // Clean up resources
}

export function isGoServiceRunning(): boolean {
  // Check if GO_SERVICE_FOR_TESTS environment variable is set
  return process.env.GO_SERVICE_FOR_TESTS === "1";
}
```

Update `beforeAll` to optionally start Go service:
```typescript
beforeAll(async () => {
  // Start Go service if requested
  if (isGoServiceRunning()) {
    await startGoService();
  }

  await cleanupTestDatabase();
  await applyMigrations();
});
```

Update `afterAll` to stop Go service:
```typescript
afterAll(async () => {
  // Stop Go service if it was started
  if (isGoServiceRunning()) {
    await stopGoService();
  }

  closeTestDb();
});
```

### 2. Add Test Scripts to package.json
**File:** `package.json`

```json
{
  "scripts": {
    "test": "vitest run",
    "test:integration": "START_GO_SERVICE_FOR_TESTS=1 vitest run --run",
    "test:unit": "vitest run --run src/orpc/router/__tests__/stores*.test.ts src/db/queries/*.test.ts",
    "test:price-service": "START_GO_SERVICE_FOR_TESTS=1 vitest run --run src/orpc/router/__tests__/price-service.integration.test.ts",
    "dev:start": "docker compose up -d price-service",
    "dev:stop": "docker compose down",
    "dev:start-services": "docker compose up -d",
    "dev:stop-services": "docker compose down"
  }
}
```

### 3. Update vitest.config.ts for Environment Variable
**File:** `vitest.config.ts`

Add to env configuration:
```typescript
env: {
  STORAGE_PATH: "./test-data/storage",
  SAMPLE_DATA_DIR: path.join(process.cwd(), "sample-data"),
  TEST_MOCK_GO_SERVICE: process.env.TEST_MOCK_GO_SERVICE || "0",
  GO_SERVICE_FOR_TESTS: process.env.GO_SERVICE_FOR_TESTS || "0",
}
```

### 4. Update Docker Compose for Test Mode
**File:** `docker-compose.yml`

Add test-specific services and profiles:
```yaml
services:
  # ... existing postgres and main app services ...

  # Test database - always runs
  postgres-test:
    image: postgres:16-alpine
    container_name: kosarica-postgres-test
    restart: unless-stopped
    environment:
      POSTGRES_DB: kosarica_test
      POSTGRES_USER: kosarica_test
      POSTGRES_PASSWORD: kosarica_test
    ports:
      - "15432:5432"  # Different port to avoid conflict with dev postgres
    networks:
      - kosarica-dev
    profiles: ["test"]

  # Price service - runs in all environments
  price-service:
    build:
      context: ./services/price-service
      dockerfile: deployment/Dockerfile
    image: kosarica/price-service:dev
    container_name: kosarica-price-service-dev
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      PORT: 8080
      DATABASE_URL: postgresql://kosarica:kosarica@postgres:5432/kosarica
      LOG_LEVEL: debug
      LOG_FORMAT: console
      LOG_NO_COLOR: "true"
      INTERNAL_API_KEY: dev-internal-api-key-change-in-production
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - kosarica-dev
    profiles: ["dev", "test"]
```

### 5. Create Documentation
**File:** `docs/testing-guide.md`

```markdown
# Backend Testing Guide

## Test Profiles

### 1. Unit Tests Only
Fast iteration without external services.

```bash
pnpm test:unit
```

**When to use:**
- Testing code logic and query functions
- Iterating on specific features
- Don't need integration testing

### 2. Full Integration Tests
Complete test suite with all services running.

```bash
# Step 1: Start all services
pnpm dev:start-services

# Step 2: Run full test suite
pnpm test:integration

# Step 3: Stop services when done
pnpm dev:stop-services
```

**When to use:**
- Testing real integration paths
- Validating cross-service communication
- End-to-end workflow testing
- Pre-production validation

## Service Control

### Starting Go Service
**Manual:**
```bash
# Build and run Go service
cd services/price-service
go build -o price-service ./cmd/server/main.go
./price-service &
```

**Via Docker Compose:**
```bash
docker compose up -d price-service
```

### Stopping Go Service
```bash
docker compose down price-service
# Or: kill $(pgrep -f price-service)
```

### Checking Service Status
```bash
# Health check
curl http://localhost:8080/health

# Database connection
curl http://localhost:8080/internal/health
```

## Environment Variables

| Variable | Description | Default |
|-----------|-------------|---------|
| `GO_SERVICE_FOR_TESTS` | Enable Go service for tests | 0 |
| `START_GO_SERVICE_FOR_TESTS` | Override test start behavior | 0 |
| `TEST_MOCK_GO_SERVICE` | Mock Go service (legacy, unused) | 0 |

## Test Results

### Expected Behavior

**With `GO_SERVICE_FOR_TESTS=1`:**
- All 63 tests pass (unit + integration + price service)
- Go service starts automatically via test setup
- Tests exercise real integration endpoints
- Full coverage of codebase

**With `GO_SERVICE_FOR_TESTS=0` (default):**
- Unit tests pass (54 tests)
- Store integration tests pass (12 tests)
- Price service tests skip with warning (9 tests)
- Developer can iterate quickly on unit tests
- Go service not started automatically

## Workflow Examples

### Example 1: Test Unit Tests Only
```bash
# Fast iteration - no Go service needed
pnpm test:unit
# Make changes...
pnpm test:unit
```

### Example 2: Test with Go Service
```bash
# Start Go service
docker compose up -d price-service

# Run integration tests
pnpm test:integration

# Stop when done
docker compose down
```

### Example 3: Integration Test on Go Service
```bash
# Build Go service locally
cd services/price-service
go build -o price-service cmd/server/main.go

# Run with Go service
export DATABASE_URL="postgres://user:pass@localhost:5432/kosarica"
export INTERNAL_API_KEY="dev-internal-api-key-change-in-production"
./price-service &

# In another terminal:
pnpm test:integration
```

## Troubleshooting

### Go Service Won't Start
```bash
# Check if already running
docker ps | grep price-service

# Kill existing process
docker compose down

# Check port
lsof -i :8080

# Check logs
docker compose logs price-service
```

### Tests Fail with Go Service Running
```bash
# Database already has data
# Solution: Test setup should clean and migrate fresh database

# Tests expect different state
# Solution: Clear test expectations or run cleanup before tests
```

## Migration from Mocking

The previous mock implementation (`TEST_MOCK_GO_SERVICE=1`) is now **legacy**. The new approach uses:

1. `GO_SERVICE_FOR_TESTS=1` - Enables automatic Go service startup in test setup
2. `GO_SERVICE_FOR_TESTS=0` - Manual control, Go service not started by tests
3. `START_GO_SERVICE_FOR_TESTS=1` - Explicit override for one-time tests

**Legacy mock file** can be removed when confident in new approach.
