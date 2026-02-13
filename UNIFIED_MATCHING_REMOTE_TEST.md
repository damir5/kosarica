# Unified Matching Pipeline Test - Remote Execution

## Task Summary

Test the unified product matching pipeline on staging server (kosarica.chickenkiller.com) with:
- Database: PostgreSQL on remote server
- LLM: qwen3-4b model running on 0.0.0.0:1234
- Small sample run (10 groups, dry run)

## Current State

### Completed
✅ Local Docker containers stopped (postgres, clickhouse)
✅ Blocking phase verified working correctly:
- Tier 1 (Barcode): 5 groups
- Tier 2 (Deterministic): 5 groups
- Tier 3 (Embedding): 3-5 groups
- Tier 4 (Lexical): 5 groups
- Total: 18-20 candidate groups, 261-279 unique items
✅ SQL fixes applied to `blocking.ts` for array parameterization
✅ Test script created: `scripts/run-unified-matching-test.ts`

### Fixed Code Changes
File: `src/lib/semantic-clustering/blocking.ts`

Changed SQL array exclusion patterns from:
```sql
AND ri.id NOT IN (SELECT UNNEST(${excludeArray}::text[]))
```

To:
```sql
const excludeArrayStr = `ARRAY[${excludeArray.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")}]`;
...
AND ri.id != ALL (${sql.raw(excludeArrayStr)})
```

Applied to:
- `loadEmbeddingGroups()` function (2 locations)
- `loadLexicalGroups()` function (2 locations)

## Prerequisites

### Remote Server Access
- SSH access to `root@kosarica.chickenkiller.com`
- LLM model running at `http://0.0.0.0:1234/v1/chat/completions`
- PostgreSQL running in Docker on remote server
- Application code accessible on remote server

### Environment Variables Required
```bash
DATABASE_URL=postgresql://postgres-user:password@host:5432/database_name
LOCAL_LLM_API_KEY=dummy
LLM_ENSEMBLE_JSON='[
  {
    "id": "qwen3-4b",
    "provider": "openai",
    "model": "qwen/qwen3-4b-2507",
    "endpoint": "http://0.0.0.0:1234/v1/chat/completions",
    "apiKeyEnv": "LOCAL_LLM_API_KEY",
    "weight": 1.0,
    "timeoutMs": 60000,
    "maxRetries": 1
  },
  {
    "id": "qwen3-8b",
    "provider": "openai",
    "model": "qwen/qwen3-8b",
    "endpoint": "http://0.0.0.0:1234/v1/chat/completions",
    "apiKeyEnv": "LOCAL_LLM_API_KEY",
    "responseFormat": "none",
    "weight": 1.0,
    "timeoutMs": 90000,
    "maxRetries": 1
  }
]'
```

## Steps to Execute

### Step 1: Connect to Remote Server
```bash
ssh root@kosarica.chickenkiller.com
# Or with key:
ssh -i /path/to/private-key root@kosarica.chickenkiller.com
```

### Step 2: Navigate to Application Directory
```bash
cd /app  # or appropriate directory on server
```

### Step 3: Check Running Services
```bash
# Verify containers are running
docker compose ps

# Verify LLM endpoint is accessible
curl -s -o /dev/null -w "%{http_code}" http://0.0.0.0:1234/v1/models
```

### Step 4: Check Database Connection
```bash
# Verify PostgreSQL is accessible
docker exec -it $(docker compose ps -q postgres) psql -U postgres_user -d database_name -c "SELECT 1"
```

### Step 5: Run Unified Matching Test
```bash
# Set environment variables
export DATABASE_URL="postgresql://<user>:<password>@<host>:5432/<database>"
export LOCAL_LLM_API_KEY="dummy"
export LLM_ENSEMBLE_JSON='[{"id":"qwen3-4b","provider":"openai","model":"qwen/qwen3-4b-2507","endpoint":"http://0.0.0.0:1234/v1/chat/completions","apiKeyEnv":"LOCAL_LLM_API_KEY","weight":1.0,"timeoutMs":60000,"maxRetries":1},{"id":"qwen3-8b","provider":"openai","model":"qwen/qwen3-8b","endpoint":"http://0.0.0.0:1234/v1/chat/completions","apiKeyEnv":"LOCAL_LLM_API_KEY","responseFormat":"none","weight":1.0,"timeoutMs":90000,"maxRetries":1}]'

# Run the test
pnpm tsx scripts/run-unified-matching-test.ts
```

### Step 6: Review Results

Expected output sections:
1. **Blocking Statistics**
   - Barcode groups: ~5
   - Deterministic groups: ~5
   - Embedding groups: ~3-5
   - Lexical groups: ~5
   - Total unique items: ~261-279

2. **Processing Results**
   - Candidate groups generated: ~18-20
   - Groups processed: 10 (limit)
   - Groups escalated to secondary: 0-3 (if confidence < 0.8)
   - Canonical SKUs created: 0 (dry run)
   - Items linked to SKUs: 0 (dry run)
   - Groups with errors: 0-10 (depends on LLM availability)

3. **Log Observations**
   - Look for "Unified matching: processing group" messages
   - Check for LLM decision logs
   - Verify no SQL errors in logs

## Test Parameters (from `scripts/run-unified-matching-test.ts`)

```typescript
{
  limit: 10,                    // Max groups to process
  dryRun: true,                 // Skip persistence
  minPrimaryConfidence: 0.8,      // Escalation threshold
  primaryModelId: "qwen3-4b",   // Primary LLM model
  secondaryModelId: "qwen3-8b",  // Secondary LLM model
  blocking: {
    barcodeLimit: 5,
    barcodeMinChains: 2,
    deterministicLimit: 5,
    embeddingLimit: 5,
    lexicalLimit: 5
  }
}
```

## Troubleshooting

### LLM Connection Issues
If groups fail with "group processing failed" errors:
```bash
# Test LLM endpoint directly
curl http://0.0.0.0:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen/qwen3-4b-2507","messages":[{"role":"user","content":"test"}],"max_tokens":10}'

# Check LLM logs
docker logs <llm-container-name> --tail 50
```

### Database Connection Issues
```bash
# Check postgres container
docker logs <postgres-container-name> --tail 50

# Verify database exists
docker exec -it <postgres-container> psql -U postgres_user -l
```

### Missing Dependencies
```bash
# Ensure Node dependencies are installed
pnpm install

# Ensure TypeScript is available
pnpm tsx --version
```

## Files Modified

### Core Implementation
- `src/lib/semantic-clustering/blocking.ts` - SQL array parameterization fixes
- `scripts/run-unified-matching-test.ts` - Test script (new)

### Related Files (read-only reference)
- `src/lib/semantic-clustering/unified-pipeline.ts` - Main orchestration
- `src/lib/semantic-clustering/listwise/llm-call.ts` - LLM integration
- `src/orpc/router/matching.ts` - API endpoints

## Success Criteria

✅ Blocking phase completes without errors
✅ 10 groups are processed
✅ LLM calls succeed (groups not failing with "processing failed")
✅ Cascade decisions are logged (escalate or accept)
✅ Duration < 60 seconds for sample run
✅ Dry run skips persistence (0 SKUs created)

## Next Steps (After Successful Test)

1. **Full Run**: Set `dryRun: false` and test persistence
2. **Scale Up**: Increase limit to 25-50 groups
3. **Monitor**: Check Admin UI at https://kosarica.chickenkiller.com/admin/matching
4. **Cron Activation**: Set `SEMANTIC_CLUSTERING_MODE=unified` on server

## Notes

- Local containers already stopped: `docker compose --profile dev down`
- Test should run on staging server where qwen3-4b is accessible
- LLM endpoint is at `http://100.72.112.119:1234` (Tailscale IP)
- Database credentials must match staging environment
- **IMPORTANT**: Must specify `primaryModelId: "qwen3-4b"` when triggering via API - the default fallback "qwen" doesn't match the LLM_ENSEMBLE_JSON config
- Storage permissions: Run `chown -R 1001:1001 /app/data/storage` if ingestion fails with EACCES errors

## Known Issues

### PostgreSQL ROW Expression Limit (1664 entries)

**Problem**: `loadEmbeddingGroups()` and `loadLexicalGroups()` fail when `excludeItemIds` has more than 1664 items:
```
PostgresError: ROW expressions can have at most 1664 entries
```

**Location**: `src/lib/semantic-clustering/blocking.ts` lines ~357 and ~457

**Current Workaround**: Use smaller batch sizes (`embeddingLimit: 1`, `lexicalLimit: 1`)

**Fix Required**: Batch exclusions into chunks or use temporary table approach:
```sql
-- Instead of: ri.id != ALL (${excludeArray}::text[])
-- Use: CREATE TEMP TABLE excluded_ids AS SELECT unnest(${excludeArray}::text[]) AS id
-- Then: ri.id NOT IN (SELECT id FROM excluded_ids)
```
