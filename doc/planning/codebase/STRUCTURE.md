# Project Structure

## Root Directory
```
kosarica/
├── drizzle/              # Database migrations
├── doc/                  # Documentation
├── public/               # Static assets
├── scripts/              # Dev scripts
├── services/             # Backend services
│   └── price-service/    # Go price service
├── src/                  # Node.js application source
├── biome.json            # Linting/formatting config
├── components.json       # shadcn/ui configuration
├── drizzle.config.ts     # Drizzle ORM config
├── package.json          # Dependencies & scripts
├── tsconfig.json         # TypeScript config
├── vite.config.ts        # Vite config
└── vitest.config.ts      # Test configuration
```

## Go Service (`services/price-service/`)
```
services/price-service/
├── cmd/
│   └── server/              # Entry point
│       └── main.go
├── internal/
│   ├── adapters/
│   │   └── chains/          # Chain adapters (11 implementations)
│   │       ├── base.go      # Base adapter classes
│   │       ├── konzum.go    # Konzum scraper
│   │       ├── lidl.go      # Lidl scraper
│   │       └── ...          # Other chains
│   ├── database/
│   │   ├── db.go            # pgx connection pool
│   │   ├── models.go        # Generated from schema
│   │   └── *.go             # Query functions
│   ├── handlers/            # HTTP handlers
│   │   ├── prices.go        # Price endpoints
│   │   ├── runs.go          # Ingestion run endpoints
│   │   └── ...
│   ├── http/                # HTTP client + rate limiting
│   │   └── client.go        # Circuit breaker, retry logic
│   ├── jobs/                # Background jobs
│   │   ├── cleanup_database.go
│   │   └── cleanup_exceptions.go
│   ├── matching/            # Product matching
│   │   └── barcode.go
│   ├── middleware/          # HTTP middleware
│   │   └── ratelimit.go
│   ├── optimizer/           # Basket optimization algorithms
│   │   └── ...
│   ├── pipeline/            # 4-phase ingestion
│   │   ├── discover.go
│   │   ├── fetch.go
│   │   ├── parse.go
│   │   └── persist.go
│   ├── pricegroups/         # Price group hashing
│   │   ├── hash.go
│   │   └── hash_test.go
│   └── types/               # Core types
│       └── types.go
├── migrations/              # Go-specific migrations (rarely used)
├── go.mod
└── README.md
```

## Source Directory (`src/`)
```
src/
├── components/           # React components
│   ├── admin/           # Admin dashboard components
│   │   ├── stores/      # Store management UI
│   │   │   ├── BulkActionsBar.tsx
│   │   │   ├── PendingStoreCard.tsx
│   │   │   ├── PendingStoreQueue.tsx
│   │   │   ├── PendingStoresFilters.tsx
│   │   │   ├── StoreApprovalModal.tsx
│   │   │   ├── StoreDetailDrawer.tsx
│   │   │   ├── StoreEnrichmentSection.tsx
│   │   │   ├── StoreMergeModal.tsx
│   │   │   └── StoreStatusBadge.tsx
│   │   └── products/    # Product matching UI
│   ├── auth/            # Auth-related components
│   ├── ui/              # shadcn/ui base components
│   └── Header.tsx       # Main header
│
├── config/              # Configuration schemas
│   ├── clientConfig.ts  # Client-side config
│   ├── schemas.ts       # Zod schemas
│   └── serverConfig.ts  # Server-side config
│
├── data/                # Demo/seed data
│
├── db/                  # Database layer (Drizzle)
│   ├── index.ts         # DB connection factory
│   ├── schema.ts        # Drizzle schema definitions (SOURCE OF TRUTH)
│   └── custom-types.ts  # Custom column types
│
├── lib/                 # Shared utilities
│   ├── auth.ts          # Better Auth setup (server)
│   ├── auth-client.ts   # Better Auth client
│   ├── auth-server.ts   # Auth server helpers
│   ├── go-service-client.ts  # Go service proxy client
│   └── utils.ts         # General utilities (cn)
│
├── orpc/                # RPC API layer
│   ├── base.ts          # oRPC base configuration
│   ├── client.ts        # oRPC client setup
│   └── router/          # API routes
│       ├── index.ts     # Router aggregation
│       ├── stores.ts    # Store endpoints
│       ├── price-service.ts  # Price service proxy
│       ├── basket.ts    # Basket optimization
│       ├── products.ts  # Product matching
│       └── *.ts         # Other routers
│
├── routes/              # TanStack Router pages
│   ├── __root.tsx       # Root layout
│   ├── index.tsx        # Home page
│   ├── login.tsx        # Login page
│   ├── setup.tsx        # Initial setup
│   ├── api.$.ts         # Catch-all API route
│   ├── api.auth.$.ts    # Auth API routes
│   └── _admin.*/        # Admin pages
│
├── env.ts               # Environment types
├── polyfill.ts          # Runtime polyfills
├── router.tsx           # Router setup
└── routeTree.gen.ts     # Generated route tree
```

## Database Migrations (`drizzle/`)
```
drizzle/
├── 0000_*.sql           # Initial auth tables
├── 0001_*.sql           # Retail/catalog/ingestion tables
├── 0002_*.sql           # Additional tables
├── 0003_*.sql           # Price groups
├── 0004_*.sql           # Product matching
└── meta/                # Migration metadata
    └── _journal.json    # Migration order
```

## Entry Points

| Entry Point | Purpose |
|-------------|---------|
| `src/routes/__root.tsx` | Root layout with TanStack Router |
| `src/routes/api.*.ts` | API routes |
| `services/price-service/cmd/server/main.go` | Go service entry point |
| `src/orpc/router/index.ts` | oRPC router aggregation |

## Key File Explanations

### Go Service Integration
- `src/lib/go-service-client.ts` - Node.js client for Go service (circuit breaker, retry logic)
- `src/orpc/router/price-service.ts` - oRPC routes that proxy to Go service

### Schema Authority
- `src/db/schema.ts` - **SOURCE OF TRUTH** for all database tables
- Drizzle generates migrations from this file
- Go service reads from database, doesn't define schema

### Admin Components
- `src/components/admin/stores/` - Store enrichment workflow UI
- `src/components/admin/products/` - Product matching UI
