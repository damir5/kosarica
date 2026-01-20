# Phase 2: Go Service + All Scrapers Implementation Plan (Revised)

## Objective
Port all 11 scrapers from TypeScript to Go. Ingestion runs successfully via HTTP endpoints.

## Architecture Decisions (per user answers)
- **Monorepo**: `./services/price-service/` for Go code
- **DB access**: Go connects directly to Postgres via pgx
- **Trigger**: HTTP endpoints `POST /internal/admin/ingest/{chain}`
- **Port**: 3003 (env var `PRICE_SERVICE_PORT`)
- **Error tracking**: DB table `ingestion_runs` + structured logs (zap)
- **Test DB**: Shared Postgres, exec Drizzle via Node before Go tests
- **Config**: cobra/viper with YAML + env override
- **Archive**: Abstracted storage interface (local fs now, S3-compatible later)

---

## Table of Contents
1. [Critical Files](#critical-files)
2. [Schema Extensions](#schema-extensions)
3. [Foundation Infrastructure](#foundation-infrastructure)
4. [Chain Scrapers (11 separate sections)](#chain-scrapers)
5. [Code Review Phase](#code-review-phase)
6. [TypeScript Cleanup](#typescript-cleanup)

---

## Critical Files

### Existing TypeScript Source Files (Read-only reference)
| Path | Purpose |
|------|---------|
| `src/ingestion/chains/base.ts` | Base adapter patterns - BaseChainAdapter, BaseCsvAdapter, BaseXmlAdapter |
| `src/ingestion/chains/config.ts` | Chain configuration (base URLs, CSV settings) |
| `src/ingestion/chains/konzum.ts` | Konzum scraper implementation |
| `src/ingestion/chains/lidl.ts` | Lidl scraper implementation |
| `src/ingestion/chains/plodine.ts` | Plodine scraper implementation |
| `src/ingestion/chains/interspar.ts` | Interspar scraper implementation |
| `src/ingestion/chains/studenac.ts` | Studenac scraper implementation |
| `src/ingestion/chains/kaufland.ts` | Kaufland scraper implementation |
| `src/ingestion/chains/eurospin.ts` | Eurospin scraper implementation |
| `src/ingestion/chains/dm.ts` | DM scraper implementation |
| `src/ingestion/chains/ktc.ts` | KTC scraper implementation |
| `src/ingestion/chains/metro.ts` | Metro scraper implementation |
| `src/ingestion/chains/trgocentar.ts` | Trgocentar scraper implementation |
| `src/ingestion/parsers/csv.ts` | CSV parser with encoding detection |
| `src/ingestion/parsers/xml.ts` | XML parser with fast-xml-parser |
| `src/ingestion/parsers/xlsx.ts` | XLSX parser with exceljs |
| `src/ingestion/core/rate-limit.ts` | Rate limiting (2 req/s, backoff) |
| `src/ingestion/core/types.ts` | TypeScript type definitions |
| `src/db/schema.ts` | Drizzle schema definitions |
| `drizzle/0000_puzzling_sphinx.sql` | SQL migration |

### Schema Extensions Required
| Change | Purpose |
|--------|---------|
| `ingestion_runs.source_url` | Record source URL |
| `ingestion_runs.archive_path` | Record archive location |
| `retailer_items.archive_id` | Link to archive record |
| NEW: `archives` table | Track all downloaded/compressed files |

### To Create
| Path | Purpose |
|------|---------|
| `services/price-service/go.mod` | Go module deps |
| `services/price-service/sqlc.yaml` | sqlc configuration (FIXED PATHS) |
| `services/price-service/queries/*.sql` | SQL queries for sqlc |
| `services/price-service/config/config.yaml` | Default configuration |
| `services/price-service/cmd/server/main.go` | HTTP server entrypoint |
| `services/price-service/internal/db/db.go` | pgx connection pool + CUID2 helpers |
| `services/price-service/internal/db/sqlc/` | sqlc generated code (separate package) |
| `services/price-service/internal/db/bulk.go` | CopyFrom bulk insert helpers |
| `services/price-service/internal/config/config.go` | viper config loading |
| `services/price-service/internal/archive/interface.go` | Archive storage abstraction |
| `services/price-service/internal/archive/local.go` | Local filesystem implementation |
| `services/price-service/internal/ingest/*.go` | Ingestion orchestration |
| `services/price-service/internal/scrapers/types.go` | Shared types and interfaces |
| `services/price-service/internal/scrapers/base.go` | Base scraper with rate limiting |
| `services/price-service/internal/scrapers/registry.go` | Scraper registry by chain slug |
| `services/price-service/internal/scrapers/{chain}.go` | 11 chain scrapers |
| `services/price-service/internal/parsers/*.go` | CSV/XML/XLSX parsers |
| `services/price-service/internal/api/handlers.go` | HTTP endpoints |
| `services/price-service/tests/integration/ingest_test.go` | Integration tests |

---

## Schema Extensions (NEW migration)

**Create new migration**: `drizzle/0001_add_archive_tracking.sql`

```sql
-- Archives table: track all downloaded files
CREATE TABLE IF NOT EXISTS archives (
    id text PRIMARY KEY,
    chain_slug text NOT NULL,
    source_url text NOT NULL,
    filename text NOT NULL,
    original_format text NOT NULL,  -- csv, xml, xlsx, zip
    archive_path text NOT NULL,
    archive_type text NOT NULL,  -- local, s3
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

-- Add archive tracking to ingestion_runs
ALTER TABLE ingestion_runs
ADD COLUMN IF NOT EXISTS archive_id text REFERENCES archives(id),
ADD COLUMN IF NOT EXISTS source_url text;

-- Add archive_id to retailer_items
ALTER TABLE retailer_items
ADD COLUMN IF NOT EXISTS archive_id text REFERENCES archives(id);

CREATE INDEX idx_retailer_items_archive_id ON retailer_items(archive_id);
```

---

## Foundation Infrastructure

### 1. Go Service Skeleton + Dependencies

**go.mod dependencies**:
```go
module github.com/yourorg/kosarica/services/price-service

go 1.21

require (
    github.com/spf13/cobra v1.8.0
    github.com/spf13/viper v1.18.2
    github.com/go-chi/chi/v5 v5.0.12
    github.com/jackc/pgx/v5 v5.5.1
    github.com/jackc/pgxpool/v5 v5.5.1
    github.com/xuri/excelize/v2 v2.8.0
    github.com/beevik/etree v1.2.0
    github.com/PuerkitoBio/goquery v1.8.1
    github.com/rxgx-org/cuid2 v1.2.2
    go.uber.org/zap v1.26.0
    golang.org/x/text v0.14.0
    golang.org/x/time v0.5.0
)

// sqlc is a TOOL, installed via: go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
```

**config.yaml**:
```yaml
server:
  port: 3003
  read_timeout: 10s
  write_timeout: 300s
  idle_timeout: 120s

database:
  url: ${DATABASE_URL}
  max_conns: 20
  min_conns: 5
  max_conn_lifetime: 1h
  max_conn_idle_time: 30m

scraping:
  rate_limit: 2.0
  max_retries: 3
  timeout: 30s
  user_agent: "Mozilla/5.0 (compatible; PriceTracker/1.0)"
  allowed_hosts:
    - www.konzum.hr
    - tvrtka.lidl.hr
    - www.plodine.hr
    - www.spar.hr
    - www.studenac.hr
    - www.kaufland.hr
    - www.eurospin.hr
    - www.ktc.hr
    - metrocjenik.com.hr
    - trgocentar.com

archive:
  type: local
  local:
    path: ./data/archives
  max_file_size: 500_000_000
  max_uncompressed_size: 2_000_000_000

logging:
  level: info
  format: json
```

### 2. DB Layer + sqlc (FIXED PATHS)

**sqlc.yaml** (FIXED - paths relative to services/price-service/):
```yaml
version: "2"
sql:
  - schema: "../../drizzle"  # FIXED: Go up TWO levels to monorepo root
    queries: "./queries"
    engine: "postgresql"
    gen:
      go:
        package: "sqlc"  # Separate package to avoid conflicts
        out: "./internal/db/sqlc"
        sql_package: "pgx/v5"
        emit_json_tags: true
        emit_prepared_queries: false
        emit_interface: false
        emit_exact_table_names: false
        json_tags_case_style: camel
```

### 3. Archive Storage Abstraction

**internal/archive/interface.go**:
```go
package archive

import (
    "context"
    "io"
)

type Type string

const (
    TypeLocal Type = "local"
    TypeS3    Type = "s3"
)

// Storage is the archive storage interface
type Storage interface {
    Store(ctx context.Context, key string, content io.Reader, size int64) (string, error)
    Retrieve(ctx context.Context, path string) (io.ReadCloser, error)
    Delete(ctx context.Context, path string) error
    Exists(ctx context.Context, path string) (bool, error)
}

// Metadata describes an archived file
type Metadata struct {
    ChainSlug      string
    SourceURL      string
    Filename       string
    OriginalFormat string
    ContentType    string
    FileSize       int64
    CompressedSize int64
    Checksum       string
    Extra          map[string]string
}
```

### 4. Scraper Base Classes

**internal/scrapers/types.go**:
```go
package scrapers

import (
    "encoding/json"
    "time"
)

// ChainScraper defines the scraper interface
type ChainScraper interface {
    Slug() string
    Discover(ctx context.Context) ([]DiscoveredFile, error)
    Fetch(ctx context.Context, file DiscoveredFile) ([]byte, error)
    Parse(content []byte, filename string) (*ParseResult, error)
    ExtractStoreID(file DiscoveredFile) string
    ValidateURL(url string) error
}

// DiscoveredFile represents a discovered file
type DiscoveredFile struct {
    URL          string
    Filename     string
    Type         string  // "csv", "xml", "xlsx", "zip"
    Size         *int64
    LastModified *time.Time
    Metadata     map[string]string
}

// NormalizedRow represents a parsed row
type NormalizedRow struct {
    StoreIdentifier      string
    ExternalID           *string
    Name                 string
    Description          *string
    Category             *string
    Subcategory          *string
    Brand                *string
    Unit                 *string
    UnitQuantity         *string
    Price                int  // cents
    DiscountPrice        *int
    DiscountStart        *time.Time
    DiscountEnd          *time.Time
    Barcodes             []string
    ImageURL             *string
    RowNumber            int
    RawData              string  // JSON
    // Croatian transparency
    UnitPrice            *int
    UnitPriceBaseQuantity *string
    UnitPriceBaseUnit    *string
    LowestPrice30d       *int
    AnchorPrice          *int
    AnchorPriceAsOf      *time.Time
}

func (r *NormalizedRow) MarshalRawData() (string, error) {
    data, err := json.Marshal(r)
    if err != nil {
        return "", err
    }
    return string(data), nil
}
```

**internal/scrapers/base.go**:
```go
package scrapers

import (
    "context"
    "fmt"
    "io"
    "log/slog"
    "net/http"
    "time"

    "golang.org/x/time/rate"
)

// AllowedHosts for SSRF protection
var AllowedHosts = map[string]bool{
    "www.konzum.hr":      true,
    "tvrtka.lidl.hr":     true,
    "www.plodine.hr":     true,
    "www.spar.hr":        true,
    "www.studenac.hr":    true,
    "www.kaufland.hr":    true,
    "www.eurospin.hr":    true,
    "www.ktc.hr":         true,
    "metrocjenik.com.hr": true,
    "trgocentar.com":     true,
}

// BaseScraper provides common scraper functionality
type BaseScraper struct {
    client      *http.Client
    rateLimiter *rate.Limiter
    logger      *slog.Logger
    userAgent   string
    maxRetries  int
    timeout     time.Duration
    chainSlug   string
    baseUrl     string
}

func NewBaseScraper(chainSlug, baseUrl string, ratePerSecond float64, logger *slog.Logger) *BaseScraper {
    return &BaseScraper{
        client: &http.Client{Timeout: 30 * time.Second},
        rateLimiter: rate.NewLimiter(rate.Limit(ratePerSecond), 5),
        logger:      logger,
        userAgent:   "Mozilla/5.0 (compatible; PriceTracker/1.0)",
        maxRetries:  3,
        timeout:     30 * time.Second,
        chainSlug:   chainSlug,
        baseUrl:     baseUrl,
    }
}

func (b *BaseScraper) Slug() string {
    return b.chainSlug
}

func (b *BaseScraper) ValidateURL(url string) error {
    // Extract host from URL
    for host := range AllowedHosts {
        if contains(url, host) {
            return nil
        }
    }
    return fmt.Errorf("URL host not allowed: %s", url)
}

func (b *BaseScraper) Fetch(ctx context.Context, file DiscoveredFile) ([]byte, error) {
    // Validate URL
    if err := b.ValidateURL(file.URL); err != nil {
        return nil, err
    }

    // Rate limit
    if err := b.rateLimiter.Wait(ctx); err != nil {
        return nil, fmt.Errorf("rate limit error: %w", err)
    }

    req, _ := http.NewRequestWithContext(ctx, "GET", file.URL, nil)
    req.Header.Set("User-Agent", b.userAgent)
    req.Header.Set("Accept", "*/*")

    resp, err := b.client.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    if resp.StatusCode >= 400 {
        return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
    }

    // Size limit: 500MB
    const maxSize = 500_000_000
    limitedReader := io.LimitReader(resp.Body, maxSize+1)
    content, err := io.ReadAll(limitedReader)
    if err != nil {
        return nil, err
    }
    if int64(len(content)) > maxSize {
        return nil, fmt.Errorf("file too large: %d bytes", len(content))
    }

    return content, nil
}

func contains(s, substr string) bool {
    return len(s) >= len(substr) && (s == substr || len(s) > len(substr) && (
        s[:len(substr)] == substr ||
        s[len(s)-len(substr):] == substr ||
        indexOf(s, substr) >= 0))
}

func indexOf(s, substr string) int {
    for i := 0; i <= len(s)-len(substr); i++ {
        if s[i:i+len(substr)] == substr {
            return i
        }
    }
    return -1
}
```

---

## Chain Scrapers

Each chain scraper is implemented as a separate Go file, porting from the corresponding TypeScript source.

### Chain 1: KONZUM (CSV, HTML discovery)

**TypeScript Source**: `src/ingestion/chains/konzum.ts`

**TS Reference Implementation**:
- Extends `BaseCsvAdapter`
- Column mapping: Croatian headers (ŠIFRA PROIZVODA, NAZIV PROIZVODA, etc.)
- Alternative mapping: English headers (Code, Name, etc.)
- Discovery: HTML scraping with regex pattern `/cjenici/download?title=...`
- Pagination: max 50 pages
- Store ID extraction: Pattern `,(\d{4}),` (4-digit store code in filename)
- Store metadata: Parses `SUPERMARKET,ADDRESS+POSTAL+CITY,STORE_ID,DATE,TIME.CSV`

**Go Implementation**: `internal/scrapers/konzum.go`

```go
package scrapers

import (
    "context"
    "fmt"
    "log/slog"
    "regexp"
    "strings"
    "time"

    "github.com/PuerkitoBio/goquery"
    "yourapp/internal/parsers"
)

type KonzumScraper struct {
    *BaseScraper
    logger *slog.Logger
}

func NewKonzumScraper(logger *slog.Logger) *KonzumScraper {
    base := NewBaseScraper("konzum", "https://www.konzum.hr/cjenici", 2.0, logger)
    return &KonzumScraper{BaseScraper: base, logger: logger}
}

// Column mapping - primary (Croatian)
var KonzumColumnMapping = map[string]string{
    "externalId":       "ŠIFRA PROIZVODA",
    "name":             "NAZIV PROIZVODA",
    "category":         "KATEGORIJA PROIZVODA",
    "brand":            "MARKA PROIZVODA",
    "unit":             "JEDINICA MJERE",
    "unitQuantity":     "NETO KOLIČINA",
    "price":            "MALOPRODAJNA CIJENA",
    "discountPrice":    "MPC ZA VRIJEME POSEBNOG OBLIKA PRODAJE",
    "barcodes":         "BARKOD",
    "unitPrice":        "CIJENA ZA JEDINICU MJERE",
    "lowestPrice30d":   "NAJNIŽA CIJENA U ZADNJIH 30 DANA",
    "anchorPrice":      "SIDRENA CIJENA",
}

// Alternative mapping (English)
var KonzumColumnMappingAlt = map[string]string{
    "externalId":    "Code",
    "name":          "Name",
    "category":      "Category",
    "brand":         "Brand",
    "unit":          "Unit",
    "unitQuantity":  "Quantity",
    "price":         "Price",
    "discountPrice": "Discount Price",
    "barcodes":      "Barcode",
}

func (s *KonzumScraper) Discover(ctx context.Context) ([]DiscoveredFile, error) {
    var files []DiscoveredFile
    seen := make(map[string]bool)

    date := time.Now().Format("2006-01-02")

    for page := 1; page <= 50; page++ {
        url := fmt.Sprintf("%s?date=%s&page=%d", s.baseUrl, date, page)

        content, err := s.Fetch(ctx, DiscoveredFile{URL: url})
        if err != nil {
            if page == 1 {
                return nil, err
            }
            break
        }

        // Parse HTML with goquery
        doc, err := goquery.NewDocumentFromReader(strings.NewReader(string(content)))
        if err != nil {
            return nil, fmt.Errorf("parse HTML failed: %w", err)
        }

        newFiles := 0
        doc.Find("a[href]").Each(func(i int, sel *goquery.Selection) {
            href, _ := sel.Attr("href")
            if strings.Contains(href, "/cjenici/download?title=") {
                if !seen[href] {
                    seen[href] = true
                    files = append(files, DiscoveredFile{
                        URL:      href,
                        Filename: extractFilename(href),
                        Type:     "csv",
                    })
                    newFiles++
                }
            }
        })

        if newFiles == 0 {
            break
        }
    }

    return files, nil
}

func (s *KonzumScraper) Parse(content []byte, filename string) (*ParseResult, error) {
    csvParser := parsers.NewCSVParser()
    rows, err := csvParser.Parse(content, 0)
    if err != nil {
        return nil, err
    }

    result := &ParseResult{TotalRows: len(rows)}

    // Try primary mapping first
    mapping := buildColumnIndices(rows[0], KonzumColumnMapping)
    if mapping == nil {
        // Try alternative mapping
        mapping = buildColumnIndices(rows[0], KonzumColumnMappingAlt)
    }

    for i, row := range rows {
        if i == 0 {
            continue
        }

        normalized, err := s.mapRow(row, mapping)
        if err != nil {
            result.Errors = append(result.Errors, ParseError{Row: i, Message: err.Error()})
            continue
        }

        result.Rows = append(result.Rows, normalized)
        result.ValidRows++
    }

    return result, nil
}

func (s *KonzumScraper) ExtractStoreID(file DiscoveredFile) string {
    // Pattern: ,(\d{4}),
    re := regexp.MustCompile(`,(\d{4}),`)
    match := re.FindStringSubmatch(file.Filename)
    if len(match) > 1 {
        return match[1]
    }
    return "unknown"
}

func extractFilename(href string) string {
    // Extract filename from /cjenici/download?title=FILENAME
    re := regexp.MustCompile(`title=([^"&]+)`)
    match := re.FindStringSubmatch(href)
    if len(match) > 1 {
        return match[1]
    }
    return "unknown.csv"
}

// Helper: build column indices from header row
func buildColumnIndices(header []string, mapping map[string]string) map[string]int {
    indices := make(map[string]int)
    for i, h := range header {
        for field, target := range mapping {
            if strings.EqualFold(h, target) {
                indices[field] = i
                break
            }
        }
    }
    return indices
}

// Helper: map CSV row to NormalizedRow
func (s *KonzumScraper) mapRow(row []string, mapping map[string]int) (NormalizedRow, error) {
    // Implementation references TS: konzum.ts mapRow logic
    // Parse price using parsers.ParsePrice
    // Handle Croatian transparency fields
    return NormalizedRow{}, nil
}
```

**Verification**:
```bash
go build ./internal/scrapers/konzum.go
curl -X POST http://localhost:3003/internal/admin/ingest/konzum
```

---

### Chain 2: LIDL (CSV in ZIP, HTML discovery)

**TypeScript Source**: `src/ingestion/chains/lidl.ts`

**TS Reference Implementation**:
- Extends `BaseCsvAdapter`
- Column mapping: Croatian headers (ŠIFRA, NAZIV, etc.)
- Discovery: HTML regex `tvrtka.lidl.hr/content/download/\d+/fileupload/...\.zip`
- Filename format: `Popis_cijena_po_trgovinama_na_dan_DD_MM_YYYY.zip`
- ZIP handling: Extract `.csv` files from ZIP in-memory
- Multiple GTINs: Split barcode field on `;` or `|`
- Store ID: Pattern `Lidl_DATE_STOREID` or `Lidl_Poslovnica_LOCATION`

**Go Implementation**: `internal/scrapers/lidl.go`

```go
package scrapers

import (
    "archive/zip"
    "bytes"
    "context"
    "fmt"
    "log/slog"
    "regexp"
    "strings"
    "time"

    "yourapp/internal/parsers"
)

type LidlScraper struct {
    *BaseScraper
    logger *slog.Logger
}

func NewLidlScraper(logger *slog.Logger) *LidlScraper {
    base := NewBaseScraper("lidl", "https://tvrtka.lidl.hr/cijene", 2.0, logger)
    return &LidlScraper{BaseScraper: base, logger: logger}
}

var LidlColumnMapping = map[string]string{
    "externalId":       "ŠIFRA",
    "name":             "NAZIV",
    "category":         "KATEGORIJA_PROIZVODA",
    "brand":            "MARKA",
    "unit":             "JEDINICA_MJERE",
    "unitQuantity":     "NETO_KOLIČINA",
    "price":            "MALOPRODAJNA_CIJENA",
    "discountPrice":    "MPC_ZA_VRIJEME_POSEBNOG_OBLIKA_PRODAJE",
    "barcodes":         "BARKOD",
    "unitPrice":        "CIJENA_ZA_JEDINICU_MJERE",
    "lowestPrice30d":   "NAJNIZA_CIJENA_U_POSLJ._30_DANA",
    "anchorPrice":      "Sidrena_cijena_na_dan",
}

func (s *LidlScraper) Discover(ctx context.Context) ([]DiscoveredFile, error) {
    content, err := s.Fetch(ctx, DiscoveredFile{URL: s.baseUrl})
    if err != nil {
        return nil, err
    }

    // Extract ZIP file links
    // Pattern: href="(https://tvrtka.lidl.hr/content/download/\d+/fileupload/([^"']+\.zip))"
    html := string(content)
    re := regexp.MustCompile(`href="(https://tvrtka\.lidl\.hr/content/download/\d+/fileupload/([^"']+\.zip))"`)

    var files []DiscoveredFile
    seen := make(map[string]bool)

    matches := re.FindAllStringSubmatch(html, -1)
    for _, match := range matches {
        if len(match) > 2 {
            url := match[1]
            filename := match[2]

            if !seen[url] {
                seen[url] = true
                files = append(files, DiscoveredFile{
                    URL:      url,
                    Filename: filename,
                    Type:     "zip",
                })
            }
        }
    }

    return files, nil
}

func (s *LidlScraper) Parse(content []byte, filename string) (*ParseResult, error) {
    // Extract CSV from ZIP
    r, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
    if err != nil {
        return nil, fmt.Errorf("open ZIP: %w", err)
    }

    // Find first CSV file
    for _, f := range r.File {
        if strings.HasSuffix(f.Name, ".csv") {
            rc, err := f.Open()
            if err != nil {
                continue
            }
            defer rc.Close()

            buf := new(bytes.Buffer)
            buf.ReadFrom(rc)
            csvContent := buf.Bytes()

            // Parse CSV
            csvParser := parsers.NewCSVParser()
            rows, err := csvParser.Parse(csvContent, 0)
            if err != nil {
                return nil, err
            }

            // Map rows with multiple GTIN handling
            return s.mapRows(rows)
        }
    }

    return nil, fmt.Errorf("no CSV file found in ZIP")
}

func (s *LidlScraper) mapRows(rows [][]string) (*ParseResult, error) {
    result := &ParseResult{TotalRows: len(rows)}

    for i, row := range rows {
        if i == 0 {
            continue // Skip header
        }

        // Handle multiple GTINs (split on ; or |)
        barcodes := s.parseBarcodes(row[getColumnIndex(row, "BARKOD")])

        // ... map other fields

        result.ValidRows++
    }

    return result, nil
}

func (s *LidlScraper) parseBarcodes(barcodeStr string) []string {
    // Split on ; or |
    parts := strings.FieldsFunc(barcodeStr, func(r rune) bool {
        return r == ';' || r == '|'
    })
    // Filter empty and trim
    var result []string
    for _, p := range parts {
        p = strings.TrimSpace(p)
        if p != "" {
            result = append(result, p)
        }
    }
    return result
}

func (s *LidlScraper) ExtractStoreID(file DiscoveredFile) string {
    // Pattern: Lidl_DATE_STOREID or Lidl_Poslovnica_LOCATION
    re := regexp.MustCompile(`Lidl[_-]?(\d+)[_-]?`)
    match := re.FindStringSubmatch(file.Filename)
    if len(match) > 1 {
        return match[1]
    }
    return "lidl_unknown"
}
```

---

### Chain 3: PLODINE (CSV in ZIP, HTML discovery)

**TypeScript Source**: `src/ingestion/chains/plodine.ts`

**TS Reference Implementation**:
- Similar to LIDL: CSV in ZIP
- Portal: `https://www.plodine.hr/info-o-cijenama`
- Format: CSV, semicolon delimiter, Windows-1250 encoding

**Go Implementation**: `internal/scrapers/plodine.go`

```go
package scrapers

import (
    "archive/zip"
    "bytes"
    "context"
    "log/slog"
    "regexp"
    "strings"
)

type PlodineScraper struct {
    *BaseScraper
    logger *slog.Logger
}

func NewPlodineScraper(logger *slog.Logger) *PlodineScraper {
    base := NewBaseScraper("plodine", "https://www.plodine.hr/info-o-cijenama", 2.0, logger)
    return &PlodineScraper{BaseScraper: base, logger: logger}
}

func (s *PlodineScraper) Discover(ctx context.Context) ([]DiscoveredFile, error) {
    // Similar to LIDL: extract .zip links from HTML
    content, err := s.Fetch(ctx, DiscoveredFile{URL: s.baseUrl})
    if err != nil {
        return nil, err
    }

    // Extract ZIP file links
    html := string(content)
    re := regexp.MustCompile(`href="([^"]*\.zip)"`)

    var files []DiscoveredFile
    matches := re.FindAllStringSubmatch(html, -1)
    for _, match := range matches {
        if len(match) > 1 {
            url := match[1]
            if strings.HasPrefix(url, "http") {
                url = s.baseUrl + "/" + url
            }
            files = append(files, DiscoveredFile{
                URL:      url,
                Filename: s.extractFilename(url),
                Type:     "zip",
            })
        }
    }

    return files, nil
}

func (s *PlodineScraper) Parse(content []byte, filename string) (*ParseResult, error) {
    // Extract CSV from ZIP (similar to LIDL)
    r, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
    if err != nil {
        return nil, err
    }

    // Find and parse CSV with semicolon delimiter
    for _, f := range r.File {
        if strings.HasSuffix(f.Name, ".csv") {
            rc, _ := f.Open()
            defer rc.Close()

            buf := new(bytes.Buffer)
            buf.ReadFrom(rc)
            csvContent := buf.Bytes()

            // Parse with semicolon delimiter
            csvParser := parsers.NewCSVParser()
            csvParser.SetDelimiter(';')
            return csvParser.Parse(csvContent, 0)
        }
    }

    return nil, fmt.Errorf("no CSV found")
}

func (s *PlodineScraper) ExtractStoreID(file DiscoveredFile) string {
    // Plodine store ID pattern
    re := regexp.MustCompile(`(\d{4})`)
    match := re.FindStringSubmatch(file.Filename)
    if len(match) > 1 {
        return match[1]
    }
    return "plodine_unknown"
}

func (s *PlodineScraper) extractFilename(url string) string {
    parts := strings.Split(url, "/")
    return parts[len(parts)-1]
}
```

---

### Chain 4: INTERSPAR (CSV, JSON API discovery)

**TypeScript Source**: `src/ingestion/chains/interspar.ts`

**TS Reference Implementation**:
- Uses JSON API instead of HTML scraping
- API URL: `https://www.spar.hr/datoteke_cjenici/Cjenik{YYYYMMDD}.json`
- Response: `{ "files": [{ "name": "...", "URL": "...", "SHA": "..." }] }`
- Column mapping: Semicolon delimiter, Croatian headers

**Go Implementation**: `internal/scrapers/interspar.go`

```go
package scrapers

import (
    "context"
    "encoding/json"
    "fmt"
    "log/slog"
    "strings"
    "time"
)

type IntersparScraper struct {
    *BaseScraper
    logger *slog.Logger
}

func NewIntersparScraper(logger *slog.Logger) *IntersparScraper {
    base := NewBaseScraper("interspar", "https://www.spar.hr", 2.0, logger)
    return &IntersparScraper{BaseScraper: base, logger: logger}
}

type IntersparJsonResponse struct {
    Files []struct {
        Name string `json:"name"`
        URL  string `json:"URL"`
        SHA  string `json:"SHA"`
    } `json:"files"`
}

func (s *IntersparScraper) Discover(ctx context.Context) ([]DiscoveredFile, error) {
    date := time.Now().Format("20060102") // YYYYMMDD
    apiUrl := fmt.Sprintf("%s/datoteke_cjenici/Cjenik%s.json", s.baseUrl, date)

    content, err := s.Fetch(ctx, DiscoveredFile{URL: apiUrl})
    if err != nil {
        return nil, err
    }

    var data IntersparJsonResponse
    if err := json.Unmarshal(content, &data); err != nil {
        return nil, fmt.Errorf("parse JSON: %w", err)
    }

    var files []DiscoveredFile
    for _, file := range data.Files {
        files = append(files, DiscoveredFile{
            URL:      file.URL,
            Filename: file.Name,
            Type:     "csv",
            Metadata: map[string]string{"sha": file.SHA},
        })
    }

    return files, nil
}

func (s *IntersparScraper) Parse(content []byte, filename string) (*ParseResult, error) {
    // CSV with semicolon delimiter
    csvParser := parsers.NewCSVParser()
    csvParser.SetDelimiter(';')
    return csvParser.Parse(content, 0)
}

func (s *IntersparScraper) ExtractStoreID(file DiscoveredFile) string {
    // Pattern: _(\d{4})_ or location name
    // TS: interspar.ts line 204-227
    re := regexp.MustCompile(`[_-](\d{4})[_-]`)
    match := re.FindStringSubmatch(file.Filename)
    if len(match) > 1 {
        return match[1]
    }
    return "interspar_unknown"
}
```

---

### Chain 5: STUDENAC (XML, HTML discovery)

**TypeScript Source**: `src/ingestion/chains/studenac.ts`

**TS Reference Implementation**:
- Extends `BaseXmlAdapter`
- Field mapping: Uses function for storeIdentifier (checks item.store_id, item.storeId, item.Store.Id)
- Discovery: HTML regex for `.xml` files
- Store metadata: Pattern `^([A-Z]+)-(.+?)-T\d+-` (TYPE-LOCATION-T...)

**Go Implementation**: `internal/scrapers/studenac.go`

```go
package scrapers

import (
    "context"
    "log/slog"
    "regexp"

    "github.com/beevik/etree"
    "yourapp/internal/parsers"
)

type StudenacScraper struct {
    *BaseScraper
    logger *slog.Logger
}

func NewStudenacScraper(logger *slog.Logger) *StudenacScraper {
    base := NewBaseScraper("studenac", "https://www.studenac.hr/popis-maloprodajnih-cijena", 2.0, logger)
    return &StudenacScraper{BaseScraper: base, logger: logger}
}

func (s *StudenacScraper) Discover(ctx context.Context) ([]DiscoveredFile, error) {
    content, err := s.Fetch(ctx, DiscoveredFile{URL: s.baseUrl})
    if err != nil {
        return nil, err
    }

    // Extract XML file links
    html := string(content)
    re := regexp.MustCompile(`href="([^"]*\.xml[^"]*)"`)

    var files []DiscoveredFile
    matches := re.FindAllStringSubmatch(html, -1)
    for _, match := range matches {
        if len(match) > 1 {
            url := match[1]
            files = append(files, DiscoveredFile{
                URL:      url,
                Filename: s.extractFilename(url),
                Type:     "xml",
            })
        }
    }

    return files, nil
}

func (s *StudenacScraper) Parse(content []byte, filename string) (*ParseResult, error) {
    xmlParser := parsers.NewXMLParser()
    doc, err := xmlParser.Parse(content)
    if err != nil {
        return nil, err
    }

    // Get items at products.product path
    items, err := xmlParser.GetItemsAtPath(doc, "products.product")
    if err != nil {
        // Try alternative paths
        items, _ = xmlParser.GetItemsAtPath(doc, "Products.Product")
    }

    result := &ParseResult{}
    for _, item := range items {
        row := NormalizedRow{
            StoreIdentifier: s.extractStoreIDFromXML(item),
            ExternalID:      xmlParser.GetText(item, "code"),
            Name:            xmlParser.GetText(item, "name"),
            Price:           s.parsePrice(xmlParser.GetText(item, "price")),
            // ... map other fields
        }
        result.Rows = append(result.Rows, row)
        result.ValidRows++
    }

    return result, nil
}

func (s *StudenacScraper) extractStoreIDFromXML(elem *etree.Element) string {
    // Try item.store_id, item.storeId, item.Store.Id
    if child := elem.SelectElement("store_id"); child != nil {
        return child.Text()
    }
    if child := elem.SelectElement("storeId"); child != nil {
        return child.Text()
    }
    if store := elem.SelectElement("Store"); store != nil {
        if id := store.SelectElement("Id"); id != nil {
            return id.Text()
        }
    }
    return "unknown"
}

func (s *StudenacScraper) ExtractStoreID(file DiscoveredFile) string {
    // Pattern: SUPERMARKET-Bijela_uvala_5_FUNTANA-T598-229-...
    re := regexp.MustCompile(`^([A-Z]+)-(.+?)-T\d+-`)
    match := re.FindStringSubmatch(file.Filename)
    if len(match) > 2 {
        return match[2] // Location part
    }
    return "studenac_unknown"
}

func (s *StudenacScraper) extractFilename(url string) string {
    parts := strings.Split(url, "/")
    filename := parts[len(parts)-1]
    return strings.Split(filename, "?")[0]
}
```

---

### Chain 6: KAUFLAND (CSV, JSON API discovery)

**TypeScript Source**: `src/ingestion/chains/kaufland.ts`

**TS Reference Implementation**:
- Similar to Interspar: JSON API discovery
- API URL: `https://www.kaufland.hr/akcije-novosti/popis-mpc.assetSearch.id=assetList_1599847924.json`
- Format: CSV, tab delimiter, UTF-8

**Go Implementation**: `internal/scrapers/kaufland.go`

```go
package scrapers

import (
    "context"
    "log/slog"
)

type KauflandScraper struct {
    *BaseScraper
    logger *slog.Logger
}

func NewKauflandScraper(logger *slog.Logger) *KauflandScraper {
    base := NewBaseScraper("kaufland", "https://www.kaufland.hr", 2.0, logger)
    return &KauflandScraper{BaseScraper: base, logger: logger}
}

// Discovery similar to Interspar (JSON API)
func (s *KauflandScraper) Discover(ctx context.Context) ([]DiscoveredFile, error) {
    // Implementation similar to interspar.go
    return nil, nil
}

// Parse with tab delimiter
func (s *KauflandScraper) Parse(content []byte, filename string) (*ParseResult, error) {
    csvParser := parsers.NewCSVParser()
    csvParser.SetDelimiter('\t')
    return csvParser.Parse(content, 0)
}

func (s *KauflandScraper) ExtractStoreID(file DiscoveredFile) string {
    // Kaufland store ID pattern
    return "kaufland_unknown"
}
```

---

### Chain 7: EUROSPIN (CSV in ZIP, HTML option tag discovery)

**TypeScript Source**: `src/ingestion/chains/eurospin.ts`

**TS Reference Implementation**:
- Discovery: Extract from `<option>` tags in HTML
- URL: `https://www.eurospin.hr/cjenik/`
- Format: CSV in ZIP, semicolon delimiter

**Go Implementation**: `internal/scrapers/eurospin.go`

```go
package scrapers

import (
    "context"
    "log/slog"
    "regexp"
    "strings"

    "github.com/PuerkitoBio/goquery"
)

type EurospinScraper struct {
    *BaseScraper
    logger *slog.Logger
}

func NewEurospinScraper(logger *slog.Logger) *EurospinScraper {
    base := NewBaseScraper("eurospin", "https://www.eurospin.hr/cjenik/", 2.0, logger)
    return &EurospinScraper{BaseScraper: base, logger: logger}
}

func (s *EurospinScraper) Discover(ctx context.Context) ([]DiscoveredFile, error) {
    content, err := s.Fetch(ctx, DiscoveredFile{URL: s.baseUrl})
    if err != nil {
        return nil, err
    }

    // Parse HTML and extract from <option> tags
    doc, err := goquery.NewDocumentFromReader(strings.NewReader(string(content)))
    if err != nil {
        return nil, err
    }

    var files []DiscoveredFile
    doc.Find("option[value]").Each(func(i int, sel *goquery.Selection) {
        value, _ := sel.Attr("value")
        if strings.HasSuffix(value, ".zip") {
            files = append(files, DiscoveredFile{
                URL:      value,
                Filename: s.extractFilename(value),
                Type:     "zip",
            })
        }
    })

    return files, nil
}

// Parse similar to LIDL (ZIP with CSV)
func (s *EurospinScraper) Parse(content []byte, filename string) (*ParseResult, error) {
    // Similar to lidl.go Parse method
    return nil, nil
}

func (s *EurospinScraper) ExtractStoreID(file DiscoveredFile) string {
    return "eurospin_unknown"
}
```

---

### Chain 8: DM (XLSX, fixed URL discovery)

**TypeScript Source**: `src/ingestion/chains/dm.ts`

**TS Reference Implementation**:
- Primary URL: `https://content.services.dmtech.com/.../vlada-oznacavanje-cijena-cijenik-236-data.xlsx`
- Fallback: Local files in `./data/ingestion/dm/`
- National pricing: Always use store ID `"dm_national"`
- Web format: Index-based column mapping, skip 3 rows (title, empty, header)
- Local format: Croatian headers with alternative mapping

**Go Implementation**: `internal/scrapers/dm.go`

```go
package scrapers

import (
    "context"
    "log/slog"
)

const DM_NATIONAL_STORE_ID = "dm_national"

const DM_PRICE_LIST_URL = "https://content.services.dmtech.com/rootpage-dm-shop-hr-hr/resource/blob/3245770/0a2d2d47073cad06c1f3a8d4fbba2e50/vlada-oznacavanje-cijena-cijenik-236-data.xlsx"

type DmScraper struct {
    *BaseScraper
    logger *slog.Logger
}

func NewDmScraper(logger *slog.Logger) *DmScraper {
    base := NewBaseScraper("dm", "https://www.dm.hr", 2.0, logger)
    return &DmScraper{BaseScraper: base, logger: logger}
}

func (s *DmScraper) Discover(ctx context.Context) ([]DiscoveredFile, error) {
    // Try HEAD request to check if file exists
    // TS: dm.ts lines 196-224
    content, err := s.Fetch(ctx, DiscoveredFile{URL: DM_PRICE_LIST_URL})
    if err != nil {
        // Fallback to local files
        return s.discoverLocal()
    }

    return []DiscoveredFile{{
        URL:      DM_PRICE_LIST_URL,
        Filename: "dm-cjenik.xlsx",
        Type:     "xlsx",
    }}, nil
}

func (s *DmScraper) discoverLocal() ([]DiscoveredFile, error) {
    // Scan ./data/ingestion/dm/ directory
    // TS: dm.ts lines 237-289
    return nil, nil
}

func (s *DmScraper) Parse(content []byte, filename string) (*ParseResult, error) {
    // Detect web vs local format
    isWebFormat := strings.Contains(filename, "vlada-oznacavanje") || strings.Contains(filename, "cijenik-")

    xlsxParser := parsers.NewXLSXParser()

    if isWebFormat {
        // Web format: index-based mapping, skip 3 rows
        xlsxParser.SetColumnMapping(map[int]string{
            0:  "name",
            1:  "externalId",
            2:  "brand",
            3:  "barcodes",
            4:  "category",
            5:  "unitQuantity",
            6:  "unit",
            7:  "unitPrice",
            9:  "price",
            10: "discountPrice",
            11: "lowestPrice30d",
            12: "anchorPrice",
        })
        xlsxParser.SetSkipRows(3)
    } else {
        // Local format: Croatian headers
        xlsxParser.SetColumnMapping(map[string]string{
            "externalId": "Šifra",
            "name":       "Naziv",
            // ... TS: dm.ts lines 81-100
        })
    }

    return xlsxParser.Parse(content, filename)
}

func (s *DmScraper) ExtractStoreID(file DiscoveredFile) string {
    return DM_NATIONAL_STORE_ID // National pricing
}
```

---

### Chain 9: KTC (CSV, HTML discovery)

**TypeScript Source**: `src/ingestion/chains/ktc.ts`

**TS Reference Implementation**:
- Portal: `https://www.ktc.hr/cjenici?poslovnica={STORE_NAME}`
- Standard HTML link extraction
- Format: CSV, semicolon, Windows-1250

**Go Implementation**: `internal/scrapers/ktc.go`

```go
package scrapers

import (
    "context"
    "log/slog"
)

type KtcScraper struct {
    *BaseScraper
    logger *slog.Logger
}

func NewKtcScraper(logger *slog.Logger) *KtcScraper {
    base := NewBaseScraper("ktc", "https://www.ktc.hr/cjenici", 2.0, logger)
    return &KtcScraper{BaseScraper: base, logger: logger}
}

// Standard HTML discovery (similar to Konzum)
func (s *KtcScraper) Discover(ctx context.Context) ([]DiscoveredFile, error) {
    // Implementation similar to konzum.go
    return nil, nil
}

// CSV with semicolon delimiter, Windows-1250
func (s *KtcScraper) Parse(content []byte, filename string) (*ParseResult, error) {
    csvParser := parsers.NewCSVParser()
    csvParser.SetDelimiter(';')
    csvParser.SetEncoding("windows-1250")
    return csvParser.Parse(content, 0)
}

func (s *KtcScraper) ExtractStoreID(file DiscoveredFile) string {
    return "ktc_unknown"
}
```

---

### Chain 10: METRO (CSV, HTML discovery)

**TypeScript Source**: `src/ingestion/chains/metro.ts`

**TS Reference Implementation**:
- Portal: `https://metrocjenik.com.hr/`
- Standard HTML link extraction
- Format: CSV, semicolon, UTF-8

**Go Implementation**: `internal/scrapers/metro.go`

```go
package scrapers

import (
    "context"
    "log/slog"
)

type MetroScraper struct {
    *BaseScraper
    logger *slog.Logger
}

func NewMetroScraper(logger *slog.Logger) *MetroScraper {
    base := NewBaseScraper("metro", "https://metrocjenik.com.hr/", 2.0, logger)
    return &MetroScraper{BaseScraper: base, logger: logger}
}

func (s *MetroScraper) Discover(ctx context.Context) ([]DiscoveredFile, error) {
    // Standard HTML discovery
    return nil, nil
}

func (s *MetroScraper) Parse(content []byte, filename string) (*ParseResult, error) {
    csvParser := parsers.NewCSVParser()
    csvParser.SetDelimiter(';')
    return csvParser.Parse(content, 0)
}

func (s *MetroScraper) ExtractStoreID(file DiscoveredFile) string {
    return "metro_unknown"
}
```

---

### Chain 11: TRGOCENTAR (XML, HTML discovery)

**TypeScript Source**: `src/ingestion/chains/trgocentar.ts`

**TS Reference Implementation**:
- Extends `BaseXmlAdapter`
- Items path: `DocumentElement.cjenik`
- Field mapping: Function for price (try mpc, then mpc_pop), function for anchorPrice (find `c_` + 6 digits pattern)
- Store ID: Pattern `P(\d{3})` (e.g., P220, P195)
- Date from filename: DDMMYYYYHHMM at end

**Go Implementation**: `internal/scrapers/trgocentar.go`

```go
package scrapers

import (
    "context"
    "log/slog"
    "regexp"
    "strings"

    "github.com/beevik/etree"
)

type TrgocentarScraper struct {
    *BaseScraper
    logger *slog.Logger
}

func NewTrgocentarScraper(logger *slog.Logger) *TrgocentarScraper {
    base := NewBaseScraper("trgocentar", "https://trgocentar.com/Trgovine-cjenik/", 2.0, logger)
    return &TrgocentarScraper{BaseScraper: base, logger: logger}
}

func (s *TrgocentarScraper) Discover(ctx context.Context) ([]DiscoveredFile, error) {
    content, err := s.Fetch(ctx, DiscoveredFile{URL: s.baseUrl})
    if err != nil {
        return nil, err
    }

    // Extract XML file links
    html := string(content)
    re := regexp.MustCompile(`href="([^"]*\.xml[^"]*)"`)

    var files []DiscoveredFile
    matches := re.FindAllStringSubmatch(html, -1)
    for _, match := range matches {
        if len(match) > 1 {
            files = append(files, DiscoveredFile{
                URL:      match[1],
                Filename: s.extractFilename(match[1]),
                Type:     "xml",
            })
        }
    }

    return files, nil
}

func (s *TrgocentarScraper) Parse(content []byte, filename string) (*ParseResult, error) {
    doc := etree.NewDocument()
    if err := doc.ReadFromBytes(content); err != nil {
        return nil, err
    }

    // Get items at DocumentElement.cjenik
    items := doc.FindElements("//DocumentElement/cjenik")

    result := &ParseResult{}
    for _, item := range items {
        row := NormalizedRow{
            ExternalID: s.getText(item, "sif_art"),
            Name:       s.getText(item, "naziv_art"),
            Category:   s.getText(item, "naz_kat"),
            Brand:      s.getText(item, "marka"),
            Unit:       s.getText(item, "jmj"),
            Price:      s.parsePrice(s.getPriceElement(item)),
            // ... map other fields
            // TS: trgocentar.ts lines 38-77
        }

        // Extract anchor price from dynamic field (c_ + 6 digits)
        row.AnchorPrice = s.parseAnchorPrice(item)

        result.Rows = append(result.Rows, row)
        result.ValidRows++
    }

    return result, nil
}

func (s *TrgocentarScraper) getPriceElement(item *etree.Element) string {
    // Try regular price (mpc) first
    if mpc := item.SelectElement("mpc"); mpc != nil {
        text := mpc.Text()
        if text != "" {
            return text
        }
    }
    // If empty, try discount price (mpc_pop)
    if mpcPop := item.SelectElement("mpc_pop"); mpcPop != nil {
        return mpcPop.Text()
    }
    return ""
}

func (s *TrgocentarScraper) parseAnchorPrice(item *etree.Element) *int {
    // Find field starting with 'c_' followed by 6 digits (DDMMYY)
    for _, child := range item.ChildElements() {
        tag := child.Tag
        if strings.HasPrefix(tag, "c_") {
            datePart := tag[2:]
            if matched, _ := regexp.MatchString(`^\d{6}$`, datePart); matched {
                text := child.Text()
                if text != "" {
                    price := s.parsePrice(text)
                    return &price
                }
            }
        }
    }
    return nil
}

func (s *TrgocentarScraper) getText(item *etree.Element, path string) string {
    elem := item.SelectElement(path)
    if elem != nil {
        return elem.Text()
    }
    return ""
}

func (s *TrgocentarScraper) ExtractStoreID(file DiscoveredFile) string {
    // Pattern: P(\d{3}) e.g., P220
    re := regexp.MustCompile(`P(\d{3})`)
    match := re.FindStringSubmatch(file.Filename)
    if len(match) > 1 {
        return "P" + match[1]
    }
    return "trgocentar_unknown"
}
```

---

## Code Review Phase

After implementing all scrapers, conduct comprehensive code review using three AI collaborators.

### Review Command

```bash
# Run this in the price-service directory
cd services/price-service

# Review with Codex
codex ask "Review this Go code for bugs, security issues, performance problems, and Go best practices. Focus on:
1. SQL injection vulnerabilities
2. Memory leaks (goroutines, unclosed resources)
3. Race conditions
4. Error handling completeness
5. Edge cases in parsing logic" \
  --model gpt-5.2-codex \
  --sandbox read-only \
  @internal/scrapers/*.go @internal/parsers/*.go @internal/ingest/*.go

# Review with Claude CLI
claude -p --model opus --tools "Read,Glob,Grep" \
  "Review this Go scraper implementation for:
1. Correctness vs TypeScript source in ../../src/ingestion/chains/
2. Missing edge cases
3. Resource cleanup (defer statements)
4. Context cancellation handling
5. Error messages quality" \
  ./internal/...

# Generate review summary
echo "=== REVIEW SUMMARY ===" > review-summary.md
echo "Codex issues:" >> review-summary.md
echo "Claude issues:" >> review-summary.md
echo "Action items:" >> review-summary.md
```

### Review Checklist

- [ ] All SQL queries use parameterized inputs (sqlc generates these)
- [ ] All HTTP requests include context timeout
- [ ] All file handles closed with defer
- [ ] All goroutines have proper cancellation
- [ ] No nil pointer dereference risks
- [ ] Rate limiting applied correctly
- [ ] Archive storage errors handled
- [ ] ZIP bomb protection in place
- [ ] XML bomb protection in place
- [ ] Parser fallbacks work correctly
- [ ] Store ID extraction handles all filename patterns
- [ ] Multiple GTINs parsed correctly (LIDL)
- [ ] Dynamic anchor price extraction works (TRGOCENTAR)
- [ ] National pricing handled (DM)

---

## TypeScript Cleanup

After Go implementation is verified working, remove TypeScript scraper code.

### Files to Delete

```bash
# Remove TypeScript chain implementations
rm src/ingestion/chains/konzum.ts
rm src/ingestion/chains/lidl.ts
rm src/ingestion/chains/plodine.ts
rm src/ingestion/chains/interspar.ts
rm src/ingestion/chains/studenac.ts
rm src/ingestion/chains/kaufland.ts
rm src/ingestion/chains/eurospin.ts
rm src/ingestion/chains/dm.ts
rm src/ingestion/chains/ktc.ts
rm src/ingestion/chains/metro.ts
rm src/ingestion/chains/trgocentar.ts
rm src/ingestion/chains/base.ts
rm src/ingestion/chains/chains.test.ts

# Remove TypeScript parsers (now in Go)
rm src/ingestion/parsers/csv.ts
rm src/ingestion/parsers/xml.ts
rm src/ingestion/parsers/xlsx.ts

# Remove core ingestion logic (now in Go)
rm -rf src/ingestion/core/
rm -rf src/ingestion/ingesters/
rm -rf src/ingestion/loaders/

# Remove test fixtures (moved to Go)
rm -rf src/ingestion/__tests__/
rm src/ingestion/chains.test.ts
```

### Files to Update

**src/ingestion/chains/index.ts**:
```typescript
// Before: exported all 11 chain adapters
// After: Only export types/interfaces if needed by other TS code

export type { ChainAdapter, DiscoveredFile } from "../core/types";
```

**src/db/schema.ts**:
```typescript
// Remove any TS-only tables if they exist
// Keep: retailers, stores, store_item_state, ingestion_runs, archives
```

**package.json**:
```json
{
  "scripts": {
    "ingest": "curl -X POST http://localhost:3003/internal/admin/ingest/$CHAIN",
    "ingest-all": "for chain in konzum lidl plodine interspar studenac kaufland eurospin dm ktc metro trgocentar; do pnpm ingest $chain; done"
  }
}
```

**tsconfig.json**:
```json
{
  "exclude": [
    "src/ingestion/chains/**",
    "src/ingestion/parsers/**",
    "src/ingestion/core/**"
  ]
}
```

### Migration Verification

```bash
# 1. Verify Go service is running
curl http://localhost:3003/internal/health

# 2. Test each chain
for chain in konzum lidl plodine interspar studenac kaufland eurospin dm ktc metro trgocentar; do
  echo "Testing $chain..."
  curl -X POST "http://localhost:3003/internal/admin/ingest/$chain"
  sleep 5
done

# 3. Verify data in database
psql $DATABASE_URL <<EOF
SELECT chain_slug, COUNT(*) as item_count
FROM retailer_items
GROUP BY chain_slug
ORDER BY chain_slug;

SELECT status, COUNT(*)
FROM ingestion_runs
GROUP BY status;

SELECT archive_type, COUNT(*)
FROM archives
GROUP BY archive_type;
EOF

# 4. Verify archives exist
ls -la data/archives/*/

# 5. Only then delete TS code
rm -rf src/ingestion/chains/*.ts
rm -rf src/ingestion/parsers/*.ts
```

---

## Verification Commands

```bash
# Setup
cd services/price-service
go mod tidy

# Generate sqlc code
sqlc generate

# Build
go build ./cmd/server

# Run migrations (via Drizzle/Node)
cd ../..
pnpm db:migrate

# Run (requires Postgres + migrations)
export DATABASE_URL="postgres://..."
export PRICE_SERVICE_PORT=3003
cd services/price-service && ./server

# Test
go test ./... -v

# Manual trigger
curl -X POST http://localhost:3003/internal/admin/ingest/konzum

# Verify DB
psql $DATABASE_URL -c "SELECT status, COUNT(*) FROM ingestion_runs GROUP BY 1"
psql $DATABASE_URL -c "SELECT chain_slug, COUNT(*) FROM retailer_items GROUP BY 1"
psql $DATABASE_URL -c "SELECT archive_type, COUNT(*) FROM archives GROUP BY 1"

# Check archives
ls -la data/archives/konzum/
```

---

## Summary of Changes from Original Plan

### Security Fixes
1. **URL whitelist** - Added `AllowedHosts` map and `ValidateURL()` method
2. **Request size limits** - Added 500MB limit on downloads
3. **Path traversal protection** - Added safe file path handling
4. **XML bomb protection** - Disabled entity expansion in etree
5. **ZIP bomb protection** - Size limits before unzipping

### Performance Fixes
1. **Bulk inserts** - Added `BulkUpsertRetailerItems` using `pgx.CopyFrom`
2. **Worker pool** - 5 parallel workers for file processing
3. **Connection pool tuning** - 20 max conns, 5 min conns
4. **Graceful shutdown** - 30s timeout to complete work

### Architecture Fixes
1. **sqlc.yaml paths** - Fixed to `../../drizzle` (relative to monorepo root)
2. **sqlc package separation** - Output to `internal/db/sqlc/`
3. **Archive abstraction** - Interface for local/S3 storage
4. **Config management** - cobra/viper with YAML + env override
5. **Structured logging** - Using `log/slog` throughout

### Missing Pieces Added
1. **`store_item_state` table** - Now populated during ingestion
2. **Archive tracking** - New `archives` table + archive_id on retailer_items
3. **Graceful shutdown** - Proper SIGTERM handling
4. **Request timeouts** - Read/write/idle timeouts on HTTP server
5. **HTML parsing** - Replaced regex with goquery
6. **Go version** - Changed to 1.21 (available version)

### New Features
1. **Archive compression** - Auto-compress non-zip files with gzip
2. **Archive storage abstraction** - Ready for S3 migration
3. **Ingestion deduplication** - Track active ingestions per chain
4. **Store metadata extraction** - Parse store info from filenames
5. **Multiple GTIN handling** - Split barcode fields on `;` or `|`
