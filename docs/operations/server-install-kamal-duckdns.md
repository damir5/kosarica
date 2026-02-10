# Server Install Runbook: Kamal + DuckDNS (No Cloudflare)

This runbook is the canonical, repeatable setup for deploying Kosarica to a single Ubuntu server using Docker builds and Kamal deploys with direct public ingress on `kosarica.duckdns.org`.

## Scope and Constraints

- Origin host: Ubuntu 24.04 (Hetzner VPS class machine)
- Deploy model: Kamal deploys from local operator machine
- Ingress model: direct DNS (`kosarica.duckdns.org`) to server IP
- TLS model: Kamal proxy + Let's Encrypt
- SSH policy: key-based SSH from changing networks (no source IP allowlist)
- SSH key policy for this setup: no forced rotation workflow
- Data services: PostgreSQL (pgvector-enabled) + ClickHouse as Kamal accessories
- Observability: OpenTelemetry Collector + OpenObserve accessories

## 1. Operator Machine Prerequisites

Install locally (not on server):

```bash
# Ruby + bundler if missing
ruby -v

# Kamal CLI
gem install kamal

# Docker (for image build)
docker --version

# Access check
ssh root@kosarica.duckdns.org
```

Container registry mode:

- This setup uses Kamal local registry mode (`registry.server: localhost:5500`).
- No external registry credentials are required.
- If you run Kamal from macOS, avoid `localhost:5000` because it can conflict with system services (AirTunes/AirPlay) and break remote pulls.

## 2. One-Time Server Bootstrap (Ubuntu)

Run as `root` over SSH:

```bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release jq ufw fail2ban unattended-upgrades apt-transport-https

# Docker
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
fi
systemctl enable --now docker

# Docker logging defaults
cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
JSON
systemctl restart docker

# Persistent data paths
mkdir -p \
  /var/lib/kosarica/postgres \
  /var/lib/kosarica/clickhouse \
  /var/lib/kosarica/openobserve \
  /var/lib/kosarica/sourcemaps \
  /app/data \
  /app/logs

# Firewall policy: keep SSH open globally for roaming admin networks
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl enable --now fail2ban
```

Verification:

```bash
docker --version
ufw status verbose
systemctl is-active docker fail2ban
```

## 3. DuckDNS Setup

You already configured:

- hostname: `kosarica.duckdns.org`

Validate it resolves to your server IP:

```bash
dig +short kosarica.duckdns.org A
curl -I http://kosarica.duckdns.org
```

Optional (recommended) dynamic IP updater if your server IP might change:

```bash
cat >/usr/local/bin/duckdns-update.sh <<'BASH'
#!/usr/bin/env bash
set -euo pipefail
# fill these once
DOMAIN="kosarica"
TOKEN="<duckdns-token>"

curl -fsS "https://www.duckdns.org/update?domains=${DOMAIN}&token=${TOKEN}&ip="
BASH
chmod +x /usr/local/bin/duckdns-update.sh
```

## 4. Repo Deployment Configuration

This repository is configured for:

- App image built from `Dockerfile`
- Kamal deploy via `kamal.yml`
- Kamal proxy TLS termination on `kosarica.duckdns.org`
- Accessories: `postgres`, `clickhouse`, `opentelemetry-collector`, `openobserve`
- Postgres accessory image: `pgvector/pgvector:pg16` (required for `vector` extension migrations)
- OTel config file mounted from `deployment/otel-collector-config.yaml`

## 5. Production Secrets and Env

Create `.kamal/secrets` (local, not committed) before running Kamal:

```bash
mkdir -p .kamal
cat > .kamal/secrets <<'EOF'
POSTGRES_PASSWORD=<strong-password>
DATABASE_URL=postgresql://kosarica:<strong-password>@kosarica-postgres:5432/kosarica
BETTER_AUTH_SECRET=<min-32-char-secret>
BETTER_AUTH_URL=https://kosarica.duckdns.org
PASSKEY_RP_ID=kosarica.duckdns.org
PASSKEY_RP_NAME=Kosarica
ZO_ROOT_USER_EMAIL=admin@kosarica.local
ZO_ROOT_USER_PASSWORD=<strong-password>
ZO_ORG_ID=default
ZO_BASIC_AUTH=$(printf '%s:%s' "$ZO_ROOT_USER_EMAIL" "$ZO_ROOT_USER_PASSWORD" | base64 | tr -d '\n')
EOF
chmod 600 .kamal/secrets
```

