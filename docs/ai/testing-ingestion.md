# AI Ingestion Testing Playbook

## Purpose
This runbook defines a repeatable, end-to-end workflow for AI bots to explore and test the ingestion pipeline with deterministic setup, execution, monitoring, and reporting.

## Required Inputs (from test request)
Provide these inputs before execution:

- `reset_mode`: `full_reset` or `keep_existing`
- `date_start`: `YYYY-MM-DD`
- `date_end`: `YYYY-MM-DD`
- `chains`: list of chain slugs or `all`
- `worker_count`: positive integer (`1` = app worker only, `2+` = start extra workers)
- `trigger_matching_crons`: `true` or `false` (default `true`)

Default values if not provided:

- `reset_mode=full_reset`
- `chains=all`
- `trigger_matching_crons=true`

Worker count rule:
- Bots MUST explicitly ask the user: `How many workers should I start for this run?`
- Do not assume a default unless the user already gave one.

Supported chains:

- `konzum`, `lidl`, `plodine`, `interspar`, `studenac`, `kaufland`, `eurospin`, `dm`, `ktc`, `metro`, `trgocentar`

## Fixed Admin Credentials (dev only)
- Email: `admin@dev.local`
- Password: `admin123456`

## Preconditions
1. Repo root is current working directory.
2. `.env.development` exists with valid `DATABASE_URL`, `STORAGE_PATH`, `CLICKHOUSE_URL`.
3. Docker is running.
4. Ports are free (`3002`, `5432`, `8123`).

## Mandatory Progress Reporting (for AI bots)
Bots must repeatedly publish detailed progress to the user during execution, not only at the end.

### Update cadence
- Send an update at least every 60 seconds while work is active.
- Send an update after every major milestone (reset done, login done, scheduling done, ingestion complete, each cron complete, metrics collected).
- Send an immediate update on every failure and every retry.

### Required fields in every progress update
- Current step name and status (`in_progress`, `completed`, `blocked`)
- Elapsed time since run start
- Date range and chains being processed
- Worker setup:
  - target worker count
  - active worker process count
- Current ingestion progress:
  - scheduled tasks count
  - task queue status breakdown (`pending`, `running`, `completed`, `failed`)
  - ingestion run status breakdown
- Current cron progress (if enabled):
  - each cron job status (`barcode-matching`, `trigram-matching`, `semantic-matching`)
- New errors since last update (top 3 with short reason)
- Next action

### Recommended progress update template
```text
Progress Update #<n> | <timestamp>
- Step: <name> (<status>)
- Elapsed: <minutes>m
- Scope: <date_start>.. <date_end>, chains=<list|all>
- Task Queue: pending=<n>, running=<n>, completed=<n>, failed=<n>
- Ingestion Runs: pending=<n>, running=<n>, completed=<n>, failed=<n>
- Cron: barcode=<status>, trigram=<status>, semantic=<status>
- New Errors: <none|short list>
- Next: <next action>
```

### Minimum update count
- Short run (<10 minutes): at least 5 progress updates.
- Medium run (10-30 minutes): at least 10 progress updates.
- Long run (>30 minutes): at least 1 update per minute plus milestone updates.

## Step 1: Start Services and App
```bash
docker compose --profile dev up -d
mise run dev
```

Keep `mise run dev` running during the whole test run.

## Step 1b: Configure Worker Count (Required)
Before scheduling ingestion, ask the user how many workers to run.

- `worker_count=1`: no extra action, use the worker started by the app.
- `worker_count>1`: start `worker_count - 1` extra workers in background.

Example command for one extra worker:
```bash
WORKER_ID=manual-worker-2 mise exec node@24 -- pnpm exec tsx scripts/run-worker.ts > log/worker-2.log 2>&1 &
echo $! >> /tmp/kosarica-worker-pids.txt
```

Example command for multiple workers:
```bash
mkdir -p log
: > /tmp/kosarica-worker-pids.txt
for i in $(seq 2 "${worker_count}"); do
  WORKER_ID="manual-worker-${i}" mise exec node@24 -- pnpm exec tsx scripts/run-worker.ts > "log/worker-${i}.log" 2>&1 &
  echo $! >> /tmp/kosarica-worker-pids.txt
done
```

After startup, verify worker fanout:
```bash
psql "$DATABASE_URL" -c "
SELECT status, count(*)
FROM task_queue
WHERE task_type = 'ingestion'
GROUP BY status
ORDER BY status;
"
```

## Step 2: Prepare State (Reset or Keep)
### Option A: Full reset (recommended)
```bash
mise run reset-data
```

Non-interactive equivalent:
```bash
./scripts/reset-dev-data.sh --yes
```

What this does:
- resets Postgres schema
- resets ClickHouse tables
- clears storage dirs
- runs migrations
- creates/repairs dev admin user

