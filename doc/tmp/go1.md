# Go Service Migration: Phased Implementation Plan

## Objective
Port all 11 TypeScript scrapers to Go. Each phase delivers testable functionality.

## Architecture Decisions
- **Location**: `/workspace/services/price-service/`
- **DB**: Direct Postgres via pgx (shares existing database)
- **API**: HTTP endpoints `POST /internal/admin/ingest/{chain}`
- **Port**: 3003 (`PRICE_SERVICE_PORT`)
- **Config**: YAML + env overrides (cobra/viper)
- **Storage**: Abstracted interface (local → S3 future)
- **Error tracking**: `ingestion_runs` table + structured logs

---

## Phase 1: Foundation & Database Migration

### Objective
Create Go service skeleton, database layer, and run first test ingestion.

### Files to Create

| Path | Purpose |
|------|---------|
| `services/price-service/go.mod` | Go module dependencies |
| `services/price-service/config/config.yaml` | Default configuration |
| `services/price-service/config/config.go` | Config loading (viper) |
| `services/price-service/internal/database/db.go` | pgx connection pool |
| `services/price-service/internal/database/models.go` | Go structs matching Drizzle schema |
| `services/price-service/internal/types/ingestion.go` | Core types (NormalizedRow, etc.) |
| `services/price-service/cmd/server/main.go` | HTTP server entrypoint |
| `services/price-service/internal/handlers/health.go` | Health check endpoint |

### Implementation Notes

**go.mod dependencies:**
```go
module github.com/yourorg/kosarica/services/price-service

go 1.21

require (
    github.com/spf13/cobra v1.8.0
    github.com/spf13/viper v1.18.2
    github.com/jackc/pgx/v5 v5.5.1
    github.com/gin-gonic/gin v1.9.1
    github.com/rs/zerolog v1.31.0
    github.com/google/uuid v1.6.0
)
```

**Config structure (matching TS):**
- Database URL from `DATABASE_URL` env
- Server port 3003
- Rate limit: 2 req/s
- Storage path: `./data/archives`

**Types (matching `/workspace/src/ingestion/core/types.ts`):**
```go
type NormalizedRow struct {
    StoreIdentifier      string     `json:"storeIdentifier"`
    ExternalID           *string    `json:"externalId,omitempty"`
    Name                 string     `json:"name"`
    Description          *string    `json:"description,omitempty"`
    Category             *string    `json:"category,omitempty"`
    Subcategory          *string    `json:"subcategory,omitempty"`
    Brand                *string    `json:"brand,omitempty"`
    Unit                 *string    `json:"unit,omitempty"`
    UnitQuantity         *string    `json:"unitQuantity,omitempty"`
    Price                int        `json:"price"` // cents
    DiscountPrice        *int       `json:"discountPrice,omitempty"`
    DiscountStart        *time.Time `json:"discountStart,omitempty"`
    DiscountEnd          *time.Time `json:"discountEnd,omitempty"`
    Barcodes             []string   `json:"barcodes"`
    ImageURL             *string    `json:"imageUrl,omitempty"`
    RowNumber            int        `json:"rowNumber"`
    RawData              string     `json:"rawData"`
    // Croatian transparency fields
    UnitPrice            *int       `json:"unitPrice,omitempty"`
    UnitPriceBaseQuantity *string   `json:"unitPriceBaseQuantity,omitempty"`
    UnitPriceBaseUnit    *string    `json:"unitPriceBaseUnit,omitempty"`
    LowestPrice30d       *int       `json:"lowestPrice30d,omitempty"`
    AnchorPrice          *int       `json:"anchorPrice,omitempty"`
    AnchorPriceAsOf      *time.Time `json:"anchorPriceAsOf,omitempty"`
}
```

### Verification Steps
```bash
cd services/price-service
go mod tidy
go build ./cmd/server
export DATABASE_URL="postgres://..."
./server &
curl http://localhost:3003/health
# Should return: {"status":"ok","database":"connected"}
```

---

## Phase 2: CSV Parser with Encoding Detection

### Objective
Implement CSV parser matching TS sophistication: encoding detection, delimiter auto-detect, alternative column mappings.

### Files to Create

