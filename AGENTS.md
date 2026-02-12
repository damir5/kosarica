# Agent Instructions

**Code Review**: See [CHECKS.md](./CHECKS.md) for required verification steps.

## Environments

| Environment | URL | Purpose |
|-------------|-----|---------|
| Local dev | `http://localhost:3002` | Local development |
| **Staging** | `https://kosarica.duckdns.org` | Remote staging server (deployed via Kamal) |

**`kosarica.duckdns.org` is the STAGING environment, not production.** Do not refer to it as "production" or "prod". Deployments there are for staging and validation.

## SECRETS — CRITICAL RULES

**`.env.development` is committed to git** (explicitly un-ignored in `.gitignore`).

**NEVER put real API keys, tokens, or secrets in `.env.development`.**

- This file is for **structure and non-sensitive defaults only** (localhost URLs, dev ports, empty placeholders).
- All secret values (API keys, auth secrets, tokens) MUST be empty strings or placeholder text like `change-in-production`.
- Real secrets go in `.env.local` or `.env.development.local` (which ARE gitignored via `*.local`).
- When adding a new env var that holds a secret, set it to empty string: `MY_SECRET_KEY=`
- NEVER paste real key values, even in comments. Comments are committed too.
- Before any commit touching `.env*` files, verify no real secrets are present.
- If you accidentally stage a secret, `git reset` the file and clean it before committing.

## Common Commands (mise tasks)

All tasks are defined in `mise.toml`. Run with `mise run <task>`.

| Task | Command | Description |
|------|---------|-------------|
| `dev` | `mise run dev` | Run app in dev mode (logs to `log/log.txt`) |
| `services-up` | `mise run services-up` | Start dev containers (Postgres + ClickHouse) |
| `services-down` | `mise run services-down` | Stop dev containers |
| `services-purge` | `mise run services-purge` | Remove dev containers and all volumes |
| `reset-data` | `mise run reset-data` | Reset dev data (storage + DB + admin) |
| `test-all` | `mise run test-all` | Run full test suite (auto-starts test services) |
| `deploy-staging` | `mise run deploy-staging` | Deploy to staging env via Kamal |

Other useful commands:

| Command | Description |
|---------|-------------|
| `pnpm build` | Build for production (type-check) |
| `pnpm test` | Run frontend tests only |
| `pnpm db:generate` | Generate Drizzle migration from schema |
| `pnpm db:migrate` | Apply Drizzle migrations |

## Deployment

Deploy to the staging server (`kosarica.duckdns.org`) using Kamal:

```bash
mise run deploy-staging
```

- Config: `kamal.yml` (project root)
- Secrets: `.kamal/secrets`
- Requires: `ruby@3.3` (installed via mise), SSH access to the server
- Docker image is built locally (amd64), pushed to a local registry, then pulled on the server

## Minimal dev & test setup

Start containers first:

```bash
# Dev services (persistent data)
mise run services-up

# Test services (ephemeral)
docker compose --profile test up -d
```

- Dev .env: create `./.env.development` (or edit) with at least:
  - `DATABASE_URL=postgresql://kosarica:kosarica@localhost:5432/kosarica`
  - `PORT=3002` (frontend dev)
  - `STORAGE_PATH=./data/storage`
  - `CLICKHOUSE_URL=http://localhost:8123`

- Test .env: create `./.env.test` with at least:
  - `DATABASE_URL=postgresql://kosarica_test:kosarica_test@localhost:5433/kosarica_test`
  - `STORAGE_PATH=./data/storage-test`
  - `CLICKHOUSE_URL=http://localhost:8124`

Very brief test commands

- Apply migrations: `pnpm db:migrate` (uses `drizzle.config.ts` and `.env.test` when present)
- Run full workflow (migrate, run JS tests): `mise run test-all`
- Run frontend tests only: `pnpm test` (reports written to `/tmp/frontend-test-report.txt` on failures)
- Dev server logs: `mise run dev` writes to `log/log.txt`

---

## Database Migrations

**IMPORTANT: All database migrations MUST be managed through the Node.js service using Drizzle ORM.**

