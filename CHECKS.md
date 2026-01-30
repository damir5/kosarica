# Code Review Checks

## Quick Reference

**Regenerate everything after schema changes:**
```bash
mise run generate-all
```

**Validate schema consistency:**
```bash
pnpm validate:schema
```

---

## Schema Sync Checklist

When modifying database fields or JSONB types:

- [ ] Drizzle schema updated (`src/db/schema.ts`)
- [ ] Migration generated and applied (`pnpm db:generate && pnpm db:migrate`)
- [ ] Codegen run (`mise run generate-all`)
- [ ] Validation passes (`pnpm validate:schema`)

---

## Details

### Database Schema (TypeScript ↔ Go)

Source of truth: `src/db/schema.ts`

| Change | Regenerate |
|--------|------------|
| New/modified DB fields | `mise run sqlc-generate` |
| API response changes | `mise run swag && pnpm generate:go-api` |

### JSONB Types (TypeScript ↔ Go)

Source of truth: `src/db/jsonb-schemas.ts`

Types: `TaskQueuePayload`, `ValidationErrors`, `CronJobPayload`, `CronRunMetadata`, `ArchiveMetadata`

| Change | Regenerate |
|--------|------------|
| Zod schema changes | `pnpm generate:jsonb` |

### Generated Files

```
src/db/jsonb-schemas.ts          → shared/schemas/jsonb/*.json
shared/schemas/jsonb/*.json      → services/price-service/internal/jsonb/types.generated.go
services/price-service/sqlc.yaml → services/price-service/internal/database/sqlcgen/
```
