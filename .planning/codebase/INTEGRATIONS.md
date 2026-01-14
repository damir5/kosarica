# External Integrations

**Analysis Date:** 2026-01-14

## APIs & External Services

**Geocoding Service:**
- Nominatim (OpenStreetMap) - `src/ingestion/services/geocoding.ts`
  - Address to coordinates conversion
  - Reverse geocoding support
  - Confidence-based results (high/medium/low)
  - User-Agent: `Kosarica/1.0`

**Retail Chain Integrations (11 chains):**
- Configuration: `src/ingestion/chains/config.ts`
- Supported chains:
  - `konzum` - `src/ingestion/chains/konzum.ts`
  - `lidl` - `src/ingestion/chains/lidl.ts`
  - `plodine` - `src/ingestion/chains/plodine.ts`
  - `interspar` - `src/ingestion/chains/interspar.ts`
  - `studenac` - `src/ingestion/chains/studenac.ts`
  - `kaufland` - `src/ingestion/chains/kaufland.ts`
  - `eurospin` - `src/ingestion/chains/eurospin.ts`
  - `dm` - `src/ingestion/chains/dm.ts`
  - `ktc` - `src/ingestion/chains/ktc.ts`
  - `metro` - `src/ingestion/chains/metro.ts`
  - `trgocentar` - `src/ingestion/chains/trgocentar.ts`
- Chain-specific parsers for CSV, XML, XLSX, ZIP formats

**Payment Processing:**
- Not detected

**Email/SMS:**
- Not detected

**External APIs:**
- None detected beyond retail chain data portals

## Data Storage

**Databases:**
- Cloudflare D1 (SQLite) - Primary data store
  - Connection: via `env.DB` binding in Cloudflare Workers
  - Client: Drizzle ORM (`src/db/index.ts`)
  - Schema: `src/db/schema.ts` (20+ tables)
  - Migrations: `drizzle/` directory

**File Storage:**
- Cloudflare R2 - Ingestion file storage
  - Client: `src/ingestion/core/storage.ts` (R2Storage class)
  - Bucket: `INGESTION_BUCKET` binding
  - Storage keys: `{chainSlug}/runs/{runId}/{fileId}`

**Caching:**
- Not detected (direct database queries)

## Authentication & Identity

**Auth Provider:**
- Better Auth - Email/password + passkeys
  - Implementation: `src/lib/auth.ts`, `src/lib/auth-server.ts`, `src/lib/auth-client.ts`
  - Token storage: Server-side sessions via Better Auth
  - Session management: Automatic refresh handling

**Passkey/WebAuthn:**
- @better-auth/passkey plugin
  - Config: `PASSKEY_RP_ID`, `PASSKEY_RP_NAME` env vars
  - UI: `src/components/auth/LoginForm.tsx`

**OAuth Integrations:**
- Not detected

## Monitoring & Observability

**Error Tracking:**
- Not detected (no Sentry, Datadog, etc.)

**Analytics:**
- Not detected

**Logs:**
- Custom logger: `src/utils/logger.ts`
  - Contextual logging with request IDs
  - Log levels via `LOG_LEVEL` env var
  - Log types via `LOG_TYPES` env var

## CI/CD & Deployment

**Hosting:**
- Cloudflare Workers - `wrangler.jsonc`
  - Environments: dev, test, prod
  - Config files: `wrangler.jsonc`, `wrangler.test.jsonc`, `wrangler.prod.jsonc`

**CI Pipeline:**
- Not detected in codebase (likely GitHub Actions externally)

**Scheduled Jobs:**
- Cron trigger: `0 6 * * *` (daily at 6 AM UTC)
  - Handler: `src/ingestion/worker.ts`
  - Purpose: Automated ingestion runs

## Environment Configuration

**Development:**
- Required env vars: See `.dev.vars.example`
  - `BETTER_AUTH_SECRET` - Auth secret (32+ chars)
  - `BETTER_AUTH_URL` - Auth service URL
  - `PASSKEY_RP_ID` - WebAuthn relying party ID
  - `PASSKEY_RP_NAME` - WebAuthn relying party name
  - `LOG_LEVEL` - Logging level
  - `INGESTION_CHAINS` - Comma-separated chain list
  - `MAX_RETRIES` - Queue retry limit
- Mock/stub: Uses Wrangler local dev with persist

**Staging:**
- Config: `wrangler.test.jsonc`
- Separate D1 database binding

**Production:**
- Config: `wrangler.prod.jsonc`
- Secrets management: Cloudflare dashboard

## Webhooks & Callbacks

**Incoming:**
- Not detected

**Outgoing:**
- Not detected

## Message Queues

**Cloudflare Queues:**
- `INGESTION_QUEUE` - Main ingestion processing
  - Consumer: `src/ingestion/worker.ts`
  - Message types: Discover, Fetch, Expand, Parse, Persist, Rerun, EnrichStore
- `INGESTION_DLQ` - Dead letter queue for failed messages
  - Retry logic with exponential backoff

---

*Integration audit: 2026-01-14*
*Update when adding/removing external services*
