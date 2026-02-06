# Knowledge Agent Playbook

This playbook is for long-running agent loops that improve product matching and store enrichment quality over time.

## 1) Connection Setup

```bash
# Dev
export DATABASE_URL=postgresql://kosarica:kosarica@localhost:5432/kosarica
export CLICKHOUSE_URL=http://localhost:8123

# Test
# export DATABASE_URL=postgresql://kosarica_test:kosarica_test@ade-postgres-test.orb.local:5432/kosarica_test
# export CLICKHOUSE_URL=http://ade-clickhouse-test.orb.local:8123
```

Validate knowledge and schema first:

```bash
pnpm knowledge:validate
pnpm validate:schema
pnpm validate:neverthrow
```

## 2) Loop Model (Deterministic Coverage)

Goal: across repeated loops, every item is revisited, not just recent items.

Use fixed shard count `S` (recommended `64`).

- Loop number `N` picks shard `N % S`.
- Work query must filter by shard so each loop covers a distinct partition.
- After `S` loops, one full sweep is complete.
- New data joins its shard automatically and will be seen in future sweeps.

Recommended shard filter in PostgreSQL:

```sql
mod(abs(hashtext(ri.id)), 64) = :shard
```

## 3) Product Knowledge Work Query

Use this query shape per loop:

```sql
SELECT ri.id, ri.chain_slug, ri.name, ri.brand, ri.category,
       ri.normalized_unit, ri.normalized_quantity,
       array_agg(DISTINCT rib.barcode) FILTER (WHERE rib.barcode IS NOT NULL) AS barcodes
FROM retailer_items ri
LEFT JOIN retailer_item_barcodes rib ON rib.retailer_item_id = ri.id
LEFT JOIN product_links pl ON pl.retailer_item_id = ri.id
WHERE ri.merged_into_id IS NULL
  AND pl.id IS NULL
  AND mod(abs(hashtext(ri.id)), 64) = :shard
GROUP BY ri.id
ORDER BY ri.id
LIMIT :batch_size;
```

## 4) Product Loop Workflow

1. Pull batch using shard query.
2. Group likely equivalents using barcodes + normalized names.
3. Update knowledge files:
   - `knowledge/brands/*.yaml`
   - `knowledge/products/**/*.yaml`
   - `knowledge/extraction/*.yaml`
   - `knowledge/equivalences/_verified.yaml` or `_candidates.yaml`
4. Validate and preview:
   - `pnpm knowledge:validate`
   - `pnpm knowledge:apply --dry-run`
5. Apply when safe:
   - `pnpm knowledge:apply`
6. Log run report (Section 8).
7. Run KPI snapshot and alerts:
   - `pnpm knowledge:kpi`

Never write direct SQL inserts into `product_links`.

## 5) Confidence + Escalation Protocol

### Confidence bands

- `high` (`>= 0.93`): agent may propose `_verified` mapping directly if barcode or strong attribute match is present.
- `medium` (`0.75 - 0.92`): add to `_candidates.yaml`, requires one additional agent review.
- `low` (`< 0.75`): do not verify; escalate.

### Escalation path

1. Agent A adds candidate with evidence.
2. Agent B independently validates same candidate.
3. If both agree -> promote to `_verified.yaml`.
4. If disagreement or low confidence -> human review queue:
   - Product: keep in `product_match_queue` / candidate files.
   - Add explicit note to run log: `escalated_to_human: true`.

Required evidence for escalation:

- Raw names from all chains
- Any barcode evidence
- Extracted attributes and mismatch summary
- Why auto-link is unsafe

## 6) Store Enrichment Loop (Same Pattern)

Store process must also be continuous and knowledge-backed.

### Work query

```sql
SELECT s.id, s.chain_slug, s.name, s.address, s.city, s.postal_code,
       s.latitude, s.longitude, s.status
FROM stores s
WHERE (s.latitude IS NULL OR s.longitude IS NULL OR s.status IN ('pending', 'needs_review'))
  AND mod(abs(hashtext(s.id)), 64) = :shard
ORDER BY s.id
LIMIT :batch_size;
```

### Store workflow

1. Attempt geocode/enrichment.
2. If high confidence: persist store lat/lon and mark task completed.
3. Save reusable store knowledge for next deployments in:
   - `knowledge/stores/geocode-cache.yaml`
   - `knowledge/stores/aliases.yaml`
4. If low confidence or ambiguity:
   - mark `needs_review`
   - request peer-agent check
   - escalate to human if unresolved.

## 7) Files for Store Knowledge

- `knowledge/stores/geocode-cache.yaml`: canonical address -> coordinates + confidence
- `knowledge/stores/aliases.yaml`: known address/name variants -> canonical store identity
- `knowledge/stores/changelog.yaml`: append-only store knowledge changes

## 8) Run Reporting (Mandatory)

After each loop, append a summary entry to:

- `knowledge/changelog.yaml` (products)
- `knowledge/stores/changelog.yaml` (stores, if store work happened)
- `knowledge/reports/YYYY-MM-DD/agent-<agent_id>-loop-<n>.yaml`

Minimum report fields:

- `agent_id`
- `loop_number`
- `shard`
- `batch_size`
- `items_scanned`
- `new_verified_equivalences`
- `new_candidates`
- `store_updates`
- `escalated_to_human_count`
- `files_changed`
- `commands_run`

## 9) Long-Running Ops Guidance

- Run multiple agents with different shard assignments.
- Keep `S` stable (do not change shard count mid-sweep).
- Track sweep progress with `(completed_shards / S)`.
- Schedule periodic full quality checks:
  - `pnpm knowledge:validate`
  - `pnpm knowledge:apply --dry-run`
  - `pnpm knowledge:kpi`
  - `pnpm test`

## 10) Handoff Checklist

Before handing off to another agent:

1. Commit or stash cleanly with run report files.
2. Record current sweep progress and next shard.
3. List unresolved escalations requiring human review.
4. Include exact commands and query snippets used.