| Path | Purpose |
|------|---------|
| `internal/parsers/csv/types.go` | CsvColumnMapping, CsvParserOptions |
| `internal/parsers/csv/encoding.go` | Windows-1250 detection (Croatian chars) |
| `internal/parsers/csv/delimiter.go` | Auto-detect comma/semicolon/tab |
| `internal/parsers/csv/parser.go` | Main parser with quoted field handling |
| `internal/parsers/csv/mapper.go` | Column index building + row mapping |
| `internal/parsers/csv/price.go` | European format price parsing |
| `internal/parsers/charset/decoder.go` | Windows-1250 to UTF-8 conversion |

### Implementation Notes

**Encoding detection (matching TS `src/ingestion/parsers/csv.ts`):**
- Score Windows-1250 bytes: Š(0x8A), š(0x9A), Đ(0xD0), đ(0xF0), Č(0xC8), č(0xE8), Ž(0x8E), ž(0x9E), Ć(0xC6), ć(0xE6)
- UTF-8 BOM detection (0xEF 0xBB 0xBF)
- Default UTF-8 if no Croatian chars detected

**Price parsing (European format):**
- Detect decimal separator: last comma > last dot = European (1.234,56)
- Remove thousands separators, convert to cents

**Alternative column mapping (critical TS feature):**
```go
type CsvParser struct {
    primaryMapping     CsvColumnMapping
    alternativeMapping CsvColumnMapping
}

// Try primary first, fall back to alternative if 0 valid rows
if result.ValidRows == 0 && p.alternativeMapping != nil {
    result = p.parseWithMapping(content, p.alternativeMapping)
}
```

### Verification Steps
```bash
go test ./internal/parsers/csv/... -v
# Test with sample files in /workspace/data/ingestion/
```

---

## Phase 3: Rate Limiting & HTTP Client

### Objective
Implement rate limiting with exponential backoff, matching TS sophistication (429 special handling, jitter).

### Files to Create

| Path | Purpose |
|------|---------|
| `internal/http/ratelimit/types.go` | RateLimitConfig, RateLimiter |
| `internal/http/ratelimit/limiter.go` | Token bucket throttling |
| `internal/http/ratelimit/retry.go` | Exponential backoff with jitter |
| `internal/http/client.go` | HTTP client with retry |

### Implementation Notes

**Matching TS `src/ingestion/core/rate-limit.ts`:**
- Default: 2 req/s
- Retry statuses: 429, 500-504
- 429 special handling: 3x multiplier (not 2x)
- Jitter: 0-25% of delay
- Retry-After header parsing

```go
func calculateBackoff(attempt int, is429 bool, retryAfter string) time.Duration {
    if retryAfter != "" {
        if sec, _ := strconv.Atoi(retryAfter); sec > 0 {
            return time.Duration(sec) * time.Second
        }
    }
    multiplier := 2.0
    if is429 {
        multiplier = 3.0  // Special 429 handling
    }
    baseDelay := time.Duration(100 * math.Pow(multiplier, float64(attempt))) * time.Millisecond
    jitter := time.Duration(rand.Float64() * 0.25 * float64(baseDelay))
    return baseDelay + jitter
}
```

### Verification Steps
```bash
go test ./internal/http/ratelimit/... -v
# Verify 2 req/s limiting
# Verify exponential backoff progression
# Verify 429 gets longer delay
```

---

## Phase 4: Base Chain Adapters

### Objective
Implement base adapter classes matching TS `src/ingestion/chains/base.ts`.

### Files to Create

| Path | Purpose |
|------|---------|
| `internal/adapters/base/chain.go` | BaseChainAdapter |
| `internal/adapters/base/csv.go` | BaseCsvAdapter |
| `internal/adapters/base/xml.go` | BaseXmlAdapter |
| `internal/adapters/discovery/html.go` | HTML link extraction |

### Implementation Notes

**Matching TS base adapter features:**
- `filenamePrefixPatterns` for store ID extraction
- `fileExtensionPattern` configurable
- `extractStoreIdentifierFromFilename()` with regex patterns
- `extractStoreMetadata()` for auto-registration (address parsing)
- Alternative mappings in CSV/XML adapters

