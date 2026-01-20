# Architecture Documentation

## Overview

The Price Service is a Go-based microservice designed to scrape, parse, and normalize price data from multiple Croatian retail chains. The architecture prioritizes reliability, extensibility, and performance.

## Core Principles

1. **Chain Abstraction**: Each retailer is an isolated adapter with common base functionality
2. **Parser Independence**: Parsers are decoupled from adapters for reusability
3. **Storage Abstraction**: Local storage with planned S3 migration path
4. **Rate Limiting**: Built-in throttling prevents server overload
5. **Error Tracking**: Detailed logging and database status tracking

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         HTTP Server (Gin)                       │
│                        Port: 3000                               │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
         ┌──────▼──────┐              ┌──────▼──────┐
         │   Handlers  │              │     CLI     │
         └──────┬──────┘              └──────┬──────┘
                │                             │
         ┌──────▼──────────────────────────────▼──────┐
         │              Pipeline Layer                 │
         │  (Discover → Fetch → Parse → Persist)      │
         └──────┬──────────────────────────────┬──────┘
                │                              │
         ┌──────▼──────┐              ┌───────▼────────┐
         │   Adapters  │              │    Database    │
         │   (11 chains)│              │   (PostgreSQL) │
         └──────┬──────┘              └────────────────┘
                │
    ┌───────────┼───────────┐
    │           │           │
┌───▼───┐  ┌───▼───┐  ┌───▼────┐
│  CSV  │  │  XML  │  │  XLSX  │  Parsers
└───────┘  └───────┘  └────────┘
```

## Layer Breakdown

### 1. HTTP Layer (`cmd/server/`)

**Gin HTTP Server** with graceful shutdown

- Port: 3000 (configurable)
- Timeout: 30s read/write
- Middleware: logging, recovery, CORS-ready
- Routes:
  - `GET /health` - Health check
  - `POST /internal/admin/ingest/:chain` - Trigger ingestion
  - `GET /internal/admin/ingest/status/:runId` - Check status
  - `GET /internal/admin/ingest/runs/:chain` - List runs

**Graceful Shutdown:**
```go
quit := make(chan os.Signal, 1)
signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
<-quit
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
srv.Shutdown(ctx)
```

### 2. Pipeline Layer (`internal/pipeline/`)

Four-phase ingestion pipeline:

```
Discover → Fetch → Parse → Persist
```

#### Discover Phase
- Scrapes chain portal for download links
- Extracts metadata (filename, type, last-modified)
- Supports: HTML links, JSON APIs, static URLs

#### Fetch Phase
- Downloads files with rate limiting
- Handles 429 with exponential backoff
- Calculates SHA-256 for deduplication
- Stores in local filesystem (S3 planned)

#### Parse Phase
- Delegates to appropriate parser (CSV/XML/XLSX)
- Handles encoding detection (Windows-1250 → UTF-8)
- Alternative mapping fallback
- Returns NormalizedRow[] with validation

#### Persist Phase
- Upserts to `retailer_items` table
- Updates `store_item_state` junction table
- Records errors in `ingestion_run_errors`
- Updates `ingestion_runs` status

### 3. Adapter Layer (`internal/adapters/`)

#### Base Adapters

**BaseChainAdapter** - Common functionality for all chains:
- HTTP client with retry
- Store ID extraction patterns
- Store metadata extraction
- HTML link discovery

**BaseCsvAdapter** - CSV-specific:
- Column mapping (primary + alternative)
- Delimiter auto-detection
- Encoding detection
- Price format handling

**BaseXmlAdapter** - XML-specific:
- Field mapping (string paths OR extractors)
- Multiple item path discovery
- Object text content handling
- Alternative field mappings

**BaseXlsxAdapter** - XLSX-specific:
- Numeric/string column indices
- Header row count config
- Excel serial date conversion
- Sheet selection

#### Chain Adapters (11 implementations)

| Chain | Format | Special Features |
|-------|--------|------------------|
| Konzum | CSV | Croatian/English mappings, store in filename |
| Lidl | ZIP→CSV | Multi-GTIN splitting, store in filename |
| Studenac | XML | Dynamic store ID extraction |
| DM | XLSX | Numeric column indices, national pricing |
| Plodine | CSV in ZIP | Windows-1250 encoding |
| Interspar | CSV | JSON API discovery |
| Kaufland | CSV | JSON API discovery, tab delimiter |
| Eurospin | CSV in ZIP | HTML `<option>` discovery |
| KTC | CSV | Windows-1250 encoding |
| Metro | CSV | UTF-8 encoding |
| Trgocentar | XML | Dynamic anchor price extraction |

### 4. Parser Layer (`internal/parsers/`)

#### CSV Parser

**Encoding Detection:**
- Scores Windows-1250 byte sequences for Croatian chars (Š, Đ, Č, Ž, Ć)
- UTF-8 BOM detection (0xEF 0xBB 0xBF)
- Defaults to UTF-8

**Delimiter Detection:**
- Scans first 100 rows
- Detects comma, semicolon, tab
- Most frequent delimiter wins

**Price Parsing:**
- European format: `1.234,56` (comma decimal, dot thousands)
- US format: `1,234.56` (dot decimal, comma thousands)
- Heuristic: last comma > last dot = European

**Alternative Mappings:**
```go
// Try primary mapping
result := parseWithMapping(content, primaryMapping)
// If 0 valid rows, try alternative
if result.ValidRows == 0 && alternativeMapping != nil {
    result = parseWithMapping(content, alternativeMapping)
}
```

#### XML Parser

**Item Path Discovery:**
- Tries multiple paths: `products.product`, `Products.Product`, etc.
- First non-empty result wins

**Field Mapping:**
```go
type XmlFieldMapping struct {
    Name         string  // Path: "product.name"
    NameExtractor func(map[string]interface{}) string  // Custom extractor
}
```

**Object Text Content:**
Handles XML structures where text is in special keys:
- `#text`
- `_text`
- `_`