### Migration Workflow

1. Modify schema in `src/db/schema.ts`
2. Generate migration: `pnpm db:generate`
3. Review generated SQL in `drizzle/`
4. Apply migration: `pnpm db:migrate`

### Common command sequence (schema changes)

- `mise exec node@24 -- pnpm db:generate`
- `mise exec node@24 -- pnpm db:migrate`

### Rules

- Seed data (like chains) should be included in migrations with `ON CONFLICT DO NOTHING`
- Schema source of truth: `src/db/schema.ts`
- Migrations output: `drizzle/`
- **NEVER manually create migration files** - always use `pnpm db:generate` then edit the generated SQL if needed. Manually created files break drizzle's journal tracking.

---

## ID Conventions

All text-based IDs use CUID2 format with prefixes:
- `run_xxx` - ingestion runs
- `arc_xxx` - archives
- `grp_xxx` - price groups
- `itm_xxx` - items
- `sid_xxx` - store identifiers

---

## ORPC Serialization

ORPC's default JSON serializer natively supports:
- BigInt, Date, Map, Set, RegExp, URL, Blob, File

Do NOT manually convert these types to strings. Return them directly from handlers.

```typescript
// Correct - ORPC handles BigInt automatically
return { prices };

// Wrong - unnecessary conversion
const transformed = prices.map(p => ({ ...p, id: String(p.id) }));
return { prices: transformed };
```

---

## TanStack Query Keys (oRPC)

Do NOT manually construct TanStack Query keys (for example `['admin', 'users']`).

Always use the oRPC TanStack Query utilities from `src/orpc/client.ts`:
- Full keys: `*.queryKey(...)` / `*.queryOptions(...)`
- Partial keys for broad invalidation: `*.key({ type: 'query' })`

Manual query keys are only allowed with explicit user approval and a documented reason.

---

## Distributed Cron System

The scheduler uses Postgres-coordinated cron execution with node-cron for tick scheduling.

### Architecture

- **Tick Loop**: node-cron ticks every 10 seconds (`*/10 * * * * *`)
- **Leadership**: PostgreSQL advisory lock (ID: `1952534`) ensures single-leader execution
- **Job Storage**: `cron_jobs` table stores job definitions
- **Run History**: `cron_runs` table tracks execution with idempotency keys
- **Idempotency**: Format `cron:{job_id}:{scheduled_time}` prevents duplicate runs

### Key Files

| File | Purpose |
|------|---------|
| `src/jobs/cron/types.ts` | Type definitions |
| `src/jobs/cron/utils.ts` | Cron parsing, idempotency key generation |
| `src/jobs/cron/registry.ts` | In-memory job registry, DB sync |
| `src/jobs/cron/executor.ts` | Job claiming (FOR UPDATE SKIP LOCKED), execution |
| `src/jobs/cron/tick.ts` | Tick loop, advisory lock management |
| `src/jobs/cron/jobs.ts` | Job registration |
| `src/jobs/cron/handlers/` | Job handler implementations |
| `src/jobs/scheduler.ts` | Entry point |

### Adding a New Job

1. Create handler in `src/jobs/cron/handlers/`:

```typescript
// src/jobs/cron/handlers/my-job.ts
import type { CronJobHandler, CronExecutionContext, TaskToEnqueue } from "../types";

export const myJobHandler: CronJobHandler = {
  async execute(context: CronExecutionContext): Promise<TaskToEnqueue[]> {
    // Your job logic here
    return [];
  },
};
```

2. Register in `src/jobs/cron/jobs.ts`:

```typescript
import { myJobHandler } from "./handlers/my-job";

export function registerAllCronJobs(): void {
  // ... existing jobs

  registerCronJob({
    id: "my-job",
    name: "My Scheduled Job",
    cronExpression: "0 */6 * * *", // Every 6 hours
    timezone: "UTC",
    taskType: "my-type",
    handler: myJobHandler,
  });
}
```

### Edge Cases

