# Operations Guide

Central operations reference for the Kosarica staging environment and tooling.

---

## Secrets

All secrets live in `../shared/secrets/` — a directory shared between host and container.
See [`../shared/secrets/README.md`](../shared/secrets/README.md) for full details.

```
../shared/secrets/
├── setup.sh                    # Run after fresh container to restore symlinks
├── ssh/kosarica_staging        # Ed25519 private key for staging SSH
├── kamal/secrets               # Kamal deploy secrets (symlinked to .kamal/secrets)
└── api-keys/staging-claude-agent  # API key for programmatic oRPC access
```

**After fresh container**: `bash ../shared/secrets/setup.sh`

---

## Quick Reference

```bash
# API key call to staging
curl -X POST -H "Content-Type: application/json" \
  -H "x-api-key: $(cat ../shared/secrets/api-keys/staging-claude-agent)" \
  -d '{}' https://kosarica.chickenkiller.com/api/rpc/admin/cron/list

# SSH to staging server
ssh kosarica-staging

# Run script in app container
ssh kosarica-staging "docker exec kosarica-web-1 npx tsx scripts/knowledge-kpi.ts"

# DB query via psql
ssh kosarica-staging "docker exec kosarica-postgres psql -U kosarica kosarica -c 'SELECT count(*) FROM retailer_items'"
```

---

## Service Account (API Key)

### How it works

Better Auth's **API Key plugin** is configured with `enableSessionForAPIKeys: true`. When a request includes an `x-api-key` header, the plugin creates a mock session from the key's linked user — the same session object that `auth.api.getSession()` returns for cookie-based logins. This means **all existing oRPC middleware works unchanged**.

### Creating a key

```bash
# On a machine with DB access (local dev or staging container)
npx tsx scripts/create-service-account.ts

# Custom key name
npx tsx scripts/create-service-account.ts --name my-custom-key
```

The script:
1. Creates (or finds) a superadmin user `agent@kosarica.local`
2. Generates an API key with prefix `kos_`
3. Prints the full key **once** — store it in `../shared/secrets/api-keys/`

### Storing the key

```bash
# Save to shared secrets (persists across container restarts)
echo "kos_xxxxx" > ../shared/secrets/api-keys/staging-claude-agent
chmod 600 ../shared/secrets/api-keys/staging-claude-agent
```

### Rate limits

- 1000 requests per 24-hour window per key
- Tracked in the `apikey` table (`requestCount`, `lastRequest`)

### Revoking a key

Disable via DB:
```sql
UPDATE apikey SET enabled = false WHERE name = 'claude-agent';
```

Or delete:
```sql
DELETE FROM apikey WHERE name = 'claude-agent';
```

---

## SSH Access to Staging

SSH key lives in `../shared/secrets/ssh/kosarica_staging`. The `setup.sh` script symlinks it to `~/.ssh/` and adds the SSH config entry.

### Manual setup (if not using setup.sh)

1. Generate key pair:
   ```bash
   ssh-keygen -t ed25519 -C "claude-agent@kosarica" -f ../shared/secrets/ssh/kosarica_staging -N ""
   ```

2. Add public key to server:
   ```bash
   cat ../shared/secrets/ssh/kosarica_staging.pub
   # Add to root@kosarica.chickenkiller.com:~/.ssh/authorized_keys
   ```

3. Symlink and configure:
   ```bash
   bash ../shared/secrets/setup.sh
   ```

### Common commands

```bash
# Test connectivity
ssh kosarica-staging "hostname"

# Run a script inside the app container
ssh kosarica-staging "docker exec kosarica-web-1 npx tsx scripts/knowledge-kpi.ts"

# Interactive shell in container
ssh kosarica-staging "docker exec -it kosarica-web-1 bash"

# View recent app logs
ssh kosarica-staging "docker logs kosarica-web-1 --tail 100"

# DB access via psql
ssh kosarica-staging "docker exec kosarica-postgres psql -U kosarica kosarica -c 'SELECT count(*) FROM retailer_items'"

# List running containers
ssh kosarica-staging "docker ps --format 'table {{.Names}}\t{{.Status}}'"
```

---

## Staging Server

- **Host**: `kosarica.chickenkiller.com`
- **User**: `root`
- **Containers**: Managed by Kamal
  - `kosarica-web-*` — Node.js app
  - `kosarica-postgres` — PostgreSQL
  - `kosarica-clickhouse` — ClickHouse
  - `kosarica-openobserve` — OpenObserve (logs/metrics/traces)
  - `kosarica-otel-collector` — OpenTelemetry Collector
- **Detailed setup**: [docs/operations/server-install-kamal.md](./docs/operations/server-install-kamal.md)

---

## Operational Playbooks

- **Catalog loop**: [knowledge/playbooks/catalog-playbook.md](./knowledge/playbooks/catalog-playbook.md)
- **Stores loop**: [knowledge/playbooks/stores-playbook.md](./knowledge/playbooks/stores-playbook.md)

---

## Monitoring & Observability

OpenObserve runs on staging but is **not publicly exposed**. Access via SSH tunnel:

```bash
ssh -L 5080:kosarica-openobserve:5080 root@kosarica.chickenkiller.com -N &
open http://localhost:5080
```

Credentials are in `../shared/secrets/kamal/secrets` (`ZO_ROOT_USER_PASSWORD`).

- **Detailed guide**: [docs/operations/observability.md](./docs/operations/observability.md)

---

## Deployment

```bash
mise run deploy-staging
```

- **Detailed guide**: [docs/architecture/DEPLOYMENT.md](./docs/architecture/DEPLOYMENT.md)

---

## Data & Pipelines

- **Ingestion pipeline**: [docs/operations/ingestion-pipeline.md](./docs/operations/ingestion-pipeline.md)
- **Storage architecture**: [docs/operations/storage-architecture.md](./docs/operations/storage-architecture.md)
- **Matching analysis**: [docs/operations/matching-analysis.md](./docs/operations/matching-analysis.md)
