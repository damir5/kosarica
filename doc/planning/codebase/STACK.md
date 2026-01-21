# Technology Stack

## Primary Languages
- **TypeScript** (ES2022 target) - Node.js frontend
- **Go 1.21+** - Backend service

## Runtime & Deployment

### Node.js Frontend
- **Vite 7** - Build tool and dev server
- **Node.js 20+** - Runtime (mise.toml for version management)
- **TanStack Start** - Full-stack framework with SSR

### Go Backend
- **Go 1.21+** - Runtime
- **chi v5** - HTTP router
- **pgx/v5** - PostgreSQL driver (hand-written SQL, NOT sqlc)

## Frontend Framework
- **React 19** with react-dom
- **TanStack Router** - File-based routing (`src/routes/`)
- **TanStack Query** - Server state management
- **TanStack Table** - Data table components

## Styling
- **Tailwind CSS 4** with `@tailwindcss/vite` plugin
- **tw-animate-css** - Animation utilities
- **Radix UI** - Unstyled accessible components (dialog, dropdown-menu, select, slot, switch)
- **shadcn/ui** - Component patterns (via `components.json`)
- **lucide-react** - Icon library
- **class-variance-authority** + **clsx** + **tailwind-merge** - Class utilities

## Backend / API

### Node.js Layer
- **oRPC** - Type-safe RPC framework (`@orpc/server`, `@orpc/client`, `@orpc/tanstack-query`)
- **Better Auth** - Authentication with passkey support
- **Drizzle ORM** - SQL database toolkit + schema authority
- **postgres-js** - PostgreSQL driver (low-latency)

### Go Service
- **chi v5** - HTTP router
- **pgx/v5** - PostgreSQL driver with connection pooling
- **std lib** - encoding/csv, encoding/xml for parsing
- **stream** - Memory-efficient file processing

## Database
- **PostgreSQL 15+** - Primary database (NOT Cloudflare D1/SQLite)
- **Drizzle Kit** - Schema migrations from Node.js

## Authentication

### Better Auth
- **Provider**: Email/password + Passkey (WebAuthn)
- **Endpoint**: `/api/auth/*`
- **Tables**: `user`, `session`, `account`, `verification`, `passkey`

## Data Processing (Go Service)
- **encoding/csv** - CSV parsing (standard library)
- **encoding/xml** - XML parsing (standard library)
- **github.com/xuri/excelize/v2** - XLSX parsing
- **compress/gzip** - ZIP archive handling
- **golang.org/x/text/encoding** - Character encoding conversion (Windows-1250 to UTF-8)

## Validation
- **Zod 4** - Schema validation (via `@orpc/zod`)

## Dev Dependencies

### Node.js
- **Biome 2.2** - Linting and formatting
- **Vitest 3** - Unit testing
- **Testing Library** - React component testing
- **tsx** - TypeScript execution

### Go
- **standard testing** - `go test ./...`
- **testify** - Assertions and mocking

## Local Dev Workflow

### Prerequisites
- Go 1.21+
- Node.js 20+
- PostgreSQL 15+
- pnpm

### Setup (First Time)

```bash
# Install dependencies
pnpm install

# Setup environment
cp .env.example .env
# Edit .env with your database URL

# Run migrations
pnpm db:migrate

# Install Go dependencies
cd services/price-service
go mod download
```

### Running (Two Terminals)

```bash
# Terminal 1: Node.js frontend + API
pnpm dev

# Terminal 2: Go price service
cd services/price-service
go run cmd/server/main.go
# Or with hot reload:
air
```

### Database Migrations

```bash
# After editing src/db/schema.ts:
pnpm db:generate  # Creates migration SQL
pnpm db:migrate   # Applies to database
```

### Testing

```bash
# Node.js tests
pnpm test

# Go tests
cd services/price-service
go test ./internal/... -v
```

## Tooling Requirements

| Tool | Version | Purpose |
|------|---------|---------|
| Go | 1.21+ | Backend service |
| Node.js | 20+ | Frontend runtime |
| pnpm | 9+ | Package manager |
| PostgreSQL | 15+ | Database |
| mise | (optional) | Version management |
| air | (optional) | Go hot reload |

## Removed (Legacy)

The following have been removed and should NOT be referenced:

- ~~Cloudflare D1~~ (SQLite at edge)
- ~~Cloudflare R2~~ (Object storage)
- ~~Cloudflare Queues~~ (Async jobs)
- ~~Cloudflare Workers~~ (Edge runtime)
- ~~wrangler~~ (CF CLI)

## Environment Variables

### Node.js (.env)
```
DATABASE_URL=postgresql://user:pass@localhost:5432/kosarica
INTERNAL_API_KEY=your-secret-key
BETTER_AUTH_SECRET=your-32-char-secret
BETTER_AUTH_URL=http://localhost:3000
PASSKEY_RP_ID=localhost
PASSKEY_RP_NAME=Kosarica App
```

### Go Service
```
DATABASE_URL=postgresql://user:pass@localhost:5432/kosarica
PORT=8080
INTERNAL_API_KEY=your-secret-key
PRICE_SERVICE_RATE_LIMIT_REQUESTS_PER_SECOND=2
```
