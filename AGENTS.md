# Agent Instructions

## API Client Generation (Go → Node)

Go is the source of truth for shared API types (basket, prices, ingestion).
Types are exposed via OpenAPI spec and consumed via generated TypeScript SDK.

- Regenerate OpenAPI spec: `mise run swag` (from Go swag annotations)
- Regenerate TypeScript SDK: `mise run generate-go-api` (or `pnpm generate:go-api`)
- After changing Go handlers in `services/price-service/internal/handlers/`, run both commands
- Generated SDK lives in `src/lib/go-api/` with types, SDK functions, and Zod schemas

Annotated handlers:
- `internal/handlers/optimize.go` - basket optimization endpoints
- `internal/handlers/prices.go` - price query/search endpoints
- `internal/handlers/runs.go` - ingestion monitoring endpoints

---

## Minimal dev & test setup

- Dev .env: create `./.env.development` (or edit) with at least:
  - `DATABASE_URL=postgresql://kosarica:kosarica@localhost:5432/kosarica`
  - `PORT=3002` (frontend dev) and `GO_SERVICE_URL=http://localhost:3003`
  - `INTERNAL_API_KEY=dev-internal-api-key-change-in-development`

- Test .env: create `./.env.test` with at least:
  - `DATABASE_URL=postgresql://kosarica_test:kosarica_test@localhost:5432/kosarica_test`

Very brief test commands

- Apply migrations: `pnpm db:migrate` (uses `drizzle.config.ts` and `.env.test` when present)
- Start Go service for tests: `mise run test-service` (service runs via `go run`)
- Run full workflow (build, migrate, start service, run JS tests): `mise run test-all`
- Run frontend tests only: `pnpm test` (reports written to `/tmp/frontend-test-report.txt` on failures)


Go service env (services/price-service)

- `PORT` - port the service listens on (default `3003`)
- `HOST` - bind address (default `0.0.0.0`)
- `LOG_LEVEL` - logging verbosity (eg. `info`)
- `STORAGE_PATH` - path for archived files (eg. `./data/archives`)
- `INTERNAL_API_KEY` - internal auth key used by other services
- `DATABASE_URL` - Postgres connection string for the service (override in `.env.test` for tests)

These are set in `services/price-service/.env` and `services/price-service/.env.development`.
