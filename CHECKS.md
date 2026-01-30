# Code Review Checks

## Database Schema Sync (TypeScript ↔ Go)

When adding or modifying database fields, the schema must stay in sync across both services.

### Workflow

1. **Modify Drizzle schema** in `src/db/schema.ts` (source of truth)
2. **Generate migration**: `pnpm db:generate`
3. **Apply migration**: `pnpm db:migrate`
4. **Regenerate Go types**: `mise run sqlc-generate`
5. **Update OpenAPI if needed**: `mise run swag`
6. **Regenerate TS SDK**: `pnpm generate:go-api`

### Full command sequence

```bash
pnpm db:generate
pnpm db:migrate
mise run sqlc-generate
mise run swag
pnpm generate:go-api
```

### What to verify during code review

- [ ] New DB fields in `src/db/schema.ts` have corresponding sqlc queries updated
- [ ] Drizzle migration exists in `drizzle/` for schema changes
- [ ] Go types in `services/price-service/internal/database/sqlcgen/` match the schema
- [ ] If field is exposed via API, OpenAPI spec (`docs/swagger.json`) is updated
- [ ] TypeScript SDK in `src/lib/go-api/` reflects any API changes
- [ ] No raw SQL queries bypass sqlc (except documented exceptions)

### Common mistakes

- Adding field to Drizzle but forgetting `mise run sqlc-generate`
- Adding field to Go queries but not running `mise run swag` for API changes
- Modifying handler responses without regenerating the TS SDK
