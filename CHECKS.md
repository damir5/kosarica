# Code Review Checks

## Invariants to Preserve

### 1. Schema Authority

**Rule:** `src/db/schema.ts` is the source of truth for Postgres.

- Drizzle migrations must reflect the schema file
- Breaking sync causes runtime errors and failed queries

### 2. JSONB Type Safety

**Rule:** JSONB schemas must match the Zod definitions.

- `src/db/jsonb-schemas.ts` (Zod) is the source of truth
- Generated JSON schemas in `shared/schemas/jsonb/` must match
- Breaking sync causes runtime validation failures

---

## Verification

```bash
pnpm validate:schema   # Check JSON schemas + migrations
mise run generate-all  # Regenerate JSON schemas
pnpm test              # Run tests
```

---

## When to Regenerate

| Changed | Run |
|---------|-----|
| `src/db/schema.ts` | `pnpm db:generate && pnpm db:migrate` |
| `src/db/jsonb-schemas.ts` | `mise run generate-all` |

## more

- Prefer Drizzle for Postgres queries; use `sql` only when necessary.
- NEVER use `any` or equivalent types especially on system boundaries.
