#!/usr/bin/env bash
set -euo pipefail

# Respect existing DATABASE_URL when provided by caller. Otherwise load env file.
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

if [ -z "${DATABASE_URL:-}" ] && [ -n "${ENV_FILE}" ]; then
  echo "==> Loading environment from ${ENV_FILE}"
  set -a
  source "${ENV_FILE}"
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. Define it or create .env.test/.env.development/.env."
  exit 1
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
