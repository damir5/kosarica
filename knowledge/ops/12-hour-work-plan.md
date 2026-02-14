# 12-Hour Operations Work Plan
## Staging Environment - kosarica.chickenkiller.com
## Created: 2026-02-12 20:20 UTC

---

## Current Status Summary

### Ingestion Progress
- **Completed**: 550+ ingestion tasks
- **Processing**: ~40 concurrent
- **Pending**: ~16 remaining
- **Data Volume**: 175M+ prices in ClickHouse

### Unified Matching
- **Status**: Code fix deployed, awaiting worker capacity
- **Fix Applied**: Changed `!= ALL(array)` to `NOT id = ANY(array)` to avoid PostgreSQL ROW expression limit
- **Files Modified**: `src/lib/semantic-clustering/blocking.ts`

### LLM Configuration
- **Endpoint**: `http://100.72.112.119:1234` (Tailscale)
- **Model**: `qwen/qwen3-4b`
- **Auth**: `LOCAL_LLM_API_KEY` configured

---

## Hour-by-Hour Work Plan

### Hours 0-2: Monitor Ingestion Completion

**Tasks:**
1. Monitor remaining ingestion tasks:
   ```bash
   ssh kosarica-staging "docker exec kosarica-postgres psql -U kosarica kosarica -c \"SELECT task_type, status, COUNT(*) FROM task_queue WHERE status IN ('pending', 'processing') GROUP BY task_type, status\""
   ```

2. Check for failed ingestions and retry if needed:
   ```bash
   ssh kosarica-staging "docker exec kosarica-postgres psql -U kosarica kosarica -c \"SELECT chain_slug, COUNT(*) FROM ingestion_runs WHERE status = 'failed' AND target_date >= '2026-01-30' GROUP BY chain_slug\""
   ```

3. Verify data quality:
   ```bash
   ssh kosarica-staging "docker exec kosarica-clickhouse clickhouse-client -q 'SELECT count(*) FROM default.prices'"
   ssh kosarica-staging "docker exec kosarica-postgres psql -U kosarica kosarica -c 'SELECT count(*) FROM retailer_items'"
   ```

### Hours 2-4: Test Unified Matching

**Tasks:**
1. Wait for ingestion queue to drain
2. Trigger unified matching test:
   ```bash
   API_KEY=$(cat ../shared/secrets/api-keys/staging-claude-agent)
   curl -s -X POST -H "Content-Type: application/json" \
     -H "x-api-key: $API_KEY" \
     -d '{"json":{"limit":20,"dryRun":true,"primaryModelId":"qwen3-4b","secondaryModelId":"qwen3-4b","blocking":{"barcodeLimit":50,"barcodeMinChains":2}}}' \
     "https://kosarica.chickenkiller.com/api/rpc/admin/matching/triggerUnifiedMatching"
   ```

3. Monitor matching progress:
   ```bash
   ssh kosarica-staging "docker logs kosarica-web-new --tail 100 | grep -iE 'matching|blocking|candidate|processed'"
   ```

4. Verify no errors:
   ```bash
   ssh kosarica-staging "docker logs kosarica-web-new --since 10m | grep -iE 'Task.*failed|Error'"
   ```

### Hours 4-6: Scale Up Matching

**If dry-run succeeds:**

1. Run larger batch with persistence:
   ```bash
   curl -s -X POST -H "Content-Type: application/json" \
     -H "x-api-key: $API_KEY" \
     -d '{"json":{"limit":50,"dryRun":false,"primaryModelId":"qwen3-4b","secondaryModelId":"qwen3-4b","blocking":{"barcodeLimit":100,"barcodeMinChains":2}}}' \
     "https://kosarica.chickenkiller.com/api/rpc/admin/matching/triggerUnifiedMatching"
   ```

2. Monitor SKU creation:
   ```bash
   ssh kosarica-staging "docker exec kosarica-postgres psql -U kosarica kosarica -c 'SELECT count(*) FROM canonical_skus'"
   ```

### Hours 6-8: Check Data Coverage

**Tasks:**
1. Verify ingestion coverage by date:
   ```bash
   ssh kosarica-staging "docker exec kosarica-postgres psql -U kosarica kosarica -c \"
   SELECT 
     chain_slug,
     MIN(target_date)::date as min_date,
     MAX(target_date)::date as max_date,
     COUNT(*) as runs
   FROM ingestion_runs 
   WHERE status = 'completed'
   GROUP BY chain_slug
   ORDER BY chain_slug;
   \""
   ```

2. Check storage health:
   ```bash
   ssh kosarica-staging "find /app/data/storage/archives -type f | wc -l"
   ssh kosarica-staging "find /app/data/storage/parquet -name '*.parquet' | wc -l"
   ```

3. Identify and fill gaps:
   ```bash
   # Re-trigger any missing dates
   API_KEY=$(cat ../shared/secrets/api-keys/staging-claude-agent)
   for date in 2026-02-13 2026-02-14; do
     for chain in konzum lidl plodine interspar studenac kaufland eurospin ktc metro trgocentar; do
       curl -s -X POST -H "Content-Type: application/json" \
         -H "x-api-key: $API_KEY" \
         -d "{\"json\":{\"chain\":\"$chain\",\"targetDate\":\"$date\"}}" \
         "https://kosarica.chickenkiller.com/api/rpc/admin/ingestion/triggerChain"
     done
   done
   ```

