#!/usr/bin/env bash
set -euo pipefail

# Load environment variables based on NODE_ENV
ENV_FILE="${NODE_ENV:+.env.$NODE_ENV}"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
elif [ -f ".env" ]; then
  set -a
  source .env
  set +a
fi

CONFIG_PATH="${DRIZZLE_CONFIG:-drizzle.config.ts}"
MIGRATIONS_DIR="${DRIZZLE_MIGRATIONS_DIR:-drizzle}"
LOG_PATH="${DRIZZLE_MIGRATE_LOG:-/tmp/kosarica-migrate.log}"

echo "==> Running Drizzle migrations"
echo "Config: ${CONFIG_PATH}"
echo "Migrations dir: ${MIGRATIONS_DIR}"
echo "Log: ${LOG_PATH}"

if [ -d "${MIGRATIONS_DIR}" ]; then
  echo "Migrations:"
  if ls -1 "${MIGRATIONS_DIR}"/*.sql >/dev/null 2>&1; then
    ls -1 "${MIGRATIONS_DIR}"/*.sql | sed 's#^#  - #'
  else
    echo "  (none found)"
  fi
else
  echo "Migrations dir not found: ${MIGRATIONS_DIR}"
fi

echo "Command: drizzle-kit migrate --config ${CONFIG_PATH}"
drizzle-kit migrate --config "${CONFIG_PATH}" 2>&1 | tee "${LOG_PATH}"
