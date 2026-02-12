#!/usr/bin/env bash
set -euo pipefail

# Pull ClickHouse data from staging to local dev.
# Requires SSH tunnel to staging CH on localhost:18123.
# Usage: ./scripts/staging-pull-ch.sh [--days N] [--yes]

DAYS=14
CONFIRM=true
STAGING_CH_PORT=18123
LOCAL_CH_PORT=8123

while [[ $# -gt 0 ]]; do
  case "$1" in
    --days)   DAYS="$2"; shift 2 ;;
    --yes|-y) CONFIRM=false; shift ;;
    --staging-port) STAGING_CH_PORT="$2"; shift 2 ;;
    --help|-h)
      cat <<'EOF'
Usage: staging-pull-ch.sh [--days N] [--yes] [--staging-port PORT]

Pull ClickHouse data from staging into local dev ClickHouse.
Expects an SSH tunnel forwarding staging CH HTTP to localhost:18123.

Options:
  --days N          Number of days of history to pull (default: 14)
  --yes             Skip confirmation prompt
  --staging-port    Local port for staging CH tunnel (default: 18123)
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

CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://localhost:${LOCAL_CH_PORT}}"

# Compute cutoff date (cross-platform)
if date -v -1d >/dev/null 2>&1; then
  CUTOFF=$(date -v "-${DAYS}d" +%Y-%m-%d)
else
  CUTOFF=$(date -d "-${DAYS} days" +%Y-%m-%d)
fi

STAGING_CH="http://localhost:${STAGING_CH_PORT}"
LOCAL_CH="${CLICKHOUSE_URL}"

# Helpers: ClickHouse HTTP interface uses raw SQL in request body,
# or SQL in ?query= URL param when body carries data (INSERT).
ch_query() {
  local url="$1"
  local sql="$2"
  curl -sf "${url}/" -d "${sql}"
}

ch_query_silent() {
  local url="$1"
  local sql="$2"
  curl -sf "${url}/" -d "${sql}" >/dev/null
}

# URL-encode a string for use in query params
urlencode() {
  python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip(), safe=''))" <<< "$1"
}

echo "=== ClickHouse Staging Pull ==="
echo "  Staging CH:  ${STAGING_CH}"
echo "  Local CH:    ${LOCAL_CH}"
echo "  Cutoff date: ${CUTOFF} (${DAYS} days)"
echo

if [[ "${CONFIRM}" == "true" ]]; then
  echo "This will DROP and recreate all local ClickHouse tables."
  read -r -p "Type 'yes' to continue: " response
  if [[ "${response}" != "yes" ]]; then
    echo "Cancelled."
    exit 0
  fi
fi

# Verify staging tunnel
if ! ch_query "${STAGING_CH}" "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to staging ClickHouse at ${STAGING_CH}"
  echo "Ensure SSH tunnel is open."
  exit 1
fi
echo "Staging CH connection verified."

# Verify local CH
if ! ch_query "${LOCAL_CH}" "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to local ClickHouse at ${LOCAL_CH}"
  echo "Start dev services: mise run services-up"
  exit 1
fi
echo "Local CH connection verified."

run_node_tooling() {
  if command -v node >/dev/null 2>&1; then
    "$@"; return
  fi
  if command -v mise >/dev/null 2>&1; then
    mise exec node@24 -- "$@"; return
  fi
  echo "ERROR: Node.js is not available."; exit 1
}

# Step 1: Reset local ClickHouse
echo
echo "--- Resetting local ClickHouse ---"
for table in prices prices_current prices_chain_metadata schema_migrations; do
  ch_query_silent "${LOCAL_CH}" "DROP TABLE IF EXISTS ${table}"
done

echo "--- Running ClickHouse migrations ---"
run_node_tooling pnpm clickhouse:migrate

# Stream a SELECT from staging into an INSERT on local via TSV pipe.
# The SELECT query goes in the staging URL param; the INSERT query goes in the local URL param;
# TSV data flows through the pipe body.
ch_stream() {
  local src_url="$1"
  local dst_url="$2"
  local select_sql="$3"
  local dst_table="$4"
  local encoded_select
  encoded_select=$(urlencode "${select_sql}")
  local encoded_insert
  encoded_insert=$(urlencode "INSERT INTO ${dst_table} FORMAT TabSeparatedWithNames")
  # Use -T - (chunked upload from stdin) instead of --data-binary @- to avoid OOM on large tables
  curl -sf "${src_url}/?query=${encoded_select}" \
    | curl -sf -X POST "${dst_url}/?query=${encoded_insert}" -T -
}

# Step 2: Stream prices (date-filtered)
echo
echo "--- Importing prices (>= ${CUTOFF}) ---"
ch_stream "${STAGING_CH}" "${LOCAL_CH}" \
  "SELECT * FROM prices WHERE target_date >= '${CUTOFF}' FORMAT TabSeparatedWithNames" \
  "prices"
PRICES_COUNT=$(ch_query "${LOCAL_CH}" "SELECT count() FROM prices")
echo "  prices: ${PRICES_COUNT} rows"

# Step 3: Stream prices_current (full copy, pre-aggregated)
echo "--- Importing prices_current (full) ---"
ch_stream "${STAGING_CH}" "${LOCAL_CH}" \
  "SELECT * FROM prices_current FORMAT TabSeparatedWithNames" \
  "prices_current"
PC_COUNT=$(ch_query "${LOCAL_CH}" "SELECT count() FROM prices_current")
echo "  prices_current: ${PC_COUNT} rows"

# Step 4: Stream prices_chain_metadata (full copy)
echo "--- Importing prices_chain_metadata (full) ---"
ch_stream "${STAGING_CH}" "${LOCAL_CH}" \
  "SELECT * FROM prices_chain_metadata FORMAT TabSeparatedWithNames" \
  "prices_chain_metadata"
META_COUNT=$(ch_query "${LOCAL_CH}" "SELECT count() FROM prices_chain_metadata")
echo "  prices_chain_metadata: ${META_COUNT} rows"

# Step 5: Optimize tables
echo
echo "--- Optimizing tables ---"
for table in prices prices_current prices_chain_metadata; do
  ch_query_silent "${LOCAL_CH}" "OPTIMIZE TABLE ${table} FINAL"
done
echo "Optimization complete."

echo
echo "=== ClickHouse sync complete ==="
echo "  prices:               ${PRICES_COUNT} rows (>= ${CUTOFF})"
echo "  prices_current:       ${PC_COUNT} rows"
echo "  prices_chain_metadata: ${META_COUNT} rows"
