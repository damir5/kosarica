#!/usr/bin/env bash
set -euo pipefail

# Pull PostgreSQL data from staging to local dev.
# Requires SSH tunnel to staging PG on localhost:15432.
# Usage: ./scripts/staging-pull-pg.sh [--days N] [--yes]

DAYS=14
CONFIRM=true
STAGING_PG_PORT=15432

while [[ $# -gt 0 ]]; do
  case "$1" in
    --days)   DAYS="$2"; shift 2 ;;
    --yes|-y) CONFIRM=false; shift ;;
    --staging-port) STAGING_PG_PORT="$2"; shift 2 ;;
    --help|-h)
      cat <<'EOF'
Usage: staging-pull-pg.sh [--days N] [--yes] [--staging-port PORT]

Pull PostgreSQL data from staging into local dev database.
Expects an SSH tunnel forwarding staging PG to localhost:15432.

Options:
  --days N          Number of days of history to pull (default: 14)
  --yes             Skip confirmation prompt
  --staging-port    Local port for staging PG tunnel (default: 15432)
EOF
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Load local dev environment
if [ -f ".env.development" ]; then
  set -a; source ".env.development"; set +a
fi
export NODE_ENV=development

DATABASE_URL="${DATABASE_URL:-}"
if [[ -z "${DATABASE_URL}" ]]; then
  echo "ERROR: DATABASE_URL is required (.env.development expected)."
  exit 1
fi
if [[ "${DATABASE_URL}" == *"test"* ]]; then
  echo "ERROR: Refusing to run against test-like DATABASE_URL: ${DATABASE_URL}"
  exit 1
fi

# Read staging PG password from .kamal/secrets
KAMAL_SECRETS=".kamal/secrets"
if [[ ! -f "${KAMAL_SECRETS}" ]]; then
  echo "ERROR: ${KAMAL_SECRETS} not found. Cannot read staging PG password."
  exit 1
fi
STAGING_PG_PASS=$(grep '^POSTGRES_PASSWORD=' "${KAMAL_SECRETS}" | head -1 | cut -d= -f2-)
if [[ -z "${STAGING_PG_PASS}" ]]; then
  echo "ERROR: POSTGRES_PASSWORD not found in ${KAMAL_SECRETS}"
  exit 1
fi

STAGING_PG="postgresql://kosarica:${STAGING_PG_PASS}@localhost:${STAGING_PG_PORT}/kosarica"
LOCAL_PG="${DATABASE_URL}"

# Compute cutoff date (cross-platform: macOS vs Linux)
if date -v -1d >/dev/null 2>&1; then
  CUTOFF=$(date -v "-${DAYS}d" +%Y-%m-%d)
else
  CUTOFF=$(date -d "-${DAYS} days" +%Y-%m-%d)
fi

echo "=== PostgreSQL Staging Pull ==="
echo "  Staging PG:  localhost:${STAGING_PG_PORT}"
echo "  Local PG:    ${DATABASE_URL%%@*}@..."
echo "  Cutoff date: ${CUTOFF} (${DAYS} days)"
echo

if [[ "${CONFIRM}" == "true" ]]; then
  echo "This will DROP and recreate the local public schema."
  read -r -p "Type 'yes' to continue: " response
  if [[ "${response}" != "yes" ]]; then
    echo "Cancelled."
    exit 0
  fi
fi

# Verify staging tunnel is reachable
if ! psql --no-psqlrc "${STAGING_PG}" -c "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to staging PG at localhost:${STAGING_PG_PORT}"
  echo "Ensure SSH tunnel is open: ssh -L ${STAGING_PG_PORT}:kosarica-postgres:5432 root@kosarica.chickenkiller.com"
  exit 1
fi
echo "Staging PG connection verified."

run_node_tooling() {
  if command -v node >/dev/null 2>&1; then
    "$@"; return
  fi
  if command -v mise >/dev/null 2>&1; then
    mise exec node@24 -- "$@"; return
  fi
  echo "ERROR: Node.js is not available."; exit 1
}

# Step 1: Reset local schema
echo
echo "--- Resetting local schema ---"
psql --no-psqlrc "${LOCAL_PG}" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"

# Step 2: Run Drizzle migrations (creates empty tables)
echo "--- Running Drizzle migrations ---"
run_node_tooling pnpm db:migrate

# Step 3: Copy helper — streams CSV from staging to local via pipe
# session_replication_role disables FK trigger checks per-session,
# so we set it via PGOPTIONS for every psql invocation on the local side.
export PGOPTIONS="-c session_replication_role=replica"

