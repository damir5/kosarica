# Agent Instructions

## API Client Generation (Go → Node)

Go is the source of truth for shared API types (basket, prices, ingestion).
Types are exposed via OpenAPI spec and consumed via generated TypeScript SDK.

- Note: Run all Go tools via `mise run -- <command>` (e.g., `mise run -- gofmt -w <paths>`, `mise run -- go test ./...`) to ensure the pinned toolchain is used.

- Regenerate OpenAPI spec: `mise run swag` (from Go swag annotations)
- Regenerate TypeScript SDK: `mise run generate-go-api` (or `pnpm generate:go-api`)
- After changing Go handlers in `services/price-service/internal/handlers/`, run both commands
- Generated SDK lives in `src/lib/go-api/` with types, SDK functions, and Zod schemas

Annotated handlers:
- `internal/handlers/optimize.go` - basket optimization endpoints
- `internal/handlers/prices.go` - price query/search endpoints
- `internal/handlers/runs.go` - ingestion monitoring endpoints

---

## Minimal dev & test setup

- Dev .env: create `./.env.development` (or edit) with at least:
  - `DATABASE_URL=postgresql://kosarica:kosarica@localhost:5432/kosarica`
  - `PORT=3002` (frontend dev) and `GO_SERVICE_URL=http://localhost:3003`
  - `INTERNAL_API_KEY=dev-internal-api-key-change-in-development`

- Test .env: create `./.env.test` with at least:
  - `DATABASE_URL=postgresql://kosarica_test:kosarica_test@localhost:5432/kosarica_test`

Very brief test commands

- Apply migrations: `pnpm db:migrate` (uses `drizzle.config.ts` and `.env.test` when present)
- Start Go service for tests: `mise run test-service` (service runs via `go run`)
- Run full workflow (build, migrate, start service, run JS tests): `mise run test-all`
- Run frontend tests only: `pnpm test` (reports written to `/tmp/frontend-test-report.txt` on failures)


Go service env (services/price-service)

- `PORT` - port the service listens on (default `3003`)
- `HOST` - bind address (default `0.0.0.0`)
- `LOG_LEVEL` - logging verbosity (eg. `info`)
- `STORAGE_PATH` - path for archived files (eg. `./data/archives`)
- `INTERNAL_API_KEY` - internal auth key used by other services
- `DATABASE_URL` - Postgres connection string for the service (override in `.env.test` for tests)

These are set in `services/price-service/.env` and `services/price-service/.env.development`.

---

## Database Migrations

**IMPORTANT: All database migrations MUST be managed through the Node.js service using Drizzle ORM.**

The Go price-service reads the database schema but NEVER manages migrations. All schema changes flow through Drizzle.

### Migration Workflow

1. Modify schema in `src/db/schema.ts`
2. Generate migration: `pnpm db:generate`
3. Review generated SQL in `drizzle/`
4. Apply migration: `pnpm db:migrate`

### Common command sequence (schema + Go/API updates)

When a change touches DB schema, Go sqlc, Swagger, and the TS SDK, run these in order:

- `mise exec node@24 -- pnpm db:generate`
- `mise exec node@24 -- pnpm db:migrate`
- `mise run sqlc-generate`
- `mise run swag`
- `mise exec node@24 -- pnpm generate:go-api`
- `mise exec go@latest -- gofmt -w <paths>`

### Rules

- Never create migrations in Go services or other locations
- Seed data (like chains) should be included in migrations with `ON CONFLICT DO NOTHING`
- Schema source of truth: `src/db/schema.ts`
- Migrations output: `drizzle/`

---

## Go Service Type Safety (sqlc)

The Go price-service uses **sqlc** to generate type-safe database code from the PostgreSQL schema.

### sqlc Workflow

```
Drizzle schema → pnpm db:migrate → PostgreSQL → mise run sqlc-generate → Go types
```

1. After applying Drizzle migrations, run in the Go service:
   ```bash
   cd services/price-service
   mise run sqlc-generate
   ```

2. This dumps the schema from DB and generates Go types in `internal/database/sqlcgen/`

### Adding New Queries

1. Add SQL queries to files in `internal/database/queries/`
2. Run `mise run sqlc-generate`
3. Use generated code from `internal/database/sqlcgen/`

### ID Conventions

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