| Case | Behavior |
|------|----------|
| Service down for hours | Runs ONCE (latest missed schedule), not N catch-ups |
| Crash mid-run | Runs stuck >30min auto-marked failed, job re-enabled |
| DST transitions | Uses `timestamptz`, stores `scheduled_for` as executed |
| Manual + scheduled overlap | Different idempotency keys, can run concurrently |

### Logger Type

Add `"scheduler"` to `LOG_TYPES` environment variable to enable scheduler logs:

```bash
LOG_TYPES=scheduler,daily-ingestion
```

---

## Logging (Pino)

This project uses **pino** for structured JSON logging with pino-pretty for development output.

### Logger API

```typescript
import { createLogger, logger } from "@/utils/logger";

// Use singleton (type: "app")
logger.info("Message", { key: "value" });

// Create typed logger
const log = createLogger("matching");
log.info("Starting operation", { operation: "barcode-match" });
log.error("Operation failed", { error }); // Error instances are serialized automatically
```

### Log Levels

- `debug` - Detailed debugging information
- `info` - General informational messages
- `warn` - Warning messages
- `error` - Error messages

### Logger Types

Available types for filtering: `rpc`, `http`, `auth`, `db`, `app`, `ingestion`, `scheduler`, `daily-ingestion`, `temp-cleanup`, `matching`

### Environment Variables

- `LOG_LEVEL` - Minimum level to output (default: `info`)
- `LOG_TYPES` - Comma-separated list of types to log, or `*` for all

Examples:
```bash
LOG_LEVEL=error              # Only errors
LOG_TYPES=rpc,http           # Only RPC and HTTP logs
LOG_TYPES=*,-db             # All except database logs
```

### Features

- **Request ID tracking** - Automatically included from AsyncLocalStorage
- **Sensitive data redaction** - Fields like `password`, `token`, `secret` are redacted
- **Caller location** - File:line:col shown in development mode
- **Child loggers** - Create contextual loggers with `.child({ context })`
- **BigInt serialization** - Automatically converted to strings
- **Error serialization** - Stack traces preserved via `serialize-error`

### Scripts Logging Pattern

For CLI scripts where console output is user-facing:
- Use `log.info()`/`log.error()` for internal operations
- Keep `console.log()` for final results displayed to user

---

## Observability (OpenObserve + OpenTelemetry)

The staging server runs OpenObserve for centralized logs, metrics, and traces. Data flows through an OpenTelemetry Collector sidecar.

### Architecture

```
App (Pino JSON → stdout) → Docker json-file driver → OTel Collector (filelog) → OpenObserve
App (OTel SDK)            → OTel Collector (OTLP gRPC :4317)                  → OpenObserve
Host metrics              → OTel Collector (hostmetrics)                       → OpenObserve
```

### Accessing OpenObserve

OpenObserve is **not** exposed publicly. Access it via SSH tunnel:

```bash
# Open tunnel (runs in background)
ssh -L 5080:kosarica-openobserve:5080 root@kosarica.duckdns.org -N &

# Then open in browser
open http://localhost:5080
```

**Credentials** (from `.kamal/secrets`):
- Email: `admin@kosarica.local`
- Password: value of `ZO_ROOT_USER_PASSWORD` in `.kamal/secrets`
- Org: `default`

### Data Streams

| Stream | Contains | Source |
|--------|----------|--------|
| `kosarica-logs` | App logs (Pino JSON), Docker container logs | filelog receiver |
| `kosarica-traces` | HTTP request traces, custom spans | OTel SDK (gRPC) |
| `kosarica-metrics` | App metrics, host CPU/memory/disk/network | OTel SDK + hostmetrics |

### Useful Queries (OpenObserve SQL)

```sql
-- Recent errors
SELECT * FROM "kosarica-logs" WHERE severity = 'error' ORDER BY _timestamp DESC LIMIT 50

-- Errors by logger type
SELECT body_type, count(*) as cnt FROM "kosarica-logs" WHERE severity = 'error' GROUP BY body_type ORDER BY cnt DESC

-- Specific RPC endpoint errors
SELECT * FROM "kosarica-logs" WHERE body LIKE '%listPhysical%' AND severity = 'error' ORDER BY _timestamp DESC

-- Slow requests (traces > 1s)
SELECT * FROM "kosarica-traces" WHERE duration > 1000000000 ORDER BY start_time DESC LIMIT 20
```

