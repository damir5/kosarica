# Architecture

**Analysis Date:** 2026-01-14

## Pattern Overview

**Overall:** Layered Full-Stack Monolith with Specialized Ingestion Pipeline

**Key Characteristics:**
- SSR React application on Cloudflare Workers
- Type-safe RPC API with ORPC
- Queue-based asynchronous data ingestion
- File-based routing with TanStack Router
- Serverless edge deployment

## Layers

**Presentation Layer:**
- Purpose: React components and file-based routing
- Contains: Route handlers, UI components, layouts
- Location: `src/routes/`, `src/components/`
- Depends on: API layer (ORPC client), TanStack Query
- Used by: Browser/end users

**API Layer:**
- Purpose: Type-safe RPC endpoints with validation
- Contains: ORPC router handlers, Zod schemas
- Location: `src/orpc/router/`, `src/routes/api.*.ts`
- Depends on: Database layer, authentication
- Used by: Presentation layer via ORPC client

**Business Logic Layer:**
- Purpose: Domain-specific services and handlers
- Contains: Auth logic, ingestion pipeline, query helpers
- Location: `src/lib/`, `src/ingestion/`, `src/db/queries/`
- Depends on: Database layer, external services
- Used by: API layer, CLI

**Data Access Layer:**
- Purpose: Database schema and queries
- Contains: Drizzle ORM schema, typed queries
- Location: `src/db/`
- Depends on: Cloudflare D1, Drizzle ORM
- Used by: Business logic layer

**Infrastructure Layer:**
- Purpose: Platform bindings, utilities, configuration
- Contains: Logger, request context, ID generation
- Location: `src/utils/`, `src/config/`
- Depends on: Cloudflare Workers runtime
- Used by: All layers

**Ingestion Subsystem:**
- Purpose: Retail chain data ingestion pipeline
- Contains: CLI, worker, chain adapters, parsers
- Location: `src/ingestion/`
- Depends on: R2 storage, Queues, database
- Used by: Cron triggers, CLI commands

## Data Flow

**HTTP Request (Web App):**

1. Browser requests page (e.g., `/admin`)
2. TanStack Router matches route (`src/routes/_admin.admin.tsx`)
3. `beforeLoad()` checks auth, redirects if needed
4. Server renders React component with SSR
5. Component uses `useQuery` for data fetching
6. ORPC client calls API endpoint
7. Handler validates input with Zod
8. Database query via Drizzle ORM
9. Response serialized and returned
10. Client hydrates with server data

**RPC Call:**

1. React component calls ORPC client method
2. Request to `/api/rpc/*` (`src/routes/api.rpc.$.ts`)
3. Request ID extracted, context created
4. ORPC RPCHandler routes to handler
5. Handler in `src/orpc/router/*.ts` executes
6. Drizzle query hits D1 database
7. Response returned with logging

**Ingestion Pipeline:**

1. Cron or CLI triggers discover phase
2. Chain adapter fetches file list from portal
3. Files queued for FETCH phase
4. Worker downloads files to R2 storage
5. ZIP files queued for EXPAND phase
6. Extracted files queued for PARSE phase
7. Parser creates NormalizedRow[] data
8. Rows queued for PERSIST phase (chunked if large)
9. Database upserts with signature deduplication
10. Store item prices and periods updated

**State Management:**
- Server: Stateless request handling
- Client: TanStack Query cache
- Database: D1 SQLite persistence
- Files: R2 object storage
- Queues: Message-based async processing

## Key Abstractions

**Chain Adapter:**
- Purpose: Standardize parsing for retail chains
- Examples: `KonzumAdapter`, `LidlAdapter`, `DMAdapter`
- Location: `src/ingestion/chains/*.ts`
- Pattern: Template method with chain-specific implementations
- Interface: `discover()`, `parse()`, `validateRow()`

**Parser:**
- Purpose: Parse file formats (CSV, XML, XLSX)
- Examples: `CsvParser`, `XmlParser`, `XlsxParser`
- Location: `src/ingestion/parsers/*.ts`
- Pattern: Strategy pattern with format-specific implementations

**ORPC Router:**
- Purpose: Define type-safe API endpoints
- Examples: `stores`, `ingestion`, `users`, `settings`
- Location: `src/orpc/router/*.ts`
- Pattern: Fluent builder with `.input()` and `.handler()`

**Storage:**
- Purpose: Abstract file storage operations
- Examples: `R2Storage`
- Location: `src/ingestion/core/storage.ts`
- Pattern: Interface abstraction over R2

**Queue Message:**
- Purpose: Typed async processing messages
- Examples: `DiscoverQueueMessage`, `ParseQueueMessage`
- Location: `src/ingestion/core/types.ts`
- Pattern: Discriminated union with `type` field

## Entry Points

**Web Application:**
- Location: `src/routes/__root.tsx`
- Triggers: HTTP requests to app routes
- Responsibilities: Root layout, devtools, outlet

**API Routes:**
- Location: `src/routes/api.rpc.$.ts`, `src/routes/api.auth.$.ts`
- Triggers: HTTP requests to `/api/*`
- Responsibilities: Handle RPC calls, auth endpoints

**Ingestion CLI:**
- Location: `src/ingestion/cli/index.ts`
- Triggers: `pnpm ingest <command>`
- Responsibilities: Manual ingestion operations
- Commands: discover, fetch, expand, parse, run, stores

**Ingestion Worker:**
- Location: `src/ingestion/worker.ts`
- Triggers: Queue messages, cron schedule (`0 6 * * *`)
- Responsibilities: Process queue messages, route to handlers

## Error Handling

**Strategy:** Throw at source, catch at boundaries with retry logic

**Patterns:**
- ORPC handlers: Zod validation, structured error responses
- Database: `retryOnBusy()` with exponential backoff for SQLITE_BUSY
- Queue: Automatic retry via Cloudflare Queues, dead letter queue
- CLI: try/catch with cleanup in finally blocks

**Error Types:**
- Validation errors: Returned with Zod issues
- Database errors: Logged, retried for transient issues
- Network errors: Retry with backoff in ingestion
- Auth errors: Redirect to login page

## Cross-Cutting Concerns

**Logging:**
- Implementation: `src/utils/logger.ts`
- Pattern: Contextual logger with request ID tracking
- Configuration: `LOG_LEVEL`, `LOG_TYPES` env vars

**Validation:**
- Implementation: Zod schemas at API boundaries
- Location: ORPC `.input()` definitions
- Pattern: Fail fast with typed errors

**Authentication:**
- Implementation: Better Auth middleware
- Location: `src/lib/auth.ts`, route `beforeLoad()` checks
- Pattern: Session-based with optional passkeys

**Request Context:**
- Implementation: `src/utils/request-context.ts`
- Pattern: AsyncLocalStorage for request-scoped data
- Usage: Request ID propagation for logging

---

*Architecture analysis: 2026-01-14*
*Update when major patterns change*
