# Technology Stack

**Analysis Date:** 2026-01-14

## Languages

**Primary:**
- TypeScript 5.9.3 - All application code (`package.json`)

**Secondary:**
- JavaScript (React/JSX) - Build scripts, config files

## Runtime

**Environment:**
- Node.js (no explicit version in package.json engines)
- Cloudflare Workers (server runtime) - `wrangler.jsonc`
- D1 Database (Cloudflare SQLite) - `wrangler.jsonc`

**Package Manager:**
- pnpm with lockfile v9.0 - `pnpm-lock.yaml`
- Monorepo configuration in workspace

## Frameworks

**Core:**
- React 19.2.3 - UI framework (`package.json`)
- TanStack Router 1.147.3 - File-based routing (`package.json`)
- TanStack React Start 1.149.1 - SSR framework (`package.json`)
- TanStack Query 5.90.16 - Data fetching/caching (`package.json`)

**API:**
- ORPC 1.13.2 - Type-safe RPC framework (`src/orpc/router/`, `src/routes/api.rpc.$.ts`)
  - `@orpc/server` - Server-side handlers
  - `@orpc/client` - Client-side calls
  - `@orpc/openapi` - OpenAPI/REST generation
  - `@orpc/tanstack-query` - React Query integration
  - `@orpc/zod` - Zod schema validation

**Authentication:**
- Better Auth 1.4.10 - Auth framework (`src/lib/auth.ts`)
- @better-auth/passkey 1.4.10 - WebAuthn support (`package.json`)

**Database:**
- Drizzle ORM 0.45.1 - Type-safe ORM (`src/db/schema.ts`)
- drizzle-kit 0.31.8 - Migrations (`package.json`)

**Testing:**
- Vitest 4.0.16 - Unit tests (`vitest.config.ts`)
- @testing-library/react 16.3.1 - React component testing
- Playwright 1.57.0 - E2E testing
- jsdom 27.4.0 - DOM emulation

**Build/Dev:**
- Vite 7.3.1 - Bundler (`vite.config.ts`)
- Wrangler 4.58.0 - Cloudflare Workers CLI
- Biome 2.3.11 - Formatter/linter (`biome.json`)

## Key Dependencies

**Critical:**
- Zod 4.3.5 - Schema validation (`package.json`)
- Commander 14.0 - CLI framework for ingestion (`src/ingestion/cli/`)

**UI:**
- Radix UI - Headless components (`@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, etc.)
- Tailwind CSS 4.1.18 - Styling (`vite.config.ts`)
- class-variance-authority 0.7.1 - Variant styling
- lucide-react 0.562.0 - Icons
- sonner 2.0.7 - Toast notifications

**Data Processing:**
- xlsx 0.18.5 - Excel parsing (`src/ingestion/parsers/xlsx.ts`)
- fast-xml-parser 5.3.3 - XML parsing (`src/ingestion/parsers/xml.ts`)
- adm-zip 0.5.16 - ZIP handling
- iconv-lite 0.7.2 - Character encoding
- fflate 0.8.2 - ZIP compression
- cheerio 1.1.2 - HTML parsing

**Infrastructure:**
- @tanstack/react-table - Data tables
- @tanstack/match-sorter-utils - Fuzzy search

## Configuration

**Environment:**
- `.dev.vars.example` - Environment variable template
- Key vars: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `PASSKEY_RP_ID`, `PASSKEY_RP_NAME`, `LOG_LEVEL`, `INGESTION_CHAINS`

**Build:**
- `vite.config.ts` - Vite + TanStack Start + Cloudflare plugin
- `tsconfig.json` - TypeScript ES2022 target, strict mode
- `biome.json` - Tabs, double quotes, recommended linting
- `drizzle.config.ts` - Drizzle kit migrations

## Platform Requirements

**Development:**
- macOS/Linux/Windows (any platform with Node.js)
- pnpm package manager
- Cloudflare Wrangler for local dev

**Production:**
- Cloudflare Workers - Runtime
- Cloudflare D1 - SQLite database
- Cloudflare R2 - File storage
- Cloudflare Queues - Message processing

---

*Stack analysis: 2026-01-14*
*Update after major dependency changes*