### Key Files

| File | Purpose |
|------|---------|
| `deployment/otel-collector-config.yaml` | OTel Collector config (receivers, processors, exporters) |
| `scripts/instrumentation.mjs` | OTel SDK bootstrap (loaded before app via `--import`) |
| `src/telemetry.ts` | OTel SDK configuration (checks `OTEL_EXPORTER_OTLP_ENDPOINT`) |
| `kamal.yml` (accessories) | OpenObserve + OTel Collector container definitions |
| `.kamal/secrets` | `ZO_*` credentials, `ZO_BASIC_AUTH` for collector auth |

### Debugging Tips

- **500 errors on staging server**: Check `kosarica-logs` stream, filter by `severity = 'error'`
- **Slow page loads**: Check `kosarica-traces` for long-duration spans
- **Container crashes**: Filter logs by `container_name` (e.g., `kosarica-web-*`, `kosarica-postgres`)
- **Ingestion failures**: Filter by `body_type = 'ingestion'` or `body_type = 'daily-ingestion'`
- **Telemetry disabled locally**: Set `OTEL_EXPORTER_OTLP_ENDPOINT=` (empty) in `.env.development`

---

## Error Handling (neverthrow)

The codebase uses `neverthrow` `Result`/`ResultAsync` types for type-safe error handling in adapters and infrastructure wrappers. Do NOT use try/catch in these layers — return typed errors instead.

### MUST (Enforced)

- In these boundary paths, `throw` is forbidden:
  - `src/ingestion/adapters/**`
  - `src/lib/safe-db.ts`
  - `src/lib/safe-fetch.ts`
  - `src/lib/safe-storage.ts`
  - `src/lib/store-enrichment.ts`
  - `src/lib/geocoding.ts`
- Use `Result` / `ResultAsync` and typed errors from `src/lib/errors.ts`.
- Run `pnpm validate:neverthrow` before handoff.

### Error types (`src/lib/errors.ts`)

Discriminated union with `_tag` field:
- `DbError` — database failures (includes PostgreSQL error `code`)
- `FetchError` — HTTP/network failures (includes `retryable`, `attempts`)
- `StorageError` — file storage failures

Constructors: `dbError()`, `fetchError()`, `storageError()`
Helpers: `isDeadlock()`, `isUniqueViolation()`, `toLogContext()`

### Wrappers

| Wrapper | File | Usage |
|---------|------|-------|
| `safeQuery()` | `src/lib/safe-db.ts` | Wraps any DB promise into `ResultAsync<T, DbError>` |
| `safeFetch()` | `src/lib/safe-fetch.ts` | Standalone fetch with retry returning `ResultAsync<Response, FetchError>` |
| `createSafeStorage()` | `src/lib/safe-storage.ts` | Wraps `Storage` interface into `SafeStorage` with `ResultAsync` methods |

### Adapter pattern

Chain adapters return `ResultAsync` from `discover()`, `fetch()`, and `parse()`. Chain results using `.andThen()` for async and `.map()` for sync transforms:

```typescript
// Chaining ResultAsync — fetch then transform
fetch(file: DiscoveredFile): ResultAsync<FetchedFile, FetchError> {
  return this.fetchWithRetry(file.url)
    .andThen((response) =>
      ResultAsync.fromPromise(response.arrayBuffer(), (e) =>
        fetchError({
          url: file.url,
          message: e instanceof Error ? e.message : "Failed to read response body",
          retryable: false, attempts: 1, cause: e,
        }),
      ),
    )
    .map((arrayBuffer) => ({
      discovered: file,
      content: Buffer.from(arrayBuffer),
      hash: computeSha256(Buffer.from(arrayBuffer)),
    }));
}

// Returning a classified error instead of throwing
return errAsync(ingestionClassified({
  status: "completed",
  statusType: "no_data_in_window",
  statusSeverity: "warning",
  statusReason: "No data available in publish window",
}));
```

### Pipeline boundary