**Base CSV adapter:**
```go
type BaseCsvAdapter struct {
    *BaseChainAdapter
    csvParser        *csv.Parser
    columnMapping    CsvColumnMapping
    altMapping       CsvColumnMapping
}

// Try primary mapping first, then alternative
func (a *BaseCsvAdapter) Parse(content []byte, filename string) (*ParseResult, error) {
    result := a.csvParser.Parse(content, a.columnMapping)
    if result.ValidRows == 0 && a.altMapping != nil {
        result = a.csvParser.Parse(content, a.altMapping)
    }
    return result, nil
}
```

### Verification Steps
```bash
go test ./internal/adapters/base/... -v
# Test store ID extraction
# Test HTML discovery
# Test alternative mapping fallback
```

---

## Phase 5: First Chain - Konzum (CSV)

### Objective
Implement first working chain end-to-end.

### Files to Create

| Path | Purpose |
|------|---------|
| `internal/adapters/chains/konzum.go` | Konzum scraper |
| `internal/adapters/registry/registry.go` | Chain registry |
| `internal/pipeline/pipeline.go` | Orchestration |
| `internal/pipeline/discover.go` | Discovery phase |
| `internal/pipeline/fetch.go` | Fetch phase |
| `internal/pipeline/parse.go` | Parse phase |
| `internal/pipeline/persist.go` | Persist phase |
| `internal/handlers/ingest.go` | Ingestion HTTP handler |

### Implementation Notes

**Konzum specifics (from `src/ingestion/chains/konzum.ts`):**
- Croatian headers: "ŠIFRA PROIZVODA", "NAZIV PROIZVODA", etc.
- Alternative mapping: English headers ("Code", "Name", etc.)
- Store ID: pattern `,(\d{4}),` in filename
- Store metadata: "SUPERMARKET,ADDRESS+POSTAL+CITY,STORE_ID,DATE,TIME.CSV"
- Discovery: pagination max 50 pages

**Full pipeline flow:**
```
1. Discover files from portal
2. Fetch each file (with rate limiting)
3. Parse to NormalizedRow[]
4. Persist to database (upsert retailer_items, update store_item_state)
5. Update ingestion_runs status
```

### Verification Steps
```bash
# Start server
cd services/price-service
./server &

# Trigger ingestion
curl -X POST http://localhost:3003/internal/admin/ingest/konzum

# Verify database
psql $DATABASE_URL -c "
SELECT status, processed_files, processed_entries
FROM ingestion_runs
ORDER BY created_at DESC LIMIT 1;
"

# Should show: status=completed, processed_files>0, processed_entries>0
```

---

## Phase 6: Lidl (CSV + ZIP + Multiple GTINs)

### Objective
Implement ZIP expansion and multiple GTIN handling.

### Files to Create

| Path | Purpose |
|------|---------|
| `internal/adapters/chains/lidl.go` | Lidl scraper |
| `internal/ingestion/zip/expand.go` | ZIP expansion |
| `internal/storage/interface.go` | Storage abstraction |
| `internal/storage/local.go` | Local filesystem storage |

### Implementation Notes

**Lidl specifics (from `src/ingestion/chains/lidl.ts`):**
- Discovery: dynamic download IDs (`/content/download/\d+/fileupload/...zip`)
- ZIP fanout: expand to per-store CSVs
- Multiple GTINs: split on `;` or `|`
- Store ID: `Lidl_DATE_STOREID` or `Lidl_Poslovnica_LOCATION`
- Store metadata: "Supermarket 265_Zagreb... "

**ZIP expansion:**
```go
func expandZip(ctx context.Context, storage Storage, zipKey string) ([]ExpandedFile, error) {
    content, _ := storage.Get(ctx, zipKey)
    reader, _ := zip.NewReader(bytes.NewReader(content), int64(len(content)))

    var expanded []ExpandedFile
    for _, f := range reader.File {
        if f.FileInfo().IsDir() || strings.HasPrefix(f.Name, "__MACOSX") {
            continue
        }
        rc, _ := f.Open()
        data, _ := io.ReadAll(rc)
        rc.Close()

        hash := sha256.Sum256(data)
        key := fmt.Sprintf("expanded/%s", f.Name)
        storage.Put(ctx, key, data, nil)
        expanded = append(expanded, ExpandedFile{
            StorageKey: key,
            Filename: f.Name,
            Type: detectFileType(f.Name),
            Hash: hex.EncodeToString(hash[:]),
        })
    }
    return expanded, nil
}
```

