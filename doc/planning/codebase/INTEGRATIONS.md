# External Integrations

## Go Service Integration

### Connection Details

Node.js communicates with the Go service via internal HTTP API:

| Setting | Value |
|---------|-------|
| Base URL | `http://localhost:8080` (internal only) |
| Auth Header | `INTERNAL_API_KEY` |
| Tracing Header | `X-Request-ID` (propagated) |
| Timeout | 30 seconds |

### Client Implementation

Located in `src/lib/go-service-client.ts`:

```typescript
async function callGoService(endpoint: string, options?: RequestInit) {
  const response = await fetch(`${GO_SERVICE_URL}${endpoint}`, {
    ...options,
    headers: {
      'INTERNAL_API_KEY': process.env.INTERNAL_API_KEY,
      'X-Request-ID': requestId,
      ...options?.headers,
    },
  });
  // Circuit breaker + retry logic handles failures
}
```

### Circuit Breaker Behavior

Protects against cascading failures when Go service is unavailable:

```mermaid
stateDiagram-v2
    [*] --> Closed
    Closed --> Open: 5 failures in 30s
    Open --> HalfOpen: 30s cooldown
    HalfOpen --> Closed: 1 success
    HalfOpen --> Open: Request fails
```

**States:**
- **Closed**: Normal operation, requests pass through
- **Open**: Circuit tripped, requests fail immediately
- **Half-Open**: Testing if service recovered

**Transitions:**
- Closed → Open: 5 failures within 30 seconds
- Open → Half-Open: 30 second cooldown expires
- Half-Open → Closed: First request succeeds
- Half-Open → Open: Request fails

### Retry Logic

Exponential backoff for GET requests to external chain portals:

| Attempt | Delay |
|---------|-------|
| 1 | immediate |
| 2 | 1 second |
| 3 | 2 seconds |
| 4 | 4 seconds |
| Max | 4 retries total |

## Retail Chain Portals

### Supported Chains (11 total)

| Chain | Format | URL Pattern | Encoding |
|-------|--------|-------------|----------|
| Konzum | CSV | `konzum.hr/cjenik` | UTF-8 |
| Lidl | CSV/ZIP | `lidl.hr/cjenik` | UTF-8 |
| Plodine | CSV | `plodine.hr/cjenik` | Windows-1250 |
| Interspar | CSV | `interspar.hr/cjenik` | UTF-8 |
| Studenac | XML | `studenac.hr/cjenik` | UTF-8 |
| Kaufland | CSV | `kaufland.hr/cjenik` | UTF-8 (tab-delimited) |
| Eurospin | CSV | `eurospin.hr/cjenik` | UTF-8 |
| DM | XLSX | `dm.hr/cjenik` | - |
| KTC | CSV | `ktc.hr/cjenik` | Windows-1250 |
| Metro | XML | `metro.hr/cjenik` | UTF-8 |
| Trgocentar | CSV | `trgocentar.hr/cjenik` | Windows-1250 |

### Integration Pattern

```mermaid
graph LR
    A[Discover] --> B[Fetch]
    B --> C[Parse]
    C --> D[Persist]

    subgraph "Chain Adapter"
        A
        B
        C
    end

    subgraph "Go Service"
        D
    end

    D --> E[(PostgreSQL)]
```

1. **Discovery**: Scrape portal HTML or API for file links
2. **Fetch**: Download with rate limiting (configurable per chain)
3. **Parse**: Chain-specific adapters normalize data to `NormalizedRow`
4. **Store Resolution**: Map filename/portal ID to store records
5. **Persist**: Write to PostgreSQL via price groups

## Authentication

### Better Auth

- **Provider**: Email/password + Passkey (WebAuthn)
- **Endpoint**: `/api/auth/*`
- **Tables**: `user`, `session`, `account`, `verification`, `passkey`

### Environment Variables

```
BETTER_AUTH_SECRET     # JWT signing secret (32+ chars)
BETTER_AUTH_URL        # Base URL (http://localhost:3000)
PASSKEY_RP_ID          # Relying Party ID (localhost)
PASSKEY_RP_NAME        # Relying Party Name (Kosarica App)
```

## Removed Services

The following Cloudflare services are NO LONGER USED:

- ~~Cloudflare D1~~ (replaced by PostgreSQL)
- ~~Cloudflare R2~~ (not needed for current architecture)
- ~~Cloudflare Queues~~ (ingestion is synchronous/triggered)
- ~~Cloudflare Workers~~ (replaced by Node.js + Go)
- ~~Cloudflare Cron Triggers~~ (use external cron or manual trigger)

## Configuration

### Environment Setup

```bash
# .env for Node.js
DATABASE_URL=postgresql://user:pass@localhost:5432/kosarica
INTERNAL_API_KEY=your-secret-key
BETTER_AUTH_SECRET=your-32-char-secret
BETTER_AUTH_URL=http://localhost:3000
PASSKEY_RP_ID=localhost
PASSKEY_RP_NAME=Kosarica App
```

```bash
# Environment for Go Service
DATABASE_URL=postgresql://user:pass@localhost:5432/kosarica
PORT=8080
INTERNAL_API_KEY=your-secret-key
PRICE_SERVICE_RATE_LIMIT_REQUESTS_PER_SECOND=2
```

### Go Service Rate Limiting

Configure per-chain rate limiting via environment:

```
PRICE_SERVICE_RATE_LIMIT_REQUESTS_PER_SECOND=2
```

This prevents overwhelming retail chain portals during ingestion.