#### XLSX Parser

**Column Indices:**
```go
type XlsxColumnMapping struct {
    Name     string   // "A" or 0 (int)
    Price    string   // "C" or 2 (int)
}
```

**Date Conversion:**
- Excel serial dates (days since 1900-01-01)
- Handles 1900 leap year bug (Excel treats 1900 as leap year, it's not)

### 5. HTTP Client Layer (`internal/http/`)

**Rate Limiting:**
- Token bucket: 2 req/s default
- Configurable per chain

**Retry Logic:**
```go
// Exponential backoff with jitter
baseDelay = 100ms * 2^attempt
jitter = rand(0, 25% of baseDelay)
totalDelay = baseDelay + jitter

// 429 gets special treatment (3x multiplier, not 2x)
if statusCode == 429 {
    multiplier = 3.0
}
```

**Retry-After Header:**
- Parses `Retry-After: N` (seconds)
- Overrides calculated backoff

**Retry Statuses:**
- 429 (Too Many Requests)
- 500-504 (Server errors)

### 6. Database Layer (`internal/database/`)

**Connection Pool (pgx/v5):**
- Max connections: 25
- Min connections: 5
- Max lifetime: 1 hour
- Max idle time: 30 minutes

**Tables:**
- `retailer_items` - Product catalog
- `retailer_item_barcodes` - GTIN/EAN codes
- `stores` - Store locations
- `store_item_state` - Store-specific pricing
- `ingestion_runs` - Execution tracking
- `ingestion_run_errors` - Error details
- `archives` - File tracking (planned)

**Upsert Strategy:**
```sql
INSERT INTO retailer_items (...)
VALUES (...)
ON CONFLICT (chain_slug, external_id)
DO UPDATE SET price = EXCLUDED.price, ...
```

### 7. Storage Layer (`internal/storage/`)

**Interface:**
```go
type Storage interface {
    Get(ctx context.Context, key string) ([]byte, error)
    Put(ctx context.Context, key string, data []byte, metadata map[string]string) error
    Delete(ctx context.Context, key string) error
    List(ctx context.Context, prefix string) ([]string, error)
}
```

**Current Implementation:** Local filesystem

**Planned:** AWS S3 with same interface

### 8. Types Layer (`internal/types/`)

**Core Types:**

- `FileType` - csv, xml, xlsx, zip
- `NormalizedRow` - Universal product format
- `DiscoveredFile` - Metadata before download
- `FetchedFile` - Content after download
- `ExpandedFile` - Extracted from ZIP
- `ParseResult` - Parsed data + errors
- `IngestionStatus` - pending, running, completed, failed

## Croatian Transparency Fields

Per Croatian law, retailers must display:

| Field | Description | Example |
|-------|-------------|---------|
| `unitPrice` | Price per unit | 150 (HRR/kg) |
| `unitPriceBaseQuantity` | Unit quantity | "1kg" |
| `unitPriceBaseUnit` | Unit type | "kg" |
| `lowestPrice30d` | Lowest price in 30 days | 1200 |
| `anchorPrice` | Reference price | 1800 |
| `anchorPriceAsOf` | Reference date | 2025-12-01 |

## Configuration

**Hierarchy (highest to lowest priority):**
1. Environment variables (`PRICE_SERVICE_*`)
2. Config file (`config/config.yaml`)
3. Defaults (hardcoded)

**Key Settings:**
- `server.port` - HTTP port (default: 3000)
- `database.url` - PostgreSQL connection
- `rate_limit.requests_per_second` - Throttle (default: 2)
- `storage.base_path` - Archive location

## Error Handling

**Error Severity Levels:**
- `warning` - Non-critical, data still usable
- `error` - Row/document failed, rest continues
- `critical` - Entire ingestion aborted

**Error Types:**
- `parse` - Invalid format/encoding
- `validation` - Missing required fields
- `store_resolution` - Store not found, not auto-registered
- `persist` - Database write failure
- `fetch` - Download failed after retries
- `expand` - ZIP extraction failed

## Performance Considerations

**Rate Limiting:**
- Default: 2 req/s prevents server overload
- Per-chain: Can be overridden per adapter
- Token bucket: Bursts allowed up to limit

**Database:**
- Prepared statements via pgx
- Connection pooling
- Batch inserts where possible

**Memory:**
- ZIP expansion: Streamed, not all-in-memory
- Large files: Parsed in chunks

## Security

**Input Validation:**
- All external data validated before DB write
- Store ID patterns are regex-constrained
- GTIN/EAN format validated

**SQL Injection:**
- pgx parameterized queries only
- No string concatenation for queries

**Rate Limiting:**
- Prevents DoS on external portals
- Configurable per deployment

## Future Enhancements

1. **S3 Storage** - Replace local filesystem
2. **Message Queue** - Async ingestion with RabbitMQ/Redis
3. **Caching** - Redis for recent prices
4. **GraphQL API** - Alternative to REST
5. **Webhooks** - Notify on completion
6. **Distributed Tracing** - OpenTelemetry integration
7. **Metrics** - Prometheus endpoints
