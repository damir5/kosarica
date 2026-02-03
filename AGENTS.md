# Agent Instructions

**Code Review**: See [CHECKS.md](./CHECKS.md) for required verification steps.

## Minimal dev & test setup

- Dev .env: create `./.env.development` (or edit) with at least:
  - `DATABASE_URL=postgresql://kosarica:kosarica@localhost:5432/kosarica`
  - `PORT=3002` (frontend dev)
  - `STORAGE_PATH=./data/storage`
  - `CLICKHOUSE_URL=http://localhost:8123`

- Test .env: create `./.env.test` with at least:
  - `DATABASE_URL=postgresql://kosarica_test:kosarica_test@localhost:5432/kosarica_test`
  - `STORAGE_PATH=./data/storage-test`
  - `CLICKHOUSE_URL=http://localhost:8123`

Very brief test commands

- Apply migrations: `pnpm db:migrate` (uses `drizzle.config.ts` and `.env.test` when present)
- Run full workflow (migrate, run JS tests): `mise run test-all`
- Run frontend tests only: `pnpm test` (reports written to `/tmp/frontend-test-report.txt` on failures)

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
