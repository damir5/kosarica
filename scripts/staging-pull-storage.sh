#!/usr/bin/env bash
set -euo pipefail

# Pull storage files (archives + parquet) from staging to local dev.
# Usage: ./scripts/staging-pull-storage.sh [--days N] [--yes]

DAYS=14
CONFIRM=true
STAGING_HOST="root@kosarica.duckdns.org"
REMOTE_STORAGE="/app/data/storage"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --days)   DAYS="$2"; shift 2 ;;
    --yes|-y) CONFIRM=false; shift ;;
    --help|-h)
      cat <<'EOF'
Usage: staging-pull-storage.sh [--days N] [--yes]

Rsync storage files (archives + parquet) from staging to local dev.
Only syncs date directories within the cutoff range.

Options:
  --days N    Number of days of history to pull (default: 14)
  --yes       Skip confirmation prompt
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

STORAGE_PATH="${STORAGE_PATH:-./data/storage}"
TEMP_STORAGE_PATH="${TEMP_STORAGE_PATH:-./data/temp}"

echo "=== Storage Staging Pull ==="
echo "  Remote:      ${STAGING_HOST}:${REMOTE_STORAGE}"
echo "  Local:       ${STORAGE_PATH}"
echo "  Days:        ${DAYS}"
echo

if [[ "${CONFIRM}" == "true" ]]; then
  echo "This will clear local storage and rsync from staging."
  read -r -p "Type 'yes' to continue: " response
  if [[ "${response}" != "yes" ]]; then
    echo "Cancelled."
    exit 0
  fi
fi

# Verify SSH connectivity
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "${STAGING_HOST}" "true" 2>/dev/null; then
  echo "ERROR: Cannot SSH to ${STAGING_HOST}"
  exit 1
fi
echo "SSH connection verified."

# Build date include patterns for rsync
build_date_includes() {
  local days="$1"
  local includes=""
  for i in $(seq 0 "$days"); do
    local d
    if date -v -1d >/dev/null 2>&1; then
      d=$(date -v "-${i}d" +%Y-%m-%d)
    else
      d=$(date -d "-${i} days" +%Y-%m-%d)
    fi
    includes="${includes} --include=${d}/ --include=${d}/**"
  done
  echo "${includes}"
}

DATE_INCLUDES=$(build_date_includes "${DAYS}")

# Clear local storage
echo
echo "--- Clearing local storage ---"
for dir in "${STORAGE_PATH}" "${TEMP_STORAGE_PATH}"; do
  if [[ -z "${dir}" || "${dir}" == "/" ]]; then
    echo "ERROR: Refusing to delete unsafe directory path: '${dir}'"
    exit 1
  fi
  rm -rf "${dir}"
  mkdir -p "${dir}"
done

# Rsync archives (chain_slug/date/ structure)
echo "--- Syncing archives ---"
mkdir -p "${STORAGE_PATH}/archives"
# shellcheck disable=SC2086
rsync -avz --progress \
  --include='*/' \
  ${DATE_INCLUDES} \
  --exclude='*' \
  "${STAGING_HOST}:${REMOTE_STORAGE}/archives/" \
  "${STORAGE_PATH}/archives/" \
  2>/dev/null || echo "  (no archive files matched or archives dir not found)"

# Rsync parquet files (chain_slug/date/ structure)
echo
echo "--- Syncing parquet files ---"
mkdir -p "${STORAGE_PATH}/parquet"
# shellcheck disable=SC2086
rsync -avz --progress \
  --include='*/' \
  ${DATE_INCLUDES} \
  --exclude='*' \
  "${STAGING_HOST}:${REMOTE_STORAGE}/parquet/" \
  "${STORAGE_PATH}/parquet/" \
  2>/dev/null || echo "  (no parquet files matched or parquet dir not found)"

echo
echo "=== Storage sync complete ==="
if command -v du >/dev/null 2>&1; then
  ARCHIVES_SIZE=$(du -sh "${STORAGE_PATH}/archives" 2>/dev/null | cut -f1 || echo "0")
  PARQUET_SIZE=$(du -sh "${STORAGE_PATH}/parquet" 2>/dev/null | cut -f1 || echo "0")
  echo "  archives: ${ARCHIVES_SIZE}"
  echo "  parquet:  ${PARQUET_SIZE}"
fi
