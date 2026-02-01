#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH="${DRIZZLE_CONFIG:-drizzle.config.ts}"
MIGRATIONS_DIR="${DRIZZLE_MIGRATIONS_DIR:-drizzle}"
LOG_PATH="${DRIZZLE_MIGRATE_LOG:-/tmp/price-service-migrate.log}"

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
