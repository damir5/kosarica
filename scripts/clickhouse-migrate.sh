#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=""
if [ -n "${NODE_ENV:-}" ] && [ -f ".env.${NODE_ENV}" ]; then
  ENV_FILE=".env.${NODE_ENV}"
elif [ -f ".env.test" ]; then
  ENV_FILE=".env.test"
elif [ -f ".env.development" ]; then
  ENV_FILE=".env.development"
elif [ -f ".env" ]; then
  ENV_FILE=".env"
fi

if [ -z "${CLICKHOUSE_URL:-}" ] && [ -n "${ENV_FILE}" ]; then
  echo "==> Loading environment from ${ENV_FILE}"
  set -a
  source "${ENV_FILE}"
  set +a
fi

if [ -z "${CLICKHOUSE_URL:-}" ]; then
  echo "CLICKHOUSE_URL is not set. Define it or create .env.test/.env.development/.env."
  exit 1
fi

tsx scripts/clickhouse-migrate.ts "$@"