### Option B: Keep existing data
Skip reset.

Optional partial reset script (advanced):
```bash
DATABASE_URL=... ./scripts/reset-data.sh --keep-db
DATABASE_URL=... ./scripts/reset-data.sh --keep-storage
```

## Step 3: Ensure Admin User Exists
Run this even if reset was skipped:

```bash
npx tsx scripts/ensure-admin.ts
```

## Step 4: Login as Admin (UI-Driven)
1. Open `http://localhost:3002/admin/ingestion`.
2. If redirected to login, submit:
   - `input#email` = `admin@dev.local`
   - `input#password` = `admin123456`
   - click `button[type="submit"]`
3. Confirm URL is `/admin/ingestion`.

## Step 5: Schedule Ingestion
Use `/admin/ingestion` page.

1. Enable date range switch.
2. Fill:
   - `input#range-start` = `date_start`
   - `input#range-end` = `date_end`
3. Trigger selected chains.

If `chains=all`, trigger all 11 chains in this order:
1. Konzum
2. Lidl
3. Plodine
4. Interspar
5. Studenac
6. Kaufland
7. Eurospin
8. DM
9. KTC
10. Metro
11. Trgocentar

Expected behavior:
- UI shows scheduling success toast(s)
- tasks appear in task queue as `task_type='ingestion'`

## Step 6: Monitor Ingestion Completion
Use both UI and SQL checks.

UI pages:
- `/admin/ingestion`
- `/admin/task-queue`

SQL checks (`DATABASE_URL` must point to dev DB):

```bash
psql "$DATABASE_URL" -c "
SELECT status, count(*)
FROM task_queue
WHERE task_type = 'ingestion'
GROUP BY status
ORDER BY status;
"
```

```bash
psql "$DATABASE_URL" -c "
SELECT chain_slug, status, count(*)
FROM ingestion_runs
WHERE target_date::date BETWEEN DATE '${date_start}' AND DATE '${date_end}'
GROUP BY chain_slug, status
ORDER BY chain_slug, status;
"
```

Proceed when ingestion has no `pending`/`running` tasks.

After ingestion completes, stop extra workers (if any):
```bash
if [ -f /tmp/kosarica-worker-pids.txt ]; then
  xargs -r kill < /tmp/kosarica-worker-pids.txt
fi
```

## Step 7: Manually Trigger Post-Ingestion Cron Jobs
If `trigger_matching_crons=true`, open `/admin/cron` and trigger jobs in order:

1. `barcode-matching`
2. `trigram-matching`
3. `semantic-matching`

Optional housekeeping:
4. `temp-cleanup`

After each trigger, verify run status becomes `completed` in Cron Runs table.

SQL verification:

```bash
psql "$DATABASE_URL" -c "
SELECT job_id, status, tasks_enqueued, started_at, completed_at
FROM cron_runs
ORDER BY created_at DESC
LIMIT 20;
"
```

## Step 8: Collect Technical and Business Stats
Run these queries and include results in final report.

### A) Technical Metrics

1) Ingestion success/failure by chain
```sql
SELECT
  chain_slug,
  count(*) AS runs_total,
  count(*) FILTER (WHERE status = 'completed') AS runs_completed,
  count(*) FILTER (WHERE status = 'failed') AS runs_failed,
  round(100.0 * count(*) FILTER (WHERE status = 'completed') / NULLIF(count(*), 0), 1) AS success_pct
FROM ingestion_runs
WHERE target_date::date BETWEEN DATE '${date_start}' AND DATE '${date_end}'
GROUP BY chain_slug
ORDER BY chain_slug;
```

2) Pipeline throughput and data quality
```sql
SELECT
  sum(row_count) AS rows_seen,
  sum(persisted_count) AS rows_persisted,
  sum(price_changes) AS price_changes,
  sum(failed_rows) AS failed_rows,
  sum(warning_rows) AS warning_rows
FROM ingestion_store_stats s
JOIN ingestion_runs r ON r.id = s.run_id
WHERE r.target_date::date BETWEEN DATE '${date_start}' AND DATE '${date_end}';
```

3) Error distribution
```sql
SELECT error_type, severity, count(*) AS count
FROM ingestion_errors e
JOIN ingestion_runs r ON r.id = e.run_id
WHERE r.target_date::date BETWEEN DATE '${date_start}' AND DATE '${date_end}'
GROUP BY error_type, severity
ORDER BY count DESC;
```

4) Cron health summary
```sql
SELECT
  job_id,
  count(*) AS runs,
  count(*) FILTER (WHERE status = 'completed') AS completed,
  count(*) FILTER (WHERE status = 'failed') AS failed
FROM cron_runs
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY job_id
ORDER BY job_id;
```

### B) Business Metrics