`pipeline.ts` unwraps `Result` back to exceptions at the adapter call sites. This is the intentional bridge — pipeline internals still use try/catch:

```typescript
const discoverResult = await adapter.discover(dateStr);
if (discoverResult.isErr()) {
  const error = discoverResult.error;
  if (error._tag === "IngestionClassified") {
    throw new IngestionClassifiedError(error.classification);
  }
  throw new Error(error.message);
}
const discoveredFiles = discoverResult.value;
```

### Rules

- **Adapters/wrappers**: Always return `ResultAsync`, never throw
- **Pipeline boundary**: Unwrap with `.isErr()` / `.value` and convert to exceptions
- Use `.map()` for sync transforms, `.andThen()` for async transforms
- Do NOT add no-op `.orElse()` chains that just pass errors through
- `IngestionClassified` (value type) is for Result errors; `IngestionClassifiedError` (class) is for pipeline catch blocks — both coexist

---

## Agent Loop Operations (Knowledge + Stores)

Use `knowledge/playbooks/catalog-playbook.md` and `knowledge/playbooks/stores-playbook.md` as the operational source of truth for:

- DB connection and knowledge catalog access
- YAML-owned loop state (`knowledge/ops/loop-state.yaml`) instead of DB loop-state tables
- Deterministic loop coverage across all retailer items over repeated runs
- Run logging/reporting and changelog protocol
- Low-confidence escalation (peer-agent review then human queue)
- Store enrichment/geocoding loop and writing durable store knowledge for future deploys
- Language policy for loops: technical communication in English; user-facing catalog/store content in Croatian, with optional spellcheck/grammar tooling before handoff

You are an expert in TypeScript with a PhD in Computer Science. You have deep knowledge of both JavaScript and TypeScript, with a focus on performance, security, and accessibility. You strictly follow Airbnb's style guide when writing code.

Carefully review the task description and conversation history. In a <scratchpad>, think through your approach and prioritize the key tasks/steps you will take in your response. Note any issues, bugs or areas for improvement. Think through how best to explain the concepts or code changes to the user. Provide your final response in <response> tags.

When a user asks a general JavaScript or TypeScript question, provide a detailed explanation drawing upon your expertise. Break down complex topics step-by-step. Offer code examples following Airbnb's style guide to illustrate key points. Discuss performance, security, and accessibility considerations where relevant.

If a user asks for help with existing code, carefully analyze the provided code.

First, identify any errors or potential issues, and explain how to fix them. Then, suggest improvements to make the code more performant, secure, and accessible. Ensure all suggestions follow Airbnb's style guide. If the code is already optimal, acknowledge this and explain why.

If asked to review code, thoroughly evaluate the provided code.

Assess its overall quality, considering factors like performance, security, accessibility, and adherence to Airbnb's style guide. Provide a detailed critique, highlighting strengths and areas for improvement. Offer specific suggestions to refactor or optimize the code. If the code is of excellent quality, acknowledge this and explain why.

When providing examples, use backticks to demarcate the Rust code snippets.

Coding Guidelines:
- Follow the Airbnb style guide.
- Follow TypeScript best practices for writing idiomatic code.
- Follow DRY principles.
- Do not use deprecated modules and functions.
- Properly handle errors.
- Include structured logging where appropriate.
- Include all the code, do not skip details or methods for brevity.
- Don't apologize for errors, fix them.
- Include comments that describe purpose, not effect.
- Do not include TODO comments; write the code instead.
- When possible, bias toward writing code instead of using third-party packages.

Always begin your response by carefully restating the task to ensure you fully understand it.

Take time to think through your response before giving it. If the question requires a complex explanation or multiple code examples, break your response into clear, labeled sections.

Adjust the technical depth of your explanations to match the user's apparent level of expertise, based on the complexity of their question and code. However, always strive to provide valuable insights that expand the user's knowledge.

If you are unsure about any aspect of the question or do not have enough information to provide a complete answer, ask clarifying questions before attempting a response.

Remember, your goal is to provide the most helpful, accurate, and insightful guidance possible to support the user's learning and development in JavaScript and TypeScript.
