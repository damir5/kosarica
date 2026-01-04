# External Integrations

## Cloudflare Services

### D1 Database
- **Binding**: `DB`
- **Purpose**: SQLite database for all application data
- **Config**: `wrangler.jsonc` → `d1_databases`
- **Migrations**: `drizzle/` directory, applied via `wrangler d1 migrations apply`

### R2 Object Storage
- **Binding**: `INGESTION_BUCKET`
- **Bucket name**: `kosarica-data`
- **Purpose**: Store fetched price files, parsed JSON results
- **Config**: `wrangler.jsonc` → `r2_buckets`

### Queues
- **Producer binding**: `INGESTION_QUEUE`
- **Queue name**: `price-ingestion`
- **Dead letter queue**: `INGESTION_DLQ` / `price-ingestion-dlq`
- **Max batch size**: 10
- **Max retries**: 3
- **Purpose**: Async processing of discover/fetch/parse/persist jobs

### Scheduled Triggers (Crons)
- **Schedule**: `0 6 * * *` (6:00 AM UTC daily)
- **Purpose**: Automated daily price ingestion

## Retail Chain Price Portals

### Chains Integrated
| Chain | Format | URL Pattern | Encoding |
|-------|--------|-------------|----------|
| Konzum | CSV | `konzum.hr/cjenik` | UTF-8 |
| Lidl | CSV/ZIP | `lidl.hr/cjenik` | UTF-8 |
| Plodine | CSV | `plodine.hr/cjenik` | Windows-1250 |
| Interspar | CSV | `interspar.hr/cjenik` | UTF-8 |
| Studenac | XML | `studenac.hr/cjenik` | UTF-8 |
| Kaufland | CSV | `kaufland.hr/cjenik` | UTF-8 (tab-delimited) |
| Eurospin | CSV | `eurospin.hr/cjenik` | UTF-8 |
| DM | XLSX | `dm.hr/cjenik` | - |
| KTC | CSV | `ktc.hr/cjenik` | Windows-1250 |
| Metro | XML | `metro.hr/cjenik` | UTF-8 |
| Trgocentar | CSV | `trgocentar.hr/cjenik` | Windows-1250 |

### Integration Pattern
1. **Discovery**: Scrape portal HTML for file links
2. **Fetch**: Download with rate limiting (configurable per chain)
3. **Parse**: Chain-specific adapters normalize data
4. **Store Resolution**: Map filename/portal ID to store records

## Authentication

### Better Auth
- **Provider**: Email/password + Passkey (WebAuthn)
- **Endpoint**: `/api/auth/*`
- **Tables**: `user`, `session`, `account`, `verification`, `passkey`

### Environment Variables
```
BETTER_AUTH_SECRET  # JWT signing secret
BETTER_AUTH_URL     # Base URL (http://localhost:3000)
PASSKEY_RP_ID       # Relying Party ID (localhost)
PASSKEY_RP_NAME     # Relying Party Name (Kosarica App)
```

## Configuration Requirements

### `.dev.vars` (local development)
```
BETTER_AUTH_SECRET=<32+ character secret>
BETTER_AUTH_URL=http://localhost:3000
PASSKEY_RP_ID=localhost
PASSKEY_RP_NAME=Kosarica App
```

### Wrangler Environment Variables
Set in `wrangler.jsonc` → `vars`:
- `BETTER_AUTH_URL`
- `INGESTION_CHAINS` (comma-separated chain list, empty = all)
- `MAX_RETRIES`

### Secrets (via `wrangler secret put`)
- `BETTER_AUTH_SECRET`
