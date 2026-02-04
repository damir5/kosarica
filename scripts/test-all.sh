#!/usr/bin/env bash
set -euo pipefail

TEST_DB_USER="kosarica_test"
TEST_DB_PASSWORD="kosarica_test"
TEST_DB_NAME="kosarica_test"

cleanup() {
  echo ""
  echo "Cleaning up test services..."
  docker compose --profile test down -v 2>/dev/null || true
}
trap cleanup EXIT

DB_CANDIDATES=(
  "postgresql://${TEST_DB_USER}:${TEST_DB_PASSWORD}@ade-postgres-test.orb.local:5432/${TEST_DB_NAME}"
  "postgresql://${TEST_DB_USER}:${TEST_DB_PASSWORD}@host.docker.internal:5433/${TEST_DB_NAME}"
  "postgresql://${TEST_DB_USER}:${TEST_DB_PASSWORD}@localhost:5433/${TEST_DB_NAME}"
)

CH_CANDIDATES=(
  "http://ade-clickhouse-test.orb.local:8123"
  "http://host.docker.internal:8124"
  "http://localhost:8124"
)

wait_for_postgres_container() {
  local max_attempts=60
  for _ in $(seq 1 "$max_attempts"); do
    if docker exec ade-postgres-test pg_isready -U "$TEST_DB_USER" -d "$TEST_DB_NAME" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "ERROR: PostgreSQL test container is not ready after ${max_attempts}s."
  docker logs --tail 200 ade-postgres-test || true
  return 1
}

wait_for_clickhouse_container() {
  local max_attempts=60
  for _ in $(seq 1 "$max_attempts"); do
    if docker exec ade-clickhouse-test clickhouse-client --query "SELECT 1" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "ERROR: ClickHouse test container is not ready after ${max_attempts}s."
  docker logs --tail 200 ade-clickhouse-test || true
  return 1
}

choose_database_url() {
  if [ -n "${DATABASE_URL:-}" ]; then
    echo "${DATABASE_URL}"
    return 0
  fi

  local candidate
  for candidate in "${DB_CANDIDATES[@]}"; do
    local host_port
    host_port="$(echo "$candidate" | sed -E 's#^postgresql://[^@]+@([^/]+)/.*$#\1#')"
    local host="${host_port%:*}"
    local port="${host_port##*:}"
    if timeout 1 bash -c "cat < /dev/null > /dev/tcp/${host}/${port}" 2>/dev/null; then
      echo "$candidate"
      return 0
    fi
  done

  echo "${DB_CANDIDATES[0]}"
}

choose_clickhouse_url() {
  if [ -n "${CLICKHOUSE_URL:-}" ]; then
    echo "${CLICKHOUSE_URL}"
    return 0
  fi

  local candidate
  for candidate in "${CH_CANDIDATES[@]}"; do
    if curl -sf --max-time 2 "${candidate}/ping" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done

  echo "${CH_CANDIDATES[0]}"
}

ensure_clickhouse_schema() {
  docker exec -i ade-clickhouse-test clickhouse-client --multiquery < scripts/clickhouse-schema.sql >/dev/null
}

run_node_tooling() {
  if command -v node >/dev/null 2>&1; then
    "$@"
    return
  fi

  if command -v mise >/dev/null 2>&1; then
    mise exec node@24 -- "$@"
    return
  fi

  echo "ERROR: node is not available (and mise fallback is unavailable)."
  return 1
}

echo "=========================================="
echo "Running all tests (start docker, migrate, run vitest)"
echo "=========================================="

echo "Starting docker test services..."
docker compose --profile test up -d --force-recreate postgres-test clickhouse-test

echo "Waiting for PostgreSQL..."
wait_for_postgres_container

echo "Waiting for ClickHouse..."
wait_for_clickhouse_container

echo "Applying ClickHouse schema..."
ensure_clickhouse_schema

export DATABASE_URL="$(choose_database_url)"
export CLICKHOUSE_URL="$(choose_clickhouse_url)"
export STORAGE_PATH="${STORAGE_PATH:-./data/storage-test}"

echo "Postgres:   ${DATABASE_URL}"
echo "ClickHouse: ${CLICKHOUSE_URL}"

echo "Applying DB migrations..."
run_node_tooling pnpm db:migrate

echo "Running frontend tests..."
set +e
run_node_tooling pnpm test 2>&1 | tee /tmp/frontend-test.log
TEST_EXIT=${PIPESTATUS[0]}
set -e

if [ "$TEST_EXIT" -ne 0 ]; then
  echo "Frontend tests failed; showing tail of vitest output."
  tail -n 200 /tmp/frontend-test.log || true
fi

exit "$TEST_EXIT"