### Hours 8-10: Matching Batch Runs

**Tasks:**
1. Continue running matching in batches (50-100 groups each)
2. Monitor for LLM call failures
3. Check escalation rates:
   ```bash
   ssh kosarica-staging "docker logs kosarica-web-new --since 1h | grep -iE 'escalated|confidence'"
   ```

### Hours 10-12: Final Verification & Reporting

**Tasks:**
1. Generate summary report:
   ```bash
   # Data volumes
   echo "=== DATA VOLUMES ==="
   ssh kosarica-staging "docker exec kosarica-clickhouse clickhouse-client -q 'SELECT count(*) FROM default.prices'"
   ssh kosarica-staging "docker exec kosarica-postgres psql -U kosarica kosarica -t -c 'SELECT count(*) FROM retailer_items'"
   
   # Matching progress
   echo "=== MATCHING PROGRESS ==="
   ssh kosarica-staging "docker exec kosarica-postgres psql -U kosarica kosarica -c 'SELECT count(*) FROM canonical_skus'"
   ssh kosarica-staging "docker exec kosarica-postgres psql -U kosarica kosarica -c 'SELECT count(*) FROM retailer_item_skus'"
   
   # Task queue status
   echo "=== TASK QUEUE ==="
   ssh kosarica-staging "docker exec kosarica-postgres psql -U kosarica kosarica -c \"SELECT task_type, status, COUNT(*) FROM task_queue GROUP BY task_type, status ORDER BY task_type, status\""
   ```

2. Verify storage permissions remain correct:
   ```bash
   ssh kosarica-staging "ls -la /app/data/storage/ | head -10"
   ```

3. Check for any errors in logs:
   ```bash
   ssh kosarica-staging "docker logs kosarica-web-new --since 1h | grep -iE 'error|failed|exception' | head -20"
   ```

---

## Known Issues & Workarounds

### 1. PostgreSQL ROW Expression Limit
- **Issue**: `!= ALL(array)` fails when array has >1664 items
- **Fix**: Changed to `NOT id = ANY(array)` in blocking.ts
- **Status**: Deployed, needs verification

### 2. Storage Permissions
- **Issue**: Directories owned by wrong UID after rsync
- **Fix**: `chown -R 1001:1001 /app/data/storage`
- **Status**: Fixed, monitor for recurrence

### 3. LLM Model ID Mismatch
- **Issue**: Default model ID "qwen" doesn't match config "qwen3-4b"
- **Fix**: Always specify `primaryModelId: "qwen3-4b"` in API calls
- **Status**: Documented

---

## Quick Reference Commands

### Check System Status
```bash
# Container status
ssh kosarica-staging "docker ps --format 'table {{.Names}}\t{{.Status}}'"

# Ingestion stats (24h)
API_KEY=$(cat ../shared/secrets/api-keys/staging-claude-agent)
curl -s -X POST -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"json":{"timeRange":"24h"}}' \
  "https://kosarica.chickenkiller.com/api/rpc/admin/ingestion/getStats" | jq .

# Task queue
ssh kosarica-staging "docker exec kosarica-postgres psql -U kosarica kosarica -c \"SELECT task_type, status, COUNT(*) FROM task_queue GROUP BY task_type, status\""
```

### Trigger Operations
```bash
# Ingestion for specific chain/date
curl -s -X POST -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"json":{"chain":"konzum","targetDate":"2026-02-13"}}' \
  "https://kosarica.chickenkiller.com/api/rpc/admin/ingestion/triggerChain"

# Unified matching (with nested blocking options)
curl -s -X POST -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"json":{"limit":50,"dryRun":true,"primaryModelId":"qwen3-4b","blocking":{"barcodeLimit":100,"barcodeMinChains":2}}}' \
  "https://kosarica.chickenkiller.com/api/rpc/admin/matching/triggerUnifiedMatching"
```

### View Logs
```bash
# App logs (last 100 lines)
ssh kosarica-staging "docker logs kosarica-web-new --tail 100"

# Matching-specific logs
ssh kosarica-staging "docker logs kosarica-web-new --since 10m | grep -i matching"

# Error logs
ssh kosarica-staging "docker logs kosarica-web-new --since 1h | grep -iE 'error|failed'"
```

---

## Emergency Contacts

- **Staging Server**: `ssh kosarica-staging` or `ssh root@kosarica.chickenkiller.com`
- **API Key**: `../shared/secrets/api-keys/staging-claude-agent`
- **Admin UI**: https://kosarica.chickenkiller.com/admin

---

## Success Metrics (End of 12 Hours)

| Metric | Target |
|--------|--------|
| Ingestion queue | < 10 pending |
| ClickHouse prices | 175M+ |
| PostgreSQL items | 165K+ |
| Matching groups processed | 500+ |
| Canonical SKUs created | 100+ (if dry-run=false) |
| Errors in logs | 0 critical |

---

*Document created by operations run on 2026-02-12*
*Expected completion: 2026-02-13 08:20 UTC*