1) Chain coverage
```sql
SELECT
  (SELECT count(*) FROM chains) AS total_chains,
  count(DISTINCT chain_slug) FILTER (WHERE status = 'completed') AS chains_completed,
  round(
    100.0 * count(DISTINCT chain_slug) FILTER (WHERE status = 'completed')
    / NULLIF((SELECT count(*) FROM chains), 0),
    1
  ) AS chain_coverage_pct
FROM ingestion_runs
WHERE target_date::date BETWEEN DATE '${date_start}' AND DATE '${date_end}';
```

2) Catalog size and matching coverage
```sql
SELECT
  (SELECT count(*) FROM retailer_items WHERE merged_into_id IS NULL) AS active_retailer_items,
  (SELECT count(*) FROM products) AS canonical_products,
  (SELECT count(*) FROM product_links) AS product_links,
  round(
    100.0 * (SELECT count(*) FROM product_links)
    / NULLIF((SELECT count(*) FROM retailer_items WHERE merged_into_id IS NULL), 0),
    1
  ) AS matching_coverage_pct;
```

3) Cross-chain comparable products (linked to 2+ chains)
```sql
SELECT count(*) AS comparable_products
FROM (
  SELECT pl.product_id
  FROM product_links pl
  JOIN retailer_items ri ON ri.id = pl.retailer_item_id
  GROUP BY pl.product_id
  HAVING count(DISTINCT ri.chain_slug) >= 2
) t;
```

4) Store coverage by chain
```sql
SELECT c.slug, c.name, count(s.id) AS stores
FROM chains c
LEFT JOIN stores s ON s.chain_slug = c.slug
GROUP BY c.slug, c.name
ORDER BY stores DESC;
```

## Final Report Template
Every AI run must output:

1. **Run metadata**
- start/end timestamp
- input parameters (`reset_mode`, date range, chains)

2. **Execution summary**
- reset performed or skipped
- ingestion tasks scheduled
- ingestion runs completed/failed
- cron jobs triggered and status

3. **Technical metrics**
- include outputs for all technical queries

4. **Business metrics**
- include outputs for all business queries

5. **Anomalies and failures**
- top errors
- chains with no/low coverage
- stuck or retried jobs

6. **Artifacts**
- screenshots from `/admin/ingestion` and `/admin/cron`
- any generated logs or SQL output files

## Troubleshooting

### 1) Reset fails immediately
Symptoms:
- `DATABASE_URL is required` or Postgres/ClickHouse readiness timeout

Actions:
- verify `.env.development`
- start containers manually: `docker compose --profile dev up -d postgres clickhouse`
- rerun `./scripts/reset-dev-data.sh --yes`

### 2) Login fails
Symptoms:
- invalid credentials or redirect loop

Actions:
- run `npx tsx scripts/ensure-admin.ts`
- clear browser cookies
- retry login at `/admin/ingestion`

### 3) Ingestion stuck in pending
Symptoms:
- `task_queue` has many `pending` ingestion tasks, no progress

Actions:
- verify app server is running (`mise run dev`)
- check worker startup logs in dev output (`Task queue worker started`)
- restart dev server

### 4) Repeated duplicate/skipped runs
Symptoms:
- chain/day tasks complete quickly with duplicate/no-op status

Actions:
- confirm requested date range and chain list are correct
- use a new date window or clean reset
- for forced rerun, schedule from API/UI path that supports `force=true`

### 5) Cron job fails
Symptoms:
- `/admin/cron` run status `failed`

Actions:
- inspect `cron_runs.error_message` / `error_details`
- rerun in order: `barcode-matching` -> `trigram-matching` -> `semantic-matching`
- if semantic fails repeatedly, report and continue with barcode/trigram metrics

### 6) High ingestion errors for one chain
Symptoms:
- one chain dominates `ingestion_errors`

Actions:
- check run/file status reason in `/admin/ingestion`
- inspect recent chain-specific run errors:
```sql
SELECT r.chain_slug, e.error_type, e.severity, e.error_message, e.created_at
FROM ingestion_errors e
JOIN ingestion_runs r ON r.id = e.run_id
WHERE r.chain_slug = '<chain>'
ORDER BY e.created_at DESC
LIMIT 50;
```
- classify as source-format drift vs parser bug

### 7) ClickHouse appears empty but ingestion succeeded
Symptoms:
- Postgres has ingestion runs, analytics from ClickHouse missing

Actions:
- run `pnpm clickhouse:load-missing` (or `pnpm clickhouse:load-all`)
- rerun ClickHouse-dependent metrics

## Determinism Rules for Bots
- Use explicit ISO dates in logs and reports.
- Never run concurrent ingestion test campaigns in the same environment.
- Always capture pre-run and post-run task counts.
- Always include SQL outputs used for conclusions.
- If a step fails, report failure with exact command, error, and retry outcome.