copy_full_table() {
  local table="$1"
  echo -n "  ${table}..."
  # Truncate first (migrations may have seeded data like chains/container_types)
  psql --no-psqlrc "${LOCAL_PG}" -v ON_ERROR_STOP=1 -c "TRUNCATE ${table} CASCADE;" 2>/dev/null
  # Query non-generated columns to avoid GENERATED ALWAYS columns (e.g. search_index)
  # --no-psqlrc prevents .psqlrc banner from corrupting the CSV pipe
  local cols
  cols=$(psql --no-psqlrc "${STAGING_PG}" -Atqc \
    "SELECT string_agg('\"' || column_name || '\"', ', ' ORDER BY ordinal_position)
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = '${table}'
       AND is_generated = 'NEVER'
       AND generation_expression IS NULL")
  psql --no-psqlrc "${STAGING_PG}" -Atqc "\copy (SELECT ${cols} FROM ${table}) TO STDOUT WITH CSV HEADER" \
    | psql --no-psqlrc "${LOCAL_PG}" -c "\copy ${table}(${cols}) FROM STDIN WITH CSV HEADER" 2>&1
  echo " done"
}

copy_sliced_table() {
  local table="$1"
  local query="$2"
  echo -n "  ${table}..."
  psql --no-psqlrc "${STAGING_PG}" -Atqc "\copy (${query}) TO STDOUT WITH CSV HEADER" \
    | psql --no-psqlrc "${LOCAL_PG}" -c "\copy ${table} FROM STDIN WITH CSV HEADER" 2>&1
  echo " done"
}

echo
echo "--- Importing data (FK checks disabled via PGOPTIONS) ---"

# Full-copy tables (FK-safe order)
FULL_TABLES=(
  chains
  container_types
  app_settings
  stores
  store_identifiers
  retailer_items
  retailer_item_barcodes
  canonical_skus
  sku_item_links
  barcode_sku_mappings
  retailer_item_features
  product_clusters
  cluster_members
  cluster_relations
  search_index
  llm_endpoints
  llm_endpoint_capabilities
  llm_endpoint_runtime
)

echo "Full-copy tables:"
for table in "${FULL_TABLES[@]}"; do
  copy_full_table "${table}"
done

# Date-sliced tables
echo
echo "Date-sliced tables (>= ${CUTOFF}):"

copy_sliced_table "ingestion_runs" \
  "SELECT * FROM ingestion_runs WHERE created_at >= '${CUTOFF}'"

copy_sliced_table "ingestion_files" \
  "SELECT f.* FROM ingestion_files f JOIN ingestion_runs r ON f.run_id = r.id WHERE r.created_at >= '${CUTOFF}'"

copy_sliced_table "ingestion_chunks" \
  "SELECT c.* FROM ingestion_chunks c JOIN ingestion_files f ON c.file_id = f.id JOIN ingestion_runs r ON f.run_id = r.id WHERE r.created_at >= '${CUTOFF}'"

copy_sliced_table "ingestion_errors" \
  "SELECT e.* FROM ingestion_errors e JOIN ingestion_runs r ON e.run_id = r.id WHERE r.created_at >= '${CUTOFF}'"

copy_sliced_table "ingestion_store_stats" \
  "SELECT s.* FROM ingestion_store_stats s JOIN ingestion_runs r ON s.run_id = r.id WHERE r.created_at >= '${CUTOFF}'"

copy_sliced_table "archives" \
  "SELECT * FROM archives WHERE downloaded_at >= '${CUTOFF}'"

copy_sliced_table "parquet_files" \
  "SELECT * FROM parquet_files WHERE target_date >= '${CUTOFF}'"

copy_sliced_table "cron_runs" \
  "SELECT * FROM cron_runs WHERE created_at >= '${CUTOFF}'"

copy_sliced_table "semantic_pair_decisions" \
  "SELECT * FROM semantic_pair_decisions WHERE created_at >= '${CUTOFF}'"

copy_sliced_table "catalog_events" \
  "SELECT * FROM catalog_events WHERE created_at >= '${CUTOFF}'"

copy_sliced_table "llm_decision_log" \
  "SELECT * FROM llm_decision_log WHERE created_at >= '${CUTOFF}'"

copy_sliced_table "llm_decision_cache" \
  "SELECT * FROM llm_decision_cache WHERE updated_at >= '${CUTOFF}'"

copy_sliced_table "llm_endpoint_health_checks" \
  "SELECT * FROM llm_endpoint_health_checks WHERE checked_at >= '${CUTOFF}'"

copy_sliced_table "llm_endpoint_quality_daily" \
  "SELECT * FROM llm_endpoint_quality_daily WHERE day >= '${CUTOFF}'"

copy_sliced_table "llm_routing_decisions" \
  "SELECT * FROM llm_routing_decisions WHERE created_at >= '${CUTOFF}'"

copy_sliced_table "store_enrichment_tasks" \
  "SELECT * FROM store_enrichment_tasks WHERE created_at >= '${CUTOFF}'"

copy_sliced_table "retailer_items_failed" \
  "SELECT * FROM retailer_items_failed WHERE failed_at >= '${CUTOFF}'"

# Step 5: Re-enable FK checks (unset PGOPTIONS for subsequent commands)
unset PGOPTIONS

# Step 6: Fix bigserial sequences
echo
echo "--- Fixing sequences ---"
SERIAL_TABLES=("ingestion_files" "ingestion_errors" "ingestion_store_stats" "cron_runs")
for table in "${SERIAL_TABLES[@]}"; do
  psql --no-psqlrc "${LOCAL_PG}" -v ON_ERROR_STOP=1 -c \
    "SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1));" \
    >/dev/null 2>&1 || true
done
echo "Sequences fixed."

# Step 7: Create dev admin user
echo
echo "--- Creating dev admin user ---"
run_node_tooling npx tsx scripts/ensure-admin.ts

# Summary
echo
echo "=== PostgreSQL sync complete ==="
for table in "${FULL_TABLES[@]}"; do
  count=$(psql --no-psqlrc "${LOCAL_PG}" -Atqc "SELECT count(*) FROM ${table};")
  echo "  ${table}: ${count} rows"
done
echo "  (date-sliced tables imported for >= ${CUTOFF})"
