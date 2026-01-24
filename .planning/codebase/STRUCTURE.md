# Codebase Structure

**Analysis Date:** 2026-01-14

## Directory Layout

```
kosarica/main/
├── src/                    # Application source code
│   ├── routes/            # TanStack Router file-based routes
│   ├── components/        # React components
│   ├── orpc/              # ORPC server (RPC + OpenAPI)
│   ├── lib/               # Core libraries (auth, utils)
│   ├── db/                # Database (Drizzle ORM)
│   ├── ingestion/         # Price ingestion pipeline
│   ├── integrations/      # Third-party integrations
│   ├── config/            # Configuration
│   ├── utils/             # Utilities
│   ├── data/              # Demo/test data
│   ├── test/              # Test setup
│   └── styles/            # Global styles
├── drizzle/               # Database migrations
├── .planning/             # Project planning docs
├── package.json           # Project manifest
├── vite.config.ts         # Build configuration
├── wrangler.jsonc         # Cloudflare Workers config
├── tsconfig.json          # TypeScript config
└── biome.json             # Linting/formatting config
```

## Directory Purposes

**src/routes/**
- Purpose: File-based routing (TanStack Router)
- Contains: Route components, API handlers, layouts
- Key files:
  - `__root.tsx` - Root layout
  - `index.tsx` - Home page
  - `login.tsx` - Login page
  - `setup.tsx` - Initial setup wizard
  - `api.rpc.$.ts` - ORPC API handler
  - `api.auth.$.ts` - Auth API handler
  - `_admin/` - Admin section (nested layout)

**src/components/**
- Purpose: React components
- Contains: UI primitives, feature components
- Subdirectories:
  - `ui/` - shadcn-based primitives (Button, Dialog, Select, etc.)
  - `auth/` - Auth components (LoginForm, SetupWizard)
  - `admin/` - Admin dashboard components
    - `ingestion/` - Ingestion dashboard
    - `stores/` - Store management
  - `Header.tsx` - Main header
  - `AdminHeader.tsx` - Admin navigation

**src/orpc/**
- Purpose: ORPC server (RPC + OpenAPI)
- Contains: Router handlers, client factory
- Key files:
  - `router/index.ts` - Main router aggregating all endpoints
  - `router/admin.ts` - Admin config endpoints
  - `router/stores.ts` - Store CRUD endpoints
  - `router/ingestion.ts` - Ingestion management
  - `router/users.ts` - User management
  - `router/settings.ts` - App settings
  - `client.ts` - Client factory

**src/lib/**
- Purpose: Core libraries
- Contains: Auth setup, shared utilities
- Key files:
  - `auth.ts` - Better Auth factory
  - `auth-server.ts` - Server-side auth utils
  - `auth-client.ts` - Client-side auth hooks
  - `utils.ts` - Utility functions (cn, etc.)

**src/db/**
- Purpose: Database (Drizzle ORM)
- Contains: Schema, queries, types
- Key files:
  - `schema.ts` - All table definitions (20+ tables)
  - `index.ts` - Drizzle factory
  - `custom-types.ts` - Custom field types (CUID2)
  - `queries/stores.ts` - Reusable store queries

**src/ingestion/**
- Purpose: Price ingestion pipeline
- Contains: CLI, worker, chain adapters, parsers
- Subdirectories:
  - `cli/` - Commander-based CLI commands
    - `index.ts` - Main CLI entry
    - `discover.ts`, `fetch.ts`, `expand.ts`, `parse.ts`, `run.ts`
    - `stores.ts` - Store management CLI
  - `core/` - Core pipeline logic
    - `types.ts` - NormalizedRow, interfaces
    - `storage.ts` - R2Storage abstraction
    - `persist.ts` - Database persistence
    - `normalize.ts` - Data normalization
    - `rate-limit.ts` - Rate limiting
  - `chains/` - Chain adapters (11 chains)
    - `index.ts` - ChainAdapterRegistry
    - `base.ts` - Base adapter classes
    - `konzum.ts`, `lidl.ts`, `dm.ts`, etc.
  - `parsers/` - File format parsers
    - `csv.ts`, `xml.ts`, `xlsx.ts`
  - `services/` - Specialized services
    - `geocoding.ts` - Nominatim geocoding
  - `worker.ts` - Cloudflare Queue consumer
  - `__tests__/` - Ingestion tests

**src/config/**
- Purpose: Configuration
- Contains: Server and client config
- Key files:
  - `serverConfig.ts` - Server-side env vars
  - `clientConfig.ts` - Client-side build-time vars
  - `schemas.ts` - Zod validation schemas

**src/utils/**
- Purpose: Utilities
- Contains: Logger, bindings, ID generation
- Key files:
  - `logger.ts` - Contextual logging
  - `bindings.ts` - Cloudflare env/DB access
  - `request-context.ts` - Request ID tracking
  - `id.ts` - Prefixed ID generation

## Key File Locations

**Entry Points:**
- `src/routes/__root.tsx` - Web app root
- `src/routes/api.rpc.$.ts` - RPC API
- `src/ingestion/cli/index.ts` - CLI entry
- `src/ingestion/worker.ts` - Queue worker

**Configuration:**
- `vite.config.ts` - Vite + plugins
- `tsconfig.json` - TypeScript
- `biome.json` - Linting/formatting
- `wrangler.jsonc` - Cloudflare Workers
- `drizzle.config.ts` - Drizzle kit

**Core Logic:**
- `src/orpc/router/*.ts` - API endpoints
- `src/db/schema.ts` - Database schema
- `src/ingestion/core/persist.ts` - Data persistence
- `src/ingestion/chains/*.ts` - Chain adapters

**Testing:**
- `src/test/setup.ts` - Test setup
- `src/ingestion/__tests__/*.test.ts` - Ingestion tests
- `src/ingestion/core/persist.test.ts` - Persistence tests
- `src/db/queries/stores.test.ts` - Query tests

## Naming Conventions

**Files:**
- kebab-case.ts: Modules (`request-context.ts`, `rate-limit.ts`)
- PascalCase.tsx: React components (`UserTable.tsx`, `LoginForm.tsx`)
- *.test.ts: Test files alongside source

**Directories:**
- kebab-case: All directories
- Plural for collections: `routes/`, `components/`, `chains/`
- Underscore prefix: Layout groups (`_admin/`)

**Special Patterns:**
- `api.*.ts`: API route handlers (file-based routing)
- `__root.tsx`: Root layout (TanStack Router convention)
- `*.test.ts`: Co-located test files
- `index.ts`: Barrel exports

## Where to Add New Code

**New Feature:**
- Primary code: `src/routes/` (pages), `src/components/` (UI)
- API: `src/orpc/router/` (new router file)
- Tests: Co-located `*.test.ts` files

**New Component:**
- UI primitive: `src/components/ui/`
- Feature component: `src/components/{feature}/`
- Admin component: `src/components/admin/`

**New API Endpoint:**
- Handler: `src/orpc/router/{domain}.ts`
- Add to router: `src/orpc/router/index.ts`

**New Chain Adapter:**
- Adapter: `src/ingestion/chains/{chain}.ts`
- Config: `src/ingestion/chains/config.ts`
- Register: `src/ingestion/chains/index.ts`

**Utilities:**
- Shared helpers: `src/utils/`
- Lib functions: `src/lib/`
- Type definitions: `src/db/schema.ts` or co-located

## Special Directories

**drizzle/**
- Purpose: Database migrations
- Source: Generated by `drizzle-kit generate`
- Committed: Yes

**.planning/**
- Purpose: Project planning documents
- Source: Created by GSD workflow
- Committed: Yes

**.wrangler/**
- Purpose: Wrangler local state/cache
- Source: Generated by Wrangler
- Committed: No (gitignored)

---

*Structure analysis: 2026-01-14*
*Update when directory structure changes*
