# Price Service Agent Instructions

## Overview

Go service handling price ingestion, basket optimization, and price queries.
This service exposes an OpenAPI spec for TypeScript SDK generation.

## OpenAPI Generation

Handlers with swag annotations generate OpenAPI spec for Node.js SDK:

| File | Endpoints |
|------|-----------|
| `internal/handlers/optimize.go` | OptimizeSingle, OptimizeMulti, CacheWarmup, CacheRefresh, CacheHealth |
| `internal/handlers/prices.go` | GetStorePrices, SearchItems |
| `internal/handlers/runs.go` | ListRuns, GetRun, ListFiles, ListErrors, GetStats, RerunRun, DeleteRun |

### Adding Swag Annotations

When adding new handlers, add swag annotations:

```go
// GetExample returns example data
// @Summary Get example
// @Description Returns example data for demonstration
// @Tags examples
// @Accept json
// @Produce json
// @Param id path string true "Example ID"
// @Success 200 {object} ExampleResponse
// @Failure 400 {object} ErrorResponse
// @Router /internal/examples/{id} [get]
func GetExample(c *gin.Context) {
    // handler code
}
```

### Regenerating OpenAPI Spec

From this directory:
```bash
go run github.com/swaggo/swag/cmd/swag@v1.16.4 init -g cmd/server/main.go -o docs
```

From project root:
```bash
mise run swag
```

### Output

- `docs/swagger.json` - OpenAPI spec (used by Node.js SDK generator)
- `docs/swagger.yaml` - OpenAPI spec (YAML format)
- Swagger UI served at `/docs/index.html`

## Development

```bash
# Run service
go run cmd/server/main.go

# Run tests
go test ./...

# Generate sqlc
sqlc generate

# Generate OpenAPI spec
mise run swag
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
