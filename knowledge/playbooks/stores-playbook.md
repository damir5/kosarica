# Stores Playbook

This playbook covers long-running store enrichment/geocoding quality loops.

## Language Requirement

- All technical communication MUST be in English (analysis notes, implementation notes, operational reports, escalation reasoning, commit messages).
- User-facing data content MUST be in Croatian (`hr-HR`) (for example store-facing labels, canonical display names shown to users, human-visible data text).
- Keep raw store source fields unchanged unless there is an explicit normalization/mapping rule.
- Before finalizing larger text updates, agents may use spellcheck/grammar tools (for example `hunspell`, `aspell`, LanguageTool, or equivalent IDE tooling) and should log that validation step in `commands_run`.

## 1) Connection Setup

```bash
# Dev
export DATABASE_URL=postgresql://kosarica:kosarica@localhost:5432/kosarica
export CLICKHOUSE_URL=http://localhost:8123
```

Run baseline checks first:

```bash
pnpm knowledge:validate
pnpm validate:schema
pnpm validate:neverthrow
```

## 2) Deterministic Coverage Model

Use the same shard strategy as catalog loops, but shard on `stores.id`.

Shard filter:

```sql
mod(abs(hashtext(s.id)), 64) = :shard
```

Loop state lives in `knowledge/ops/loop-state.yaml`.

## 3) Store Work Query

```sql
SELECT s.id, s.chain_slug, s.name, s.address, s.city, s.postal_code,
       s.latitude, s.longitude, s.status
FROM stores s
WHERE (s.latitude IS NULL OR s.longitude IS NULL OR s.status IN ('pending', 'needs_review'))
  AND mod(abs(hashtext(s.id)), 64) = :shard
ORDER BY s.id
LIMIT :batch_size;
```

## 4) Store Loop Workflow

1. Pull batch using store shard query.
2. Attempt geocode/enrichment.
3. If high confidence:
   - persist store coordinates/status
   - persist reusable knowledge:
     - `knowledge/stores/geocode-cache.yaml`
     - `knowledge/stores/aliases.yaml`
4. If ambiguous/low confidence:
   - mark `needs_review`
   - request second-agent review
   - escalate to human when unresolved
5. Run KPI snapshot:
   - `pnpm knowledge:kpi`
6. Append report and changelog.

## 5) Escalation Protocol

Escalate when:

- multiple plausible geocode results
- address aliases conflict between chains
- location confidence remains low after second-agent review

Escalation packet must include:

- raw store name/address/city/postal
- candidate coordinates + confidence
- reason for uncertainty
- proposed manual action

## 6) Store Knowledge Files

- `knowledge/stores/geocode-cache.yaml`
- `knowledge/stores/aliases.yaml`
- `knowledge/stores/changelog.yaml`

## 7) Reporting (Mandatory)

After each loop:

- update `knowledge/stores/changelog.yaml`
- write report file: `knowledge/reports/YYYY-MM-DD/agent-<agent_id>-loop-<n>.yaml`

Minimum store fields in report:

- `agent_id`
- `loop_number`
- `shard`
- `stores_scanned`
- `store_updates`
- `stores_escalated_to_human`
- `files_changed`
- `commands_run`

## 8) Ops Checks

Run periodically:

```bash
pnpm knowledge:validate
pnpm knowledge:kpi
pnpm test
```
