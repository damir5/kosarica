# Backend Testing Guide

## Overview

This guide explains how to run the backend test suite. Integration tests require Postgres and ClickHouse.

## Test Profiles

### Profile 1: Unit Tests Only
Fast iteration without external services. Ideal for development on code logic.

```bash
pnpm test:unit
```

**When to use:**
- Testing code logic and query functions
- Iterating on specific features
- Don’t need integration testing

### Profile 2: Full Test Suite
Complete test suite with all services running.

```bash
pnpm test
```

**When to use:**
- End-to-end testing
- Validating database + ClickHouse integration
- Pre-production validation

## Service Control

### Starting Services Manually

#### Unit Tests Only
No external services needed. Just run:

```bash
pnpm test:unit
```

#### Full Suite (Postgres + ClickHouse)

**Start ClickHouse (Docker example)**
```bash
docker run -d --name clickhouse-local -p 8123:8123 -p 9000:9000 clickhouse/clickhouse-server:latest
clickhouse-client < scripts/clickhouse-schema.sql
```

**Ensure Postgres is running** (dev setup or local container)

### Checking Service Status

```bash
# ClickHouse health
curl http://localhost:8123/ping

# PostgreSQL
docker ps | grep postgres
```

## Environment Variables

| Variable | Description | Default | When to Set |
|-----------|-------------|---------|-------------|
| `DATABASE_URL` | Postgres connection string | - | Always (tests require it) |
| `CLICKHOUSE_URL` | ClickHouse HTTP URL | `http://localhost:8123` | When running ClickHouse locally |
| `STORAGE_PATH` | Local storage path | `./data/storage-test` | Optional for tests |

## Test Scripts

| Script | Description |
|--------|-------------|
| `pnpm test` | Run all backend tests |
| `pnpm test:unit` | Run only unit tests |
| `pnpm test:integration` | Run full test suite (alias) |

## Troubleshooting

### Tests Failing with "ClickHouse not reachable"

**Problem:** ClickHouse integration tests fail.

**Solutions:**

1. **Check ClickHouse is running:**
   ```bash
   curl http://localhost:8123/ping
   ```

2. **Ensure schema is applied:**
   ```bash
   clickhouse-client < scripts/clickhouse-schema.sql
   ```

### Tests Failing with Database Errors

**Problem:** Tests fail with connection errors.

**Solutions:**

1. **Check test database is running:**
   ```bash
   docker ps | grep postgres
   ```

2. **Verify database URL:**
   Ensure `DATABASE_URL` points to the test database.

## Best Practices

### Development Workflow
```bash
# 1. Start services (Postgres + ClickHouse)
# 2. Run full test suite
pnpm test

# 3. Iterate quickly with unit tests
pnpm test:unit
```

### CI/CD Workflow
```yaml
# GitLab CI example
test:
  script:
    - pnpm install
    - pnpm test
  services:
    - postgres:latest
      alias: test-db
    - clickhouse/clickhouse-server:latest
      alias: clickhouse
  variables:
    DATABASE_URL: postgresql://test:password@test-db:5432/testdb
    CLICKHOUSE_URL: http://clickhouse:8123
```
