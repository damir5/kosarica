# Code Review Checks

## Invariants to Preserve

### 1. Schema Sync (TypeScript ↔ Go)

**Rule:** Database schema must be identical in both services.

- `src/db/schema.ts` (Drizzle) is the source of truth
- `services/price-service/internal/database/sqlcgen/` must match
- Breaking sync causes runtime errors in Go service

### 2. JSONB Type Safety

**Rule:** JSONB column types must match across TypeScript and Go.

- `src/db/jsonb-schemas.ts` (Zod) is the source of truth
- `services/price-service/internal/jsonb/` must match
- Breaking sync causes JSON marshal/unmarshal failures

### 3. API Contract

**Rule:** TypeScript SDK must match Go API responses.

- Go handlers with swag annotations are the source of truth
- `src/lib/go-api/` must match `services/price-service/docs/swagger.json`
- Breaking sync causes type errors in frontend

---

## Verification

```bash
pnpm validate:schema   # Check JSONB types and migrations
mise run generate-all  # Regenerate everything
pnpm test              # Run tests
```

---

## When to Regenerate

| Changed | Run |
|---------|-----|
| `src/db/schema.ts` | `pnpm db:generate && pnpm db:migrate && mise run generate-all` |
| `src/db/jsonb-schemas.ts` | `mise run generate-all` |
| Go handler responses | `mise run generate-all` |


## more

- NEVER use RAW sql queries - use SQLC in go and drizzle in ts