### Verification Steps
```bash
curl -X POST http://localhost:3003/internal/admin/ingest/lidl

# Check ZIP expansion in storage
ls -la services/price-service/data/archives/expanded/

# Verify multiple GTINs in database
psql $DATABASE_URL -c "
SELECT string_agg(barcode, ', ') as barcodes
FROM retailer_item_barcodes rib
JOIN retailer_items ri ON rib.retailer_item_id = ri.id
WHERE ri.chain_slug = 'lidl'
GROUP BY ri.id
HAVING count(*) > 1
LIMIT 5;
"
```

---

## Phase 7: XML Parser + Studenac

### Objective
Implement XML parser with multiple item path discovery.

### Files to Create

| Path | Purpose |
|------|---------|
| `internal/parsers/xml/types.go` | XmlFieldMapping |
| `internal/parsers/xml/parser.go` | XML parser |
| `internal/adapters/chains/studenac.go` | Studenac scraper |

### Implementation Notes

**XML parser features (from `src/ingestion/parsers/xml.ts`):**
- Multiple item paths: `products.product`, `Products.Product`, etc.
- Field mapping: string paths OR extraction functions
- Alternative field mappings
- Object text content: `#text`, `_text`, `_` keys

**Studenac specifics:**
- Store ID in XML: try `item.store_id`, `item.storeId`, `item.Store.Id`
- Filename pattern: `SUPERMARKET-Bijela_uvala_5_FUNTANA-T598-229-...`
- Extract: TYPE-LOCATION from pattern `^([A-Z]+)-(.+?)-T\d+-`

### Verification Steps
```bash
curl -X POST http://localhost:3003/internal/admin/ingest/studenac

# Verify XML parsing with various structures
```

---

## Phase 8: XLSX Parser + DM

### Objective
Implement XLSX parser with numeric column indices.

### Files to Create

| Path | Purpose |
|------|---------|
| `internal/parsers/xlsx/types.go` | XlsxColumnMapping (int|string) |
| `internal/parsers/xlsx/parser.go` | XLSX parser using excelize |
| `internal/adapters/chains/dm.go` | DM scraper |

### Implementation Notes

**XLSX parser features (from `src/ingestion/parsers/xlsx.ts`):**
- Numeric column indices for web format
- Header row count configuration
- Excel serial date conversion (1900 leap year bug)
- Alternative mapping support

**DM specifics:**
- National pricing only: `dm_national`
- Web format: numeric indices, skip 3 rows
- Local format: Croatian headers
- Fallback: local files in `./data/ingestion/dm/`

### Verification Steps
```bash
curl -X POST http://localhost:3003/internal/admin/ingest/dm

# Verify national pricing (single store)
psql $DATABASE_URL -c "
SELECT si.name, COUNT(*) as item_count
FROM stores si
JOIN store_item_state sis ON si.id = sis.store_id
JOIN retailer_items ri ON sis.retailer_item_id = ri.id
WHERE ri.chain_slug = 'dm'
GROUP BY si.name;
"
```

---

## Phase 9: Remaining 7 Chains

### Objective
Implement all remaining chains.

### Files to Create

| Path | Purpose |
|------|---------|
| `internal/adapters/chains/plodine.go` | Plodine (CSV in ZIP) |
| `internal/adapters/chains/interspar.go` | Interspar (JSON API discovery) |
| `internal/adapters/chains/kaufland.go` | Kaufland (JSON API discovery) |
| `internal/adapters/chains/eurospin.go` | Eurospin (option tag discovery) |
| `internal/adapters/chains/ktc.go` | KTC (CSV) |
| `internal/adapters/chains/metro.go` | Metro (CSV) |
| `internal/adapters/chains/trgocentar.go` | Trgocentar (XML, dynamic anchor price) |

### Chain-Specific Notes

**Plodine:** CSV in ZIP, semicolon delimiter, Windows-1250

**Interspar:** JSON API `Cjenik{YYYYMMDD}.json`, semicolon delimiter

**Kaufland:** JSON API discovery, tab delimiter

