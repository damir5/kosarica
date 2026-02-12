#!/usr/bin/env bash
set -euo pipefail

# Orchestrator: pull recent data from staging to local dev.
# Opens SSH tunnels, calls sub-scripts, cleans up on exit.
# Usage: mise run staging-pull [--days N] [--storage] [--yes]
#
# NOTE: Tailscale MagicDNS breaks resolution of kosarica.chickenkiller.com.
# Disable Tailscale before running, or add the IP to /etc/hosts.

DAYS=14
CONFIRM=true
SYNC_STORAGE=false
TUNNEL_PID=""

STAGING_HOST="root@kosarica.chickenkiller.com"
LOCAL_PG_TUNNEL_PORT=15432
LOCAL_CH_TUNNEL_PORT=18123

cleanup() {
  if [[ -n "${TUNNEL_PID}" ]]; then
    echo
    echo "--- Closing SSH tunnel (PID ${TUNNEL_PID}) ---"
    kill "${TUNNEL_PID}" 2>/dev/null || true
    wait "${TUNNEL_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --days)    DAYS="$2"; shift 2 ;;
    --yes|-y)  CONFIRM=false; shift ;;
    --storage) SYNC_STORAGE=true; shift ;;
    --help|-h)
      cat <<'EOF'
Usage: staging-pull.sh [--days N] [--storage] [--yes]

Pull a recent slice of staging data into local dev environment.
Syncs PostgreSQL, ClickHouse, and optionally file storage.

Options:
  --days N    Number of days of history to pull (default: 14)
  --storage   Also sync file storage (archives + parquet) via rsync
  --yes       Skip all confirmation prompts
EOF
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# Read staging PG password
KAMAL_SECRETS=".kamal/secrets"
if [[ ! -f "${KAMAL_SECRETS}" ]]; then
  echo "ERROR: ${KAMAL_SECRETS} not found. Cannot read staging credentials."
  exit 1
fi

echo "============================================"
echo "  Staging → Local Data Pull"
echo "============================================"
echo "  Days:    ${DAYS}"
echo "  Storage: ${SYNC_STORAGE}"
echo "  Host:    ${STAGING_HOST}"
echo

if [[ "${CONFIRM}" == "true" ]]; then
  echo "This will RESET your local dev databases and import staging data."
  read -r -p "Type 'yes' to continue: " response
  if [[ "${response}" != "yes" ]]; then
    echo "Cancelled."
    exit 0
  fi
  echo
fi

# Step 1: Verify SSH connectivity
echo "--- Verifying SSH access ---"
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "${STAGING_HOST}" "true" 2>/dev/null; then
  echo "ERROR: Cannot SSH to ${STAGING_HOST}"
  echo "Ensure you have SSH access configured (key-based auth)."
  exit 1
fi
echo "SSH connection OK."

# Step 2: Start local dev services
echo
echo "--- Starting local dev services ---"
docker compose --profile dev up -d postgres clickhouse

# Wait for local Postgres
echo -n "Waiting for local Postgres..."
for _ in $(seq 1 60); do
  if docker exec ade-postgres pg_isready -U kosarica -d kosarica >/dev/null 2>&1; then
    echo " ready."
    break
  fi
  sleep 1
done
if ! docker exec ade-postgres pg_isready -U kosarica -d kosarica >/dev/null 2>&1; then
  echo " FAILED"
  exit 1
fi

# Wait for local ClickHouse
echo -n "Waiting for local ClickHouse..."
for _ in $(seq 1 60); do
  if docker exec ade-clickhouse clickhouse-client --query "SELECT 1" >/dev/null 2>&1; then
    echo " ready."
    break
  fi
  sleep 1
done
if ! docker exec ade-clickhouse clickhouse-client --query "SELECT 1" >/dev/null 2>&1; then
  echo " FAILED"
  exit 1
fi

# Step 3: Open SSH tunnels (PG + CH)
# Kamal containers are on a Docker network — container names aren't resolvable
# from the host. Look up container IPs via docker inspect on the remote.
echo
echo "--- Resolving staging container IPs ---"
PG_IP=$(ssh -o ConnectTimeout=5 "${STAGING_HOST}" \
  "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' kosarica-postgres" 2>/dev/null)
