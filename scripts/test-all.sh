#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "Running all tests (migrate DB, run JS tests)"
echo "=========================================="

# Load development env if present, then overlay .env.test for test DB
set -o allexport
[ -f .env.development ] && . .env.development || true
[ -f .env.test ] && . .env.test || true
set +o allexport

# Check if services are available (warning only, not failure)
check_service() {
  local name="$1"
  local url="$2"
  if command -v curl &>/dev/null; then
    if ! curl -sf --max-time 2 "$url" &>/dev/null; then
      echo "WARNING: $name may not be available at $url"
      echo "  Run 'mise run services-up' to start dev services"
      echo "  Or run 'mise run test-ci' for isolated test environment"
      return 1
    fi
  fi
  return 0
}

SERVICES_AVAILABLE=true
if ! check_service "ClickHouse" "${CLICKHOUSE_URL:-http://localhost:8123}/ping"; then
  SERVICES_AVAILABLE=false
fi

if [ "$SERVICES_AVAILABLE" = false ]; then
  echo ""
  echo "Some services may be unavailable. Continuing anyway..."
  echo "(Unit tests will still run; integration tests may fail)"
  echo ""
fi

# Apply migrations to the test database before running tests.
echo "Applying DB migrations to test database..."
pnpm db:migrate || {
  echo "Migrations failed; showing last 200 lines of migration log:"
  tail -n 200 /tmp/kosarica-migrate.log || true
  exit 1
}

echo "Running frontend tests..."
pnpm test || TEST_EXIT=$?
TEST_EXIT=${TEST_EXIT:-0}

if [ "$TEST_EXIT" -ne 0 ]; then
  echo "Frontend tests failed; showing tail of vitest output"
  tail -n 200 /tmp/frontend-test.log || true
fi

# Return the actual test exit code (0 if tests passed)
exit $TEST_EXIT
