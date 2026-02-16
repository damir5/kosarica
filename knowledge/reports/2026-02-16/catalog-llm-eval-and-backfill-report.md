# Catalog LLM Eval + Staging Backfill Report (2026-02-16)

## Scope

- Evaluate LLM options for Croatian grocery catalog enhancement (OpenRouter free models, Z.ai models, and the previously-used local provider).
- Pick the best model for the **staging** catalog enhancement loop.
- Run a 10-hour staging backfill at an effective cap of **~10 requests/minute**.
- Leave enough info here to audit decisions later.

Staging URL: `https://kosarica.chickenkiller.com`

## Z.ai Model Inventory

Queried from staging using `GET https://api.z.ai/api/coding/paas/v4/models` with `ZAI_API_KEY`:

- `glm-4.5`
- `glm-4.5-air`
- `glm-4.6`
- `glm-4.7`
- `glm-5`

Note: there is **no** `glm-4.7-flash` in the Z.ai `/models` response.

## Key Findings (Quality + Reliability + Throughput)

### 1) OpenRouter `arcee-ai/trinity-large-preview:free` (Winner)

Staging compare run (`scripts/compare-llm-models.ts`) with `n=150`, `batch=10`:

- Calls: `15/15` OK
- Coverage: `100%` (no dropped items, IDs copied consistently)
- Median latency: ~`17.7s` per call (compare harness prompt; smaller than the full categorization prompt)
- Quality proxies (compare harness baseline):
  - `brandMatchPct`: `86.7%`
  - `amountUnitMatchPct`: `~51.5%`
  - `containerMatchPct`: `100%` (low sample, but consistent)

Operationally: this was the only OpenRouter free model tested that was both:

- strict-JSON reliable for multi-item batches, and
- high quality on brand + amount/unit extraction.

### 2) Z.ai `glm-5` (Good quality, too slow for the target)

Same staging compare (`n=150`, `batch=10`):

- Calls: `15/15` OK
- Coverage: `100%`
- Median latency: ~`57.5s` per call

Quality looked competitive, but latency makes it hard to complete 165k items inside 10 hours unless we run very high concurrency (and/or increase batch size) and accept higher operational risk.

### 3) Z.ai `glm-4.7` (Unreliable)

Same staging compare (`n=150`, `batch=10`):

- Calls: `4/15` OK
- Many failures: `Model response is empty`

### 4) OpenRouter `liquid/lfm-2.5-1.2b-instruct:free` (Fast, but confidence formatting issues)

Same staging compare (`n=150`, `batch=10`):

- Calls: `14/15` OK
- Coverage: `92%`
- Median latency: ~`3.6s` per call
- Downside: model often emitted `confidence` values as percentages, which normalized to low 0-1 values.

This can be fixed with prompting (force 0..1 confidence) or a parser adaptation, but Trinity Large was already reliable and higher-quality without extra work.

### 5) OpenRouter `openai/gpt-oss-*` free (Blocked by privacy settings)

Staging compare showed repeated:

- `HTTP 404 ... No endpoints found matching your data policy (Free model publication). Configure: https://openrouter.ai/settings/privacy`

Not usable unless OpenRouter privacy settings are adjusted on the account.

### 6) Local provider (Staging unreachable)

The staging environment cannot reach the previously configured local endpoint (observed as `fetch failed` in local-target comparisons). Treat local-only models as **local dev** only, not staging backfill candidates.

## Engineering Changes Made (Staging-Oriented)

### A) Categorization output robustness

- The categorization prompt now uses **short per-batch IDs** (`i1`, `i2`, ...) internally to avoid models failing to copy long DB IDs.
- Parsed results are mapped back onto real DB item IDs before persistence.

### B) Throughput changes (critical)

Problem:

- One LLM call took ~60s with the full categorization prompt, so a serialized “RPM limiter” produced ~1 request/minute even when `CATEGORIZATION_RPM_LIMIT=10`.

Fix:

- RPM limiter now gates **request start times** with a fixed minimum gap (paced), but does **not** serialize requests.
- Backfill now runs `CATEGORIZATION_BACKFILL_CONCURRENCY` batches in parallel.

This allows us to hit ~10 request/minute even if each request takes ~60s, by having multiple in-flight calls while still respecting the 10 RPM start-rate.

## Final Staging Configuration (What’s Running)

Environment (from `kamal.yml`):

- `CATEGORIZATION_RPM_LIMIT=10`
- `CATEGORIZATION_BATCH_SIZE=30`
- `CATEGORIZATION_BACKFILL_CONCURRENCY=20`

Secrets (from `.kamal/secrets`):

- `CATEGORIZATION_ENSEMBLE_JSON=[{"id":"cat-primary","provider":"openrouter","model":"arcee-ai/trinity-large-preview:free","apiKeyEnv":"OPENROUTER_API_KEY","timeoutMs":180000,"maxRetries":1,"maxTokens":8000}]`

## Backfill Task (Staging)

Scheduled on 2026-02-16:

- Task ID: `7ebe4fee-c1a8-448b-a8cd-d21a92efee23`
- Params:
  - `batchSize=30`
  - `maxBatches=20000`
  - `maxRuntimeMinutes=600` (10 hours)
- Pending before scheduling: `165169` uncategorized items

After deploying concurrency, the task was set back to `pending` and immediately resumed on the new worker.

## Observed Staging Throughput (Post-Fix)

From container logs shortly after deploying parallel backfill:

- Completion throughput is typically in the `~250-450 items/min` range depending on concurrent in-flight completions (completion timestamps are bursty; start-rate is the true RPM cap).

Projection for `165169` items:

	- At `300 items/min`, `165169 / 300 ~= 550.6 minutes ~= 9.2 hours`

This fits within the 10-hour runtime budget.

## Artifacts

- Broad staging compare (not reliable for large batches due to output truncation at low `max_tokens` in the harness):
  - `knowledge/reports/2026-02-15/llm-compare-staging-v3.json`
- Local bench sweeps (OpenRouter + Z.ai synthetic prompt):
  - `knowledge/reports/2026-02-15/llm-bench-local-sweep.jsonl`
  - `knowledge/reports/2026-02-15/llm-bench-zai-local.jsonl`