Optional (provide when enabling semantic/LLM workflows in production):

- `OPENROUTER_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`

## 6. First Deploy and Post-Deploy Tasks

```bash
# first-time host prep by Kamal
kamal setup

# deploy app + accessories
kamal deploy

# run DB migrations from operator machine via temporary SSH tunnel
PG_IP=$(ssh root@kosarica.duckdns.org "docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' kosarica-postgres")
PG_PASS=$(sed -n 's/^POSTGRES_PASSWORD=//p' .kamal/secrets)
ssh -f -N -L 55432:${PG_IP}:5432 root@kosarica.duckdns.org
DATABASE_URL="postgresql://kosarica:${PG_PASS}@127.0.0.1:55432/kosarica" pnpm db:migrate
pkill -f "ssh -f -N -L 55432:${PG_IP}:5432 root@kosarica.duckdns.org" || true

# verify status and logs
kamal app version
kamal app containers
kamal app logs --lines 200
```

Smoke checks:

```bash
curl -fsS https://kosarica.duckdns.org/
```

## 7. Observability Runbook

OpenObserve is internal-only in this setup.

Use SSH local forwarding when needed:

```bash
ssh -L 5080:localhost:5080 root@kosarica.duckdns.org
# then open http://localhost:5080 locally
```

Telemetry flow:

- App -> `kosarica-opentelemetry-collector:4317`
- Collector -> `kosarica-openobserve:5080/api/${ZO_ORG_ID}` (OTLP appends `/v1/logs`, `/v1/metrics`, `/v1/traces`)

Quick checks:

```bash
kamal accessory logs opentelemetry-collector --lines 200
kamal accessory logs openobserve --lines 200
kamal accessory details opentelemetry-collector
kamal accessory details openobserve
```

## 8. Backup, Retention, and Recovery

Create backup script `/usr/local/bin/kosarica-backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=/var/backups/kosarica
mkdir -p "$BACKUP_DIR"

STAMP=$(date -u +"%Y%m%dT%H%M%SZ")
docker exec $(docker ps --filter name=postgres --format '{{.Names}}' | head -n1) \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "$BACKUP_DIR/postgres-${STAMP}.sql.gz"

find "$BACKUP_DIR" -type f -name 'postgres-*.sql.gz' -mtime +30 -delete
```

Schedule nightly cron (example 02:10 UTC):

```bash
10 2 * * * /usr/local/bin/kosarica-backup.sh >/var/log/kosarica-backup.log 2>&1
```

Also keep sourcemap retention policy (monthly prune, keep newest 20 releases).

## 9. Security and Ops Recommendations

1. Keep SSH key auth only; disable password auth.
2. Keep SSH reachable from any network if required, but keep fail2ban enabled.
3. Keep OpenObserve internal-only; access via SSH forward.
4. Add health monitoring for:
   - `https://kosarica.duckdns.org/`
   - disk usage on `/var/lib/kosarica`
5. Test rollback at least once:

```bash
kamal rollback
```

## 10. What Was Applied on `kosarica.private` (2026-02-10)

Applied on host:

- Docker Engine installed and enabled
- `ufw` active (`22/tcp`, `80/tcp`, `443/tcp` allowed; default deny inbound)
- `fail2ban` enabled
- persistent directories created under `/var/lib/kosarica` and `/app`
- `/etc/docker/daemon.json` configured for Docker json log rotation
- Kamal proxy + app deployed successfully on `https://kosarica.duckdns.org`
- PostgreSQL migrations applied against production database
- OpenTelemetry Collector + OpenObserve running with successful OTLP ingest (`/api/default/v1/logs` and `/api/default/v1/metrics` HTTP 200)

Not applied automatically (requires your credentials/secrets):

- LLM/provider keys if you enable semantic workflows (`OPENROUTER_API_KEY`, etc.)
- backup cron configuration and off-host backup copy policy
