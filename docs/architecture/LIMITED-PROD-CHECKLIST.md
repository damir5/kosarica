# Limited Production Checklist (Single CX43)

Use this checklist before first limited production release to avoid missing infra, keys, agents, and observability wiring.

Primary setup reference: `docs/operations/server-install-kamal.md`

## 1. Server Baseline

Target: Hetzner `CX43` (8 vCPU, 16 GB RAM, 160 GB SSD)

Install once:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg jq ufw fail2ban
curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

Optional but recommended:

- `htop`
- `ncdu`
- `git`

## 2. Network and TLS

- DuckDNS hostname points directly to origin IP.
- Origin inbound ports open: `22`, `80`, `443`.
- All other inbound ports denied.
- TLS via Kamal proxy and Let's Encrypt.
- SSH remains globally reachable by key (no source IP allowlist in this environment).
- OpenObserve UI **not** publicly exposed without protection.

Firewall setup:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 3. Docker/Kamal Prerequisites

Operator machine (not necessarily server):

- Ruby + `kamal` installed.
- SSH key to server configured.
- No external registry credentials needed when using Kamal local registry mode (`localhost:5500`).

Required deployment files:

- `kamal.yml`
- production env file with all secrets
- `deployment/otel-collector-config.yaml`

## 4. Required Runtime Services

Must exist for limited production:

- app container (`kosarica`)
- PostgreSQL
- ClickHouse
- OpenTelemetry Collector
- OpenObserve
- Kamal proxy (`kamal-proxy`) for TLS/public ingress

## 5. Persistent Host Paths

Create and verify ownership/space:

- `/var/lib/kosarica/postgres`
- `/var/lib/kosarica/clickhouse`
- `/var/lib/kosarica/openobserve`
- `/var/lib/kosarica/sourcemaps`
- `/app/data` (mounted app data)
- `/app/logs` (mounted app logs)

## 6. Secrets and Keys Inventory

### Core app

- `DATABASE_URL`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `PASSKEY_RP_ID`
- `PASSKEY_RP_NAME`

### ClickHouse

- `CLICKHOUSE_URL`
- `CLICKHOUSE_DATABASE` (optional)
- `CLICKHOUSE_USERNAME` (optional)
- `CLICKHOUSE_PASSWORD` (optional)

### OpenObserve and collector

- `ZO_ROOT_USER_EMAIL`
- `ZO_ROOT_USER_PASSWORD`
- `ZO_ORG_ID`
- `ZO_BASIC_AUTH`

### Release and telemetry

- `APP_VERSION`
- `APP_RELEASE`
- `BUILD_TIME`
- `GIT_COMMIT`
- `BUILD_ENV`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_SERVICE_NAME`
- `NODE_OPTIONS=--enable-source-maps`

### PostHog (optional now, required when enabled)

- `VITE_POSTHOG_ENABLED`
- `VITE_POSTHOG_KEY`
- `VITE_POSTHOG_HOST`
- `VITE_POSTHOG_SESSION_REPLAY_SAMPLE_RATE`

### Ads (future)

- `ADS_CONVERSION_ENABLED`
- `GOOGLE_ADS_CONVERSION_ID`
- `GOOGLE_ADS_CONVERSION_LABEL`

### Local analysis/reporting agent

- `OBS_AGENT_API_TOKEN` (read-only)
- `POSTHOG_PERSONAL_API_KEY` (read-only, optional)

## 7. Local Agent Setup (Server-Side)

For the separate local agent process:

- Run as dedicated system user (no sudo).
- Grant read-only API tokens only.
- Restrict outbound network to required endpoints.
- Store credentials outside repo (systemd env file or secret manager).

Expected capabilities:

- query OpenObserve logs/traces
- query PostHog analytics (if enabled)
- produce daily markdown/json report

## 8. Deploy Steps (Limited Production)

1. `kamal setup` (first time)
2. `kamal deploy`
3. verify app and accessories:

```bash
kamal app version
kamal app containers
kamal app logs
```

4. smoke checks:

```bash
curl -f https://kosarica.chickenkiller.com/
kamal accessory logs openobserve --lines 100
```

## 9. Verification Matrix

- Admin config page shows expected `App Version` and `App Release`.
- OpenObserve receives logs, metrics, and traces.
- Client error endpoint `/api/client-errors` returns `204` on test payload.
- Task worker and scheduler are healthy.
- ClickHouse-backed endpoints return data.

## 10. Backup and Retention

- Daily Postgres backup cron enabled.
- OpenObserve data retention policy configured.
- Sourcemap retention policy configured (`/var/lib/kosarica/sourcemaps`).

## 11. Go/No-Go Before Traffic

All must be true:

- [ ] secrets loaded and validated
- [ ] observability pipeline healthy
- [ ] release metadata visible in logs/admin
- [ ] blue/green rollback procedure tested once
- [ ] local agent can generate report with read-only tokens
- [ ] PostHog strict privacy mode verified (if enabled)
- [ ] ads conversion flags remain disabled until ad rollout