CH_IP=$(ssh -o ConnectTimeout=5 "${STAGING_HOST}" \
  "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' kosarica-clickhouse" 2>/dev/null)

if [[ -z "${PG_IP}" || -z "${CH_IP}" ]]; then
  echo "ERROR: Could not resolve container IPs on staging."
  echo "  PG IP: ${PG_IP:-not found}"
  echo "  CH IP: ${CH_IP:-not found}"
  echo "Ensure kosarica-postgres and kosarica-clickhouse containers are running."
  exit 1
fi
echo "  PG: ${PG_IP}:5432"
echo "  CH: ${CH_IP}:8123"

echo
echo "--- Opening SSH tunnels ---"
ssh -f -N -o ExitOnForwardFailure=yes \
  -L "${LOCAL_PG_TUNNEL_PORT}:${PG_IP}:5432" \
  -L "${LOCAL_CH_TUNNEL_PORT}:${CH_IP}:8123" \
  "${STAGING_HOST}"

# Find the tunnel PID
TUNNEL_PID=$(pgrep -f "ssh.*-L.*${LOCAL_PG_TUNNEL_PORT}:${PG_IP}" | tail -1)
echo "SSH tunnel PID: ${TUNNEL_PID}"

# Read staging PG password for tunnel verification
STAGING_PG_PASS=$(grep '^POSTGRES_PASSWORD=' "${KAMAL_SECRETS}" | head -1 | cut -d= -f2-)

# Wait for tunnel to establish and verify PG connectivity
echo -n "Verifying PG tunnel..."
PG_TUNNEL_OK=false
for _ in $(seq 1 10); do
  if psql --no-psqlrc "postgresql://kosarica:${STAGING_PG_PASS}@localhost:${LOCAL_PG_TUNNEL_PORT}/kosarica" -c "SELECT 1" >/dev/null 2>&1; then
    PG_TUNNEL_OK=true
    break
  fi
  sleep 1
done
if [[ "${PG_TUNNEL_OK}" != "true" ]]; then
  echo " FAILED"
  echo "ERROR: PG tunnel verification failed on port ${LOCAL_PG_TUNNEL_PORT}"
  exit 1
fi
echo " OK"

echo -n "Verifying CH tunnel..."
CH_TUNNEL_OK=false
for _ in $(seq 1 10); do
  if curl -sf "http://localhost:${LOCAL_CH_TUNNEL_PORT}/" -d "SELECT 1" >/dev/null 2>&1; then
    CH_TUNNEL_OK=true
    break
  fi
  sleep 1
done
if [[ "${CH_TUNNEL_OK}" != "true" ]]; then
  echo " FAILED"
  echo "ERROR: CH tunnel verification failed on port ${LOCAL_CH_TUNNEL_PORT}"
  exit 1
fi
echo " OK"

# Step 4: Run PostgreSQL sync
echo
echo "============================================"
echo "  Phase 1: PostgreSQL"
echo "============================================"
bash "${SCRIPT_DIR}/staging-pull-pg.sh" --days "${DAYS}" --yes --staging-port "${LOCAL_PG_TUNNEL_PORT}"

# Step 5: Run ClickHouse sync
echo
echo "============================================"
echo "  Phase 2: ClickHouse"
echo "============================================"
bash "${SCRIPT_DIR}/staging-pull-ch.sh" --days "${DAYS}" --yes --staging-port "${LOCAL_CH_TUNNEL_PORT}"

# Step 6: Optionally sync storage
if [[ "${SYNC_STORAGE}" == "true" ]]; then
  echo
  echo "============================================"
  echo "  Phase 3: File Storage"
  echo "============================================"
  bash "${SCRIPT_DIR}/staging-pull-storage.sh" --days "${DAYS}" --yes
fi

# Summary
echo
echo "============================================"
echo "  Staging pull complete!"
echo "============================================"
echo "  PostgreSQL: synced (full tables + ${DAYS} days of time-series)"
echo "  ClickHouse: synced (${DAYS} days of prices)"
if [[ "${SYNC_STORAGE}" == "true" ]]; then
  echo "  Storage:    synced (${DAYS} days of archives + parquet)"
else
  echo "  Storage:    skipped (use --storage to include)"
fi
echo
echo "Start dev server: mise run dev"
