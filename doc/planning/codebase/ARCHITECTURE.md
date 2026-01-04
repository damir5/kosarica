# Architecture

## Overview
**Kosarica** is a price tracking application for Croatian retail chains. It aggregates pricing data from 11 retail chains, normalizes it, and stores it for comparison.

## High-Level Design

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Workers                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  TanStack   │  │   oRPC      │  │  Better Auth        │  │
│  │  Start SSR  │  │   API       │  │  (Passkey support)  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                           │                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Ingestion Pipeline                      │    │
│  │  discover → fetch → expand(zip) → parse → persist   │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
          │                │                    │
    ┌─────▼─────┐   ┌─────▼─────┐      ┌──────▼──────┐
    │  D1 (SQL) │   │  R2 (Blob)│      │   Queues    │
    │ Database  │   │  Storage  │      │ (Async Jobs)│
    └───────────┘   └───────────┘      └─────────────┘
```

## Domain Model

### Retail World (source data)
- **chains** - Retail chains (konzum, lidl, plodine, etc.)
- **stores** - Physical store locations
- **store_identifiers** - Filename codes, portal IDs for store resolution
- **retailer_items** - Products as the retailer defines them
- **retailer_item_barcodes** - EAN/barcode mappings

### Canonical Catalog (normalized)
- **products** - Unified product definitions
- **product_aliases** - Alternative product names
- **product_links** - Links retailer_items → products
- **product_relations** - Variants, substitutes, bundles

### Price Data
- **store_item_state** - Current price state per store+item
- **store_item_price_periods** - Price history with time ranges

### Ingestion Tracking
- **ingestion_runs** - Batch runs with status/stats
- **ingestion_files** - Files processed per run
- **ingestion_file_entries** - Individual rows from files
- **ingestion_errors** - Error logging with severity

## Design Patterns

### Chain Adapter Pattern
Each retail chain implements `ChainAdapter` interface (`src/ingestion/chains/`):
- `discover()` - Find available price files
- `fetch()` - Download with rate limiting
- `parse()` - Normalize to `NormalizedRow`
- `extractStoreIdentifier()` - Map filename → store
- `validateRow()` - Chain-specific validation

Base classes: `BaseChainAdapter`, `BaseCsvAdapter`, `BaseXmlAdapter`

### Queue-Based Processing
Messages flow through Cloudflare Queues:
1. `discover` → Find files
2. `fetch` → Download to R2
3. `expand` → Unzip if needed
4. `parse` → Extract rows
5. `persist` → Write to D1

### Request Context
Server-side code accesses bindings via `getEnv()`, `getDb()` from `src/utils/bindings.ts`. Context is set per-request.

## Key Flows

### Authentication
`/api/auth/*` → Better Auth handler → D1 (user, session, account, passkey tables)

### RPC API
`/api/rpc/*` → oRPC router (`src/orpc/router/`) → D1

### Ingestion
1. Cron trigger or CLI command starts run
2. Chain adapter discovers files
3. Files fetched with rate limiting to R2
4. Parser normalizes rows
5. Store resolution matches filename → store
6. Persist to store_item_state with deduplication

## Supported Chains
konzum, lidl, plodine, interspar, studenac, kaufland, eurospin, dm, ktc, metro, trgocentar

Each supports different file formats (CSV, XML, XLSX) with varying encodings (UTF-8, Windows-1250).
