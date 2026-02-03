#!/usr/bin/env bash
set -euo pipefail

# CI script that starts test services, runs tests, and cleans up
# Uses OrbStack DNS for container access

echo "=========================================="
echo "CI Test Runner - Starting test services"
echo "=========================================="

# Cleanup function - always runs on exit
cleanup() {
  echo ""
  echo "Cleaning up test services..."
  docker compose --profile test down -v 2>/dev/null || true
}
trap cleanup EXIT

# Start test containers and wait for health checks
echo "Starting test containers..."
docker compose --profile test up -d --wait

# Set environment variables for OrbStack DNS
export DATABASE_URL="postgresql://kosarica_test:kosarica_test@ade-postgres-test.orb.local:5432/kosarica_test"
export CLICKHOUSE_URL="http://ade-clickhouse-test.orb.local:8123"
export STORAGE_PATH="./data/storage-test"

echo "Test services ready:"
echo "  Postgres:   $DATABASE_URL"
echo "  ClickHouse: $CLICKHOUSE_URL"
echo ""

# Run migrations
echo "Applying DB migrations to test database..."
pnpm db:migrate || {
  echo "Migrations failed"
  exit 1
}

# Run tests
echo ""
echo "Running tests..."
pnpm test
TEST_EXIT=$?

echo ""
echo "=========================================="
if [ "$TEST_EXIT" -eq 0 ]; then
  echo "All tests passed!"
else
  echo "Tests failed with exit code $TEST_EXIT"
fi
echo "=========================================="

exit $TEST_EXIT
