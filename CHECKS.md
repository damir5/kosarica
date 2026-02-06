# Code Review Checks

## Required Verification

Run these before handing work off:

```bash
pnpm validate:schema
pnpm validate:neverthrow
pnpm knowledge:validate
pnpm knowledge:kpi
pnpm test
```

## Rules

- Prefer Drizzle for Postgres queries; use `sql` only when necessary.
- NEVER use `any` on system boundaries.
- `unknown` is allowed only when unavoidable and narrowed immediately.
- In neverthrow-boundary layers, do not use `throw`; return typed errors (`Result`/`ResultAsync`).
