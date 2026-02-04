#!/usr/bin/env bash
set -euo pipefail

CONFIRM=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)
      CONFIRM=false
      shift
      ;;
    --help|-h)
      cat <<'EOF'
Usage: reset-dev-data.sh [--yes]

Reset development data end-to-end:
  - deletes storage directories
  - clears PostgreSQL dev schema
  - clears ClickHouse dev tables
  - reapplies DB migrations (which seed chains)
  - reapplies ClickHouse migrations
  - creates dev admin user: admin@dev.local / admin123456
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [ -f ".env.development" ]; then
  set -a
  source ".env.development"
  set +a
fi

export NODE_ENV=development

DATABASE_URL="${DATABASE_URL:-}"
STORAGE_PATH="${STORAGE_PATH:-./data/storage}"
TEMP_STORAGE_PATH="${TEMP_STORAGE_PATH:-./data/temp}"

if [[ -z "${DATABASE_URL}" ]]; then
  echo "DATABASE_URL is required (.env.development expected)."
  exit 1
fi

if [[ "${DATABASE_URL}" == *"test"* ]]; then
  echo "Refusing to run against test-like DATABASE_URL: ${DATABASE_URL}"
  exit 1
fi

run_node_tooling() {
  if command -v node >/dev/null 2>&1; then
    "$@"
    return
  fi

  if command -v mise >/dev/null 2>&1; then
    mise exec node@24 -- "$@"
    return
  fi

  echo "Node.js is not available (and mise fallback unavailable)."
  exit 1
}

wait_for_postgres() {
  local max_attempts=60
  for _ in $(seq 1 "$max_attempts"); do
    if docker exec ade-postgres pg_isready -U kosarica -d kosarica >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Postgres dev container did not become ready."
  docker logs --tail 100 ade-postgres || true
  exit 1
}

wait_for_clickhouse() {
  local max_attempts=60
  for _ in $(seq 1 "$max_attempts"); do
    if docker exec ade-clickhouse clickhouse-client --query "SELECT 1" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "ClickHouse dev container did not become ready."
  docker logs --tail 100 ade-clickhouse || true
  exit 1
}

if [[ "${CONFIRM}" == "true" ]]; then
  echo "This will reset DEV data:"
  echo "  - Postgres schema at ${DATABASE_URL}"
  echo "  - ClickHouse table prices in ade-clickhouse"
  echo "  - Storage directories: ${STORAGE_PATH}, ${TEMP_STORAGE_PATH}"
  echo "  - Dev admin user: admin@dev.local / admin123456"
  echo
  read -r -p "Type 'yes' to continue: " response
  if [[ "${response}" != "yes" ]]; then
    echo "Cancelled."
    exit 0
  fi
fi

echo "Starting dev containers..."
docker compose --profile dev up -d postgres clickhouse

echo "Waiting for Postgres..."
wait_for_postgres

echo "Waiting for ClickHouse..."
wait_for_clickhouse

echo "Clearing PostgreSQL schema..."
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"

echo "Running PostgreSQL migrations (includes chain seed)..."
run_node_tooling pnpm db:migrate

echo "Clearing and recreating ClickHouse schema..."
docker exec ade-clickhouse clickhouse-client --query "DROP TABLE IF EXISTS prices"
docker exec ade-clickhouse clickhouse-client --query "DROP TABLE IF EXISTS schema_migrations"
run_node_tooling pnpm clickhouse:migrate

echo "Resetting storage directories..."
for dir in "${STORAGE_PATH}" "${TEMP_STORAGE_PATH}"; do
  if [[ -z "${dir}" || "${dir}" == "/" ]]; then
    echo "Refusing to delete unsafe directory path: '${dir}'"
    exit 1
  fi
  rm -rf "${dir}"
  mkdir -p "${dir}"
done

echo "Creating dev admin user..."
run_node_tooling npx tsx scripts/ensure-admin.ts

CHAIN_COUNT=$(psql "${DATABASE_URL}" -Atqc "SELECT count(*) FROM chains;")
echo "Done. Seeded chains: ${CHAIN_COUNT}"
echo "Dev admin: admin@dev.local / admin123456"