**Eurospin:** `<option>` tag discovery, CSV in ZIP

**KTC:** Standard CSV, semicolon, Windows-1250

**Metro:** Standard CSV, semicolon, UTF-8

**Trgocentar:** XML with dynamic anchor price (find `c_` + 6 digits pattern), store ID `P(\d{3})`

### Verification Steps
```bash
# Test each chain
for chain in plodine interspar kaufland eurospin ktc metro trgocentar; do
    echo "Testing $chain..."
    curl -X POST "http://localhost:3003/internal/admin/ingest/$chain"
    sleep 5
done

# Verify all chains in database
psql $DATABASE_URL -c "
SELECT chain_slug, COUNT(*) as item_count
FROM retailer_items
GROUP BY chain_slug
ORDER BY chain_slug;
"
```

---

## Phase 10: Storage Abstraction & Archive Tracking

### Objective
Implement archive tracking for deduplication and historical analysis.

### Database Migration

Create migration `drizzle/0001_add_archive_tracking.sql`:

```sql
-- Archives table: track all downloaded files
CREATE TABLE IF NOT EXISTS archives (
    id text PRIMARY KEY,
    chain_slug text NOT NULL,
    source_url text NOT NULL,
    filename text NOT NULL,
    original_format text NOT NULL,
    archive_path text NOT NULL,
    archive_type text NOT NULL,  -- 'local', 's3'
    content_type text,
    file_size bigint,
    compressed_size bigint,
    checksum text,
    downloaded_at timestamp with time zone NOT NULL DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_archives_chain_slug ON archives(chain_slug);
CREATE INDEX idx_archives_downloaded_at ON archives(downloaded_at);
CREATE INDEX idx_archives_checksum ON archives(checksum);

-- Add archive tracking to ingestion_runs
ALTER TABLE ingestion_runs
ADD COLUMN IF NOT EXISTS archive_id text REFERENCES archives(id),
ADD COLUMN IF NOT EXISTS source_url text;

-- Add archive_id to retailer_items for traceability
ALTER TABLE retailer_items
ADD COLUMN IF NOT EXISTS archive_id text REFERENCES archives(id);

CREATE INDEX idx_retailer_items_archive_id ON retailer_items(archive_id);
```

### Files to Create

| Path | Purpose |
|------|---------|
| `internal/storage/interface.go` | Storage interface (local/S3) |
| `internal/storage/local.go` | Local filesystem implementation |
| `internal/storage/archive.go` | Archive tracking logic |
| `internal/database/archive.go` | Archive persistence |

### Verification Steps
```bash
# Run migration
cd /workspace
pnpm db:migrate

# Trigger ingestion
curl -X POST http://localhost:3003/internal/admin/ingest/konzum

# Verify archive tracking
psql $DATABASE_URL -c "
SELECT chain_slug, COUNT(*) as file_count, SUM(file_size) as total_bytes
FROM archives
GROUP BY chain_slug;
"
```

---

## Phase 11: CLI Tool

### Objective
Implement CLI for manual operations and debugging.

### Files to Create

| Path | Purpose |
|------|---------|
| `cmd/cli/main.go` | CLI entrypoint (cobra) |
| `cmd/cli/ingest.go` | Ingest command |
| `cmd/cli/discover.go` | Discover command |
| `cmd/cli/parse.go` | Parse local file |

### CLI Commands

```bash
# Ingest specific chain
price-service ingest konzum --date 2026-01-19

# Ingest all chains
price-service ingest --all

# Discover files (no ingestion)
price-service discover lidl

# Parse local file
price-service parse data/sample.csv --chain konzum
```

### Verification Steps
```bash
cd services/price-service
go build -o price-service-cli cmd/cli/main.go

./price-service-cli --help
./price-service-cli discover konzum
./price-service-cli parse ~/sample.csv --chain konzum
```

---

## Phase 12: Testing Suite

### Objective
Comprehensive tests covering all components.

### Files to Create

| Path | Purpose |
|------|---------|
| `tests/integration/chains_test.go` | Chain integration tests |
| `tests/unit/parsers_test.go` | Parser unit tests |
| `tests/unit/adapter_test.go` | Adapter unit tests |
| `tests/e2e/pipeline_test.go` | End-to-end pipeline test |

