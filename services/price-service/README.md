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
- **Price groups**: Content-addressable deduplication (~50% storage reduction)
- **HTTP API**: Internal endpoints for Node.js integration
- **Basket optimization**: Single and multi-store algorithms
- **Product matching**: Barcode-based product linking

## Architecture

```
price-service/
├── cmd/
│   └── server/          # HTTP server (port 8080)
├── internal/
│   ├── adapters/        # Chain-specific adapters
│   │   └── chains/      # 11 chain implementations
│   ├── database/        # PostgreSQL layer (pgx)
│   ├── handlers/        # HTTP handlers
│   ├── http/            # HTTP client + rate limiting
│   ├── jobs/            # Background cleanup jobs
│   ├── matching/        # Product matching
│   ├── middleware/      # HTTP middleware
│   ├── optimizer/       # Basket algorithms
│   ├── pipeline/        # Discovery, fetch, parse, persist
│   ├── pricegroups/     # Hash computation
│   └── types/           # Core types
├── migrations/          # Go-specific migrations (rarely used)
└── go.mod
```

## Quick Start

### Prerequisites

- Go 1.21+
- PostgreSQL 14+
- Node.js 20+ (for the main app)

### Installation

```bash
cd services/price-service
go mod download
go build -o price-service cmd/server/main.go
```

### Configuration

Set environment variables:

```bash
export DATABASE_URL="postgres://user:pass@localhost:5432/kosarica"
export PORT="8080"
export INTERNAL_API_KEY="your-secret-key"
export PRICE_SERVICE_RATE_LIMIT_REQUESTS_PER_SECOND=2
```

### Running the Server

```bash
./price-service
```

Server listens on `http://localhost:8080`

## API Endpoints

### Health Checks

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Liveness check (always 200 OK) |
| GET | `/internal/health` | Readiness + DB connection status |

### Ingestion

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/internal/admin/ingest/:chain` | Trigger ingestion |
| GET | `/internal/ingestion/runs` | List ingestion runs |
| GET | `/internal/ingestion/runs/:id` | Get run details |

**Trigger ingestion:**
```bash
curl -X POST http://localhost:8080/internal/admin/ingest/konzum \
  -H "INTERNAL_API_KEY: your-secret-key"
```

### Prices

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/internal/prices/:chain/:store` | Store prices |
| GET | `/internal/items/search?q=` | Search items |

### Basket Optimization

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/internal/basket/optimize/single` | Single-store optimize |
| POST | `/internal/basket/optimize/multi` | Multi-store optimize |

### Product Matching

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/internal/matching/barcode` | Trigger barcode match |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | - |
| `PORT` | HTTP port | 8080 |
| `INTERNAL_API_KEY` | Auth header for internal API | - |
| `PRICE_SERVICE_RATE_LIMIT_REQUESTS_PER_SECOND` | Rate limit for external requests | 2 |
| `LOG_LEVEL` | Log level (debug, info, warn, error) | info |

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

# Coverage
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

### Hot Reload (optional)

```bash
# Install air
go install github.com/air-verse/air@latest

# Run with hot reload
air
```

## Troubleshooting

### Encoding Issues

**Problem**: Croatian characters not displaying correctly

**Solution**: The service auto-detects Windows-1250 encoding. Verify the source file encoding with `file -i filename.csv`.

### Rate Limiting

**Problem**: Getting 429 errors from chain portals

**Solution**: Reduce `PRICE_SERVICE_RATE_LIMIT_REQUESTS_PER_SECOND` to 1 or add delays between requests.

### Circuit Breaker Issues

**Problem**: Node.js cannot reach Go service

**Solution**:
1. Check Go service health: `curl http://localhost:8080/internal/health`
2. Check INTERNAL_API_KEY matches on both services
3. Review logs: `journalctl -u kosarica-go -n 100`

### Database Connection Issues

**Problem**: "connection refused" or timeout

**Solution**:
1. Verify PostgreSQL is running: `sudo systemctl status postgresql`
2. Check DATABASE_URL format
3. Verify database exists: `psql -l`

### Memory Issues

**Problem**: Service OOM when processing large files

**Solution**:
- The service uses streaming for large files
- Check available memory: `free -h`
- Consider reducing `DB_MAX_CONNS` if needed

## Deployment

### Production Build

```bash
go build -ldflags="-s -w" -o price-service cmd/server/main.go
```

### Systemd Service

Create `/etc/systemd/system/kosarica-go.service`:

```ini
[Unit]
Description=Kosarica Go Price Service
After=network.target postgresql.service

[Service]
Type=simple
User=kosarica
WorkingDirectory=/home/kosarica/app/services/price-service
Environment="DATABASE_URL=postgres://user:pass@localhost/kosarica"
Environment="PORT=8080"
ExecStart=/home/kosarica/app/services/price-service/price-service
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable kosarica-go
sudo systemctl start kosarica-go
```

## Schema Authority

**Important**: The Go service does NOT define database schema. All schema changes are made via Drizzle in the main app:

1. Modify `src/db/schema.ts` in the main app
2. Run `pnpm db:generate` to create migration
3. Run `pnpm db:migrate` to apply migration
4. Go service auto-reads updated schema

## License

See LICENSE file in the repository root.

## Support

For issues and questions:
- GitHub Issues: [github.com/kosarica/price-service/issues](https://github.com/kosarica/price-service/issues)
- Documentation: [doc/planning/](../doc/planning/)
