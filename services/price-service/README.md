# Price Service

Go service for ingesting and processing price data from Croatian retail chains. This service scrapes, parses, and stores pricing information from multiple retail sources, providing normalized data for price transparency applications.

## Overview

The Price Service is part of the Kosarica project - a price transparency platform for Croatian consumers. It automatically discovers, downloads, parses, and stores price data from 11 major Croatian retail chains:

- **Konzum** - CSV files with Croatian/English headers
- **Lidl** - ZIP archives containing per-store CSVs
- **Studenac** - XML format with dynamic store IDs
- **DM** - XLSX files with numeric column indices
- **Plodine** - CSV in ZIP archives
- **Interspar** - JSON API discovery with CSV data
- **Kaufland** - JSON API discovery with tab-delimited data
- **Eurospin** - HTML option tag discovery
- **KTC** - CSV with Windows-1250 encoding
- **Metro** - CSV with UTF-8 encoding
- **Trgocentar** - XML with dynamic anchor prices

## Features

- **Multi-format parsing**: CSV, XML, XLSX, and ZIP archives
- **Encoding detection**: Automatic Windows-1250 to UTF-8 conversion
- **Rate limiting**: Configurable request throttling with exponential backoff
- **Alternative mappings**: Fallback column mappings for varying data formats
- **Store auto-registration**: Extract store metadata from filenames
- **Croatian transparency fields**: Unit price, 30-day low, anchor price
- **Archive tracking**: Deduplication and historical analysis
- **HTTP API**: Trigger ingestion programmatically
- **CLI tool**: Manual operations and debugging

## Architecture

```
price-service/
├── cmd/
│   ├── server/          # HTTP server (port 3000)
│   └── cli/             # CLI tool
├── internal/
│   ├── adapters/        # Chain-specific adapters
│   │   ├── base/        # Base adapter classes
│   │   └── chains/      # 11 chain implementations
│   ├── database/        # PostgreSQL layer (pgx)
│   ├── handlers/        # HTTP handlers
│   ├── http/            # HTTP client + rate limiting
│   ├── parsers/         # CSV, XML, XLSX parsers
│   ├── pipeline/        # Discovery, fetch, parse, persist
│   ├── storage/         # Local/S3 storage abstraction
│   └── types/           # Core types
├── config/              # Configuration
├── deployment/          # Docker files
└── docs/                # Documentation
```

## Quick Start

### Prerequisites

- Go 1.25+
- PostgreSQL 14+
- Environment variables or config file

### Installation

```bash
cd services/price-service
go mod download
go build -o price-service ./cmd/server
```

### Configuration

Create a `config/config.yaml` file or set environment variables:

```yaml
server:
  port: 3000
  host: "0.0.0.0"

database:
  url: "postgres://user:pass@localhost:5432/kosarica"
  max_connections: 25
  min_connections: 5

rate_limit:
  requests_per_second: 2
  max_retries: 3
  initial_backoff_ms: 100
  max_backoff_ms: 30000

storage:
  type: "local"
  base_path: "./data/archives"

logging:
  level: "info"
  format: "json"
```

### Running the Server

```bash
export DATABASE_URL="postgres://user:pass@localhost:5432/kosarica"
./price-service
```

Server listens on `http://localhost:3000`

## API Endpoints

### Health Check

```bash
GET /health
```

Response:
```json
{
  "status": "ok",
  "database": "connected"
}
```

### Ingestion

Trigger ingestion for a specific chain:

```bash
POST /internal/admin/ingest/{chain}
```

Where `{chain}` is one of: `konzum`, `lidl`, `studenac`, `dm`, `plodine`, `interspar`, `kaufland`, `eurospin`, `ktc`, `metro`, `trgocentar`

### Ingestion Status

Check status of an ingestion run:

```bash
GET /internal/admin/ingest/status/{runId}
```

### List Ingestion Runs

List recent ingestion runs for a chain:

```bash
GET /internal/admin/ingest/runs/{chain}
```

## CLI Usage

Build the CLI:

```bash
go build -o price-service-cli ./cmd/cli
```

### Commands

```bash
# Ingest specific chain
price-service-cli ingest konzum --date 2026-01-19

# Ingest all chains
price-service-cli ingest --all

# Discover files (no ingestion)
price-service-cli discover lidl

# Parse local file
price-service-cli parse ~/sample.csv --chain konzum

# List chains
price-service-cli chains
```

## Data Model

The service normalizes all chain data into a standard format:

### NormalizedRow

```go
type NormalizedRow struct {
    StoreIdentifier      string     // Store ID
    ExternalID           *string    // Product code
    Name                 string     // Product name
    Description          *string
    Category             *string
    Brand                *string
    Unit                 *string
    Price                int        // Price in cents
    DiscountPrice        *int       // Discount price in cents
    DiscountStart        *time.Time
    DiscountEnd          *time.Time
    Barcodes             []string   // GTIN/EAN codes
    // Croatian transparency fields
    UnitPrice            *int       // Unit price in cents
    UnitPriceBaseQuantity *string
    UnitPriceBaseUnit    *string
    LowestPrice30d       *int       // Lowest price in 30 days
    AnchorPrice          *int       // Reference price
    AnchorPriceAsOf      *time.Time
}
```

## Development

### Running Tests

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

### Adding a New Chain

1. Create adapter in `internal/adapters/chains/{chain}.go`
2. Implement chain interface
3. Register in `internal/adapters/registry/registry.go`
4. Add tests in `tests/integration/chains_test.go`

## Deployment

### Docker

```bash
# Build image
docker build -t price-service:latest -f deployment/Dockerfile .

# Run with docker-compose
docker-compose -f deployment/docker-compose.yml up -d
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | - |
| `PORT` | HTTP port | 3000 |
| `LOG_LEVEL` | Log level | info |
| `STORAGE_PATH` | Archive storage path | ./data/archives |
| `PRICE_SERVICE_RATE_LIMIT_REQUESTS_PER_SECOND` | Rate limit | 2 |

## Chain-Specific Notes

See [CHAIN_ADAPTERS.md](docs/CHAIN_ADAPTERS.md) for detailed information about each chain's:
- Data format and structure
- Column mappings
- Store ID extraction patterns
- Special handling requirements

## Troubleshooting

### Encoding Issues

Croatian characters not displaying correctly? The service auto-detects Windows-1250 encoding. Verify the source file encoding.

### Rate Limiting

Getting 429 errors? Reduce `requests_per_second` in config or increase delays between requests.

### ZIP Expansion

ZIP files not expanding? Check storage path permissions and available disk space.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

See LICENSE file in the repository root.

## Support

For issues and questions:
- GitHub Issues: [github.com/kosarica/price-service/issues](https://github.com/kosarica/price-service/issues)
- Documentation: [docs/](docs/)
