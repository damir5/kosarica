# Project Structure

## Root Directory
```
kosarica/
├── drizzle/              # Database migrations
├── public/               # Static assets
├── scripts/              # Dev scripts (setup-dev.ts)
├── src/                  # Application source
├── biome.json            # Linting/formatting config
├── components.json       # shadcn/ui configuration
├── drizzle.config.ts     # Drizzle ORM config
├── package.json          # Dependencies & scripts
├── tsconfig.json         # TypeScript config
├── vite.config.ts        # Vite + Cloudflare config
├── vitest.config.ts      # Test configuration
├── wrangler.jsonc        # CF Workers config (local)
├── wrangler.test.jsonc   # CF Workers config (test)
└── wrangler.prod.jsonc   # CF Workers config (prod)
```

## Source Directory (`src/`)
```
src/
├── components/           # React components
│   ├── admin/           # Admin dashboard components
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
├── db/                  # Database layer
│   ├── index.ts         # DB connection factory
│   ├── schema.ts        # Drizzle schema definitions
│   └── custom-types.ts  # Custom column types (cuid2)
│
├── ingestion/           # Price data ingestion system
│   ├── chains/          # Chain adapters (per-retailer)
│   │   ├── base.ts      # Base adapter classes
│   │   ├── config.ts    # Chain configurations
│   │   ├── index.ts     # Registry
│   │   └── *.ts         # Chain implementations
│   ├── cli/             # CLI commands
│   │   ├── discover.ts  # Find price files
│   │   ├── fetch.ts     # Download files
│   │   ├── expand.ts    # Extract ZIPs
│   │   ├── parse.ts     # Parse files
│   │   └── run.ts       # Full pipeline
│   ├── core/            # Shared ingestion logic
│   │   ├── types.ts     # Type definitions
│   │   ├── normalize.ts # Data normalization
│   │   ├── persist.ts   # Database persistence
│   │   ├── rate-limit.ts# Rate limiting
│   │   └── storage.ts   # R2 storage helpers
│   ├── parsers/         # File format parsers
│   │   ├── csv.ts       # CSV parser
│   │   ├── xml.ts       # XML parser
│   │   └── xlsx.ts      # Excel parser
│   └── worker.ts        # Queue consumer worker
│
├── integrations/        # Third-party integrations
│
├── lib/                 # Shared utilities
│   ├── auth.ts          # Better Auth setup (server)
│   ├── auth-client.ts   # Better Auth client
│   ├── auth-server.ts   # Auth server helpers
│   └── utils.ts         # General utilities (cn)
│
├── orpc/                # RPC API layer
│   ├── client.ts        # oRPC client setup
│   ├── schema.ts        # Shared schemas
│   └── router/          # API routes
│       ├── index.ts     # Router aggregation
│       ├── admin.ts     # Admin endpoints
│       ├── settings.ts  # App settings
│       ├── todos.ts     # Todo CRUD
│       └── users.ts     # User management
│
├── routes/              # TanStack Router pages
│   ├── __root.tsx       # Root layout
│   ├── index.tsx        # Home page
│   ├── login.tsx        # Login page
│   ├── setup.tsx        # Initial setup
│   ├── api.$.ts         # Catch-all API route
│   ├── api.auth.$.ts    # Auth API routes
│   ├── api.rpc.$.ts     # RPC API routes
│   ├── _admin.admin.*.tsx # Admin pages
│   └── demo/            # Demo routes/APIs
│
├── utils/               # Utility modules
│   ├── bindings.ts      # CF Workers bindings access
│   ├── id.ts            # ID generation (cuid2)
│   ├── logger.ts        # Logging utilities
│   └── request-context.ts # Request context
│
├── env.ts               # Environment types
├── polyfill.ts          # Runtime polyfills
├── router.tsx           # Router setup
├── routeTree.gen.ts     # Generated route tree
└── styles.css           # Global styles
```

## Database Migrations (`drizzle/`)
```
drizzle/
├── 0000_young_famine.sql    # Initial auth tables
├── 0001_rich_frog_thor.sql  # Settings table
├── 0002_clean_magdalene.sql # Retail/catalog/ingestion tables
├── 0003_cute_the_professor.sql
├── 0004_ancient_newton_destine.sql
└── meta/                    # Migration metadata
```

## Entry Points
- **SSR**: `@tanstack/react-start/server-entry` (configured in wrangler)
- **Routes**: `src/routes/__root.tsx` → child routes
- **API**: `src/routes/api.*.ts` handlers
- **Ingestion Worker**: `src/ingestion/worker.ts`
