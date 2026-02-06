# Catalog Playbook

This playbook covers long-running agent loops for product knowledge quality.

## 1) Connection Setup

```bash
# Dev
export DATABASE_URL=postgresql://kosarica:kosarica@localhost:5432/kosarica
export CLICKHOUSE_URL=http://localhost:8123

# Test
# export DATABASE_URL=postgresql://kosarica_test:kosarica_test@ade-postgres-test.orb.local:5432/kosarica_test
# export CLICKHOUSE_URL=http://ade-clickhouse-test.orb.local:8123
```

Run baseline checks first:

```bash
pnpm knowledge:validate
pnpm validate:schema
pnpm validate:neverthrow
```

## 2) Deterministic Coverage Model

Use fixed shard count `S` (recommended `64`).

- Loop number `N` picks shard `N % S`.
- Each loop processes only one shard.
- After `S` loops, one full sweep is complete.

Shard filter:

```sql
mod(abs(hashtext(ri.id)), 64) = :shard
```

Loop state is YAML-owned in `knowledge/ops/loop-state.yaml`.

## 3) Product Work Query

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
6. Run KPI snapshot:
   - `pnpm knowledge:kpi`
7. Append run report and changelog entries.

Never insert `product_links` directly with SQL.

## 5) Confidence + Escalation

### Confidence bands

- `high` (`>= 0.93`): candidate can move to `_verified` if strong evidence exists.
- `medium` (`0.75 - 0.92`): keep in `_candidates.yaml` and require second-agent review.
- `low` (`< 0.75`): escalate.

### Escalation protocol

1. Agent A records candidate + evidence.
2. Agent B independently validates.
3. If both agree, promote to `_verified.yaml`.
4. If disagreement or low confidence, escalate to human.

Required evidence:

- Raw names by chain
- Barcode evidence if present
- Extracted attribute comparison
- Why auto-link is unsafe

## 6) Reporting (Mandatory)

After each loop:

- Update `knowledge/changelog.yaml`
- Write report file: `knowledge/reports/YYYY-MM-DD/agent-<agent_id>-loop-<n>.yaml`

Report fields:

- `agent_id`
- `loop_number`
- `shard`
- `batch_size`
- `items_scanned`
- `new_verified_equivalences`
- `new_candidates`
- `escalated_to_human_count`
- `files_changed`
- `commands_run`

## 7) Ops Checks

Run periodically:

```bash
pnpm knowledge:validate
pnpm knowledge:apply --dry-run
pnpm knowledge:kpi
pnpm test
```
