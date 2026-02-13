#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <parquet-file-path>" >&2
  exit 1
fi

FILE_PATH="$1"
if [[ ! -f "$FILE_PATH" ]]; then
  echo "File not found: $FILE_PATH" >&2
  exit 1
fi

CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://localhost:8123}"
CLICKHOUSE_DATABASE="${CLICKHOUSE_DATABASE:-default}"
CLICKHOUSE_IMPORT_TIMEOUT_MS="${CLICKHOUSE_IMPORT_TIMEOUT_MS:-1800000}"
TIMEOUT_SECONDS=$(( (CLICKHOUSE_IMPORT_TIMEOUT_MS + 999) / 1000 ))

QUERY_URL="${CLICKHOUSE_URL}?query=INSERT%20INTO%20prices%20FORMAT%20Parquet&database=${CLICKHOUSE_DATABASE}"

CURL_ARGS=(
  --silent
  --show-error
  --fail-with-body
  --request POST
  --header "content-type: application/octet-stream"
  --max-time "${TIMEOUT_SECONDS}"
  --data-binary "@${FILE_PATH}"
  "${QUERY_URL}"
)

if [[ -n "${CLICKHOUSE_USERNAME:-}" ]]; then
  CURL_ARGS+=(--user "${CLICKHOUSE_USERNAME}:${CLICKHOUSE_PASSWORD:-}")
fi

curl "${CURL_ARGS[@]}"
