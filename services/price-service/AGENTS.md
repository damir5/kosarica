# Price Service Agent Instructions

## Overview

Go service handling price ingestion, basket optimization, and price queries.
This service is the source of truth for shared API types between Node.js and Go.

## Schema Generation

Types with `jsonschema` tags in these files generate schemas for Node.js:

| File | Types |
|------|-------|
| `internal/handlers/optimize.go` | BasketItem, Location, OptimizeRequest, MissingItem, ItemPriceInfo, SingleStoreResult, StoreAllocation, MultiStoreResult |
| `internal/handlers/prices.go` | GetStorePricesRequest, StorePrice, GetStorePricesResponse, SearchItemsRequest, SearchItem, SearchItemsResponse, GetHistoricalPriceRequest, ListPriceGroupsRequest, PriceGroupSummary |
| `internal/handlers/runs.go` | ListRunsRequest, ListRunsResponse, IngestionRun, ListFilesRequest, ListFilesResponse, IngestionFile, ListErrorsRequest, ListErrorsResponse, IngestionError, GetStatsRequest, GetStatsResponse, StatsBucket, RerunRunRequest, ListChainsResponse |

### Adding jsonschema Tags

When adding new types or modifying existing ones, add `jsonschema` tags:

```go
type ExampleRequest struct {
    // Required field with validation
    Name string `json:"name" jsonschema:"required,minLength=1"`

    // Optional field
    Description *string `json:"description,omitempty"`

    // Required field with min/max
    Count int `json:"count" jsonschema:"required,minimum=1,maximum=100"`

    // Enum field
    Status string `json:"status" jsonschema:"required,enum=pending,enum=active,enum=done"`
}
```

### Regenerating Schemas

From this directory:
```bash
go run cmd/schema-gen/main.go
```

From project root:
```bash
mise run schema-generate
# or
pnpm schema:generate
```

### Output

- `../../shared/schemas/*.json` - JSON Schema files
- Node.js converts these to Zod schemas in `src/lib/go-schemas/*.ts`

## Development

```bash
# Run service
go run cmd/server/main.go

# Run tests
go test ./...

# Generate sqlc
sqlc generate
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Service port | 3003 |
| HOST | Bind address | 0.0.0.0 |
| DATABASE_URL | Postgres connection string | required |
| INTERNAL_API_KEY | Auth key for internal APIs | required |
| LOG_LEVEL | Logging verbosity | info |
| STORAGE_PATH | Path for archived files | ./data/archives |
