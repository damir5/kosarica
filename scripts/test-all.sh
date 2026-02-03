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