### Verification Steps
```bash
# Unit tests
go test ./internal/... -v

# Integration tests (requires test database)
go test ./tests/integration/... -v

# E2E tests
go test ./tests/e2e/... -v

# Coverage
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

---

## Phase 13: Documentation & Deployment

### Objective
Complete documentation and deployment configuration.

### Files to Create

| Path | Purpose |
|------|---------|
| `README.md` | Service overview and setup |
| `docs/ARCHITECTURE.md` | Architecture decisions |
| `docs/CHAIN_ADAPTERS.md` | Chain adapter guide |
| `deployment/Dockerfile` | Multi-stage build |
| `deployment/docker-compose.yml` | Docker service definition |
| `config.example.yaml` | Example configuration |

### Verification Steps
```bash
# Build Docker image
docker build -t price-service:latest -f deployment/Dockerfile .

# Test with docker-compose
docker-compose -f deployment/docker-compose.yml up -d

# Verify service
curl http://localhost:3003/health
```

---

## Summary: Critical Files Reference

### Foundation (Phase 1-3)
- `services/price-service/go.mod`
- `services/price-service/config/config.go`
- `services/price-service/internal/database/db.go`
- `services/price-service/internal/types/ingestion.go`

### Parsers (Phase 2, 7-8)
- `services/price-service/internal/parsers/csv/parser.go`
- `services/price-service/internal/parsers/xml/parser.go`
- `services/price-service/internal/parsers/xlsx/parser.go`

### HTTP & Rate Limiting (Phase 3)
- `services/price-service/internal/http/ratelimit/retry.go`
- `services/price-service/internal/http/client.go`

### Adapters (Phase 4-9)
- `services/price-service/internal/adapters/base/csv.go`
- `services/price-service/internal/adapters/chains/konzum.go`
- `services/price-service/internal/adapters/chains/lidl.go`
- `services/price-service/internal/adapters/chains/studenac.go`
- `services/price-service/internal/adapters/chains/dm.go`
- `services/price-service/internal/adapters/chains/*.go` (7 remaining)

### Pipeline (Phase 5)
- `services/price-service/internal/pipeline/pipeline.go`
- `services/price-service/internal/handlers/ingest.go`
- `services/price-service/cmd/server/main.go`

### Storage & Archives (Phase 10)
- `services/price-service/internal/storage/interface.go`
- `services/price-service/internal/storage/local.go`
- `services/price-service/internal/database/archive.go`

### CLI (Phase 11)
- `services/price-service/cmd/cli/main.go`

### Migration (Phase 10)
- `drizzle/0001_add_archive_tracking.sql`

---

## TypeScript Cleanup (After Go Verification)

Once Go service is verified working:

```bash
# Verify all chains working
for chain in konzum lidl plodine interspar studenac kaufland eurospin dm ktc metro trgocentar; do
    curl -X POST "http://localhost:3003/internal/admin/ingest/$chain"
done

# Remove TypeScript scrapers (keeping only types if needed by other code)
rm src/ingestion/chains/*.ts
rm src/ingestion/parsers/*.ts
rm -rf src/ingestion/core/
rm -rf src/ingestion/ingesters/
rm -rf src/ingestion/loaders/
rm -rf src/ingestion/__tests__/
```

---

## Verification Summary

Each phase should be verified before proceeding:

1. **Phase 1-3**: Foundation works, DB connects, parsers handle encodings
2. **Phase 4**: Base adapters provide common functionality
3. **Phase 5**: First chain (Konzum) ingests successfully
4. **Phase 6**: ZIP expansion works, multiple GTINs split correctly
5. **Phase 7-8**: XML/XLSX parsers handle their formats
6. **Phase 9**: All 11 chains implemented and tested
7. **Phase 10**: Archive tracking functional
8. **Phase 11**: CLI commands work
9. **Phase 12**: Tests pass with good coverage
10. **Phase 13**: Documentation complete, Docker image builds

**Success Criteria:**
- All 11 chains ingest successfully via HTTP endpoints
- Data matches TypeScript implementation in database
- All Croatian fields (unitPrice, lowestPrice30d, anchorPrice) persisted correctly
- Rate limiting prevents server overload
- Archive tracking enables deduplication
