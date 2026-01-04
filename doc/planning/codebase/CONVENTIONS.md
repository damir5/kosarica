# Code Conventions

## Formatting (Biome)
- **Indent**: Tabs
- **Quotes**: Double quotes for JS/TS strings
- **Organize imports**: Auto-enabled
- Config: `biome.json`

## TypeScript
- **Strict mode**: Enabled
- **Target**: ES2022
- **Module**: ESNext with bundler resolution
- **Path aliases**: `@/*` maps to `./src/*`

## File Naming
- **Components**: PascalCase (`Header.tsx`, `AdminSidebar.tsx`)
- **Routes**: kebab-case with dot separators (`_admin.admin.users.tsx`)
- **Utilities**: camelCase (`auth-client.ts`, `request-context.ts`)
- **Tests**: `*.test.ts` alongside source files

## Route Naming (TanStack Router)
- Underscore prefix for layout groups (`_admin/`)
- Dot separators for nested routes (`_admin.admin.users.tsx`)
- `$` suffix for dynamic params
- `api.*.ts` for API routes

## Database Schema
- **Table names**: snake_case plural (`retailer_items`, `store_item_state`)
- **Column names**: snake_case (`chain_slug`, `external_id`)
- **ID prefixes**: 3-letter prefixes (`rit`, `sis`, `usr`)
  - Custom cuid2 generator in `src/db/custom-types.ts`
- **Timestamps**: Unix epoch integers with `{ mode: 'timestamp' }`
- **Booleans**: Integer with `{ mode: 'boolean' }`

## ID Prefixes
| Entity | Prefix | Example |
|--------|--------|---------|
| User | `usr` | `usr_abc123...` |
| Session | `ses` | `ses_abc123...` |
| Account | `acc` | `acc_abc123...` |
| Verification | `ver` | `ver_abc123...` |
| Passkey | `psk` | `psk_abc123...` |
| Store | `sto` | `sto_abc123...` |
| Store Identifier | `sid` | `sid_abc123...` |
| Retailer Item | `rit` | `rit_abc123...` |
| Retailer Barcode | `rib` | `rib_abc123...` |
| Product | `prd` | `prd_abc123...` |
| Product Alias | `pal` | `pal_abc123...` |
| Product Link | `plk` | `plk_abc123...` |
| Product Relation | `prl` | `prl_abc123...` |
| Store Item State | `sis` | `sis_abc123...` |
| Store Item Price | `sip` | `sip_abc123...` |
| Ingestion Run | `igr` | `igr_abc123...` |
| Ingestion File | `igf` | `igf_abc123...` |
| Ingestion Entry | `ige` | `ige_abc123...` |
| Ingestion Error | `ier` | `ier_abc123...` |
| App Settings | `cfg` | `cfg_abc123...` |

## Chain Adapter Pattern
- Each chain adapter extends base class (`BaseCsvAdapter`, `BaseXmlAdapter`)
- Configuration in `CHAIN_CONFIGS` (`src/ingestion/chains/config.ts`)
- Column/field mappings per adapter
- Override `preprocessContent()`, `postprocessResult()` for chain-specific logic

## API Routes (oRPC)
- Nested router structure (`admin.users.list`, `admin.settings.get`)
- Zod schemas for input validation
- Procedures return typed responses

## Component Patterns
- Functional components with hooks
- Props destructured in signature
- Use `cn()` from `lib/utils` for className merging
- Radix UI primitives with custom styling
