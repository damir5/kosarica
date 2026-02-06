# API Documentation

## Overview

The Kosarica API is split into two layers:

1. **Go Internal API** (localhost:8080) - Direct Go service endpoints
2. **oRPC Routes** (via Node.js) - Type-safe public API with authentication

---

## Go Internal API (localhost:8080)

> **Note**: These endpoints are internal-only and protected by `INTERNAL_API_KEY` header.
> Clients should use the oRPC routes instead.

### Health Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Liveness check (always returns 200 OK) |
| GET | `/internal/health` | Readiness check + DB connection status |

#### Response
```json
{
  "status": "ok",
  "database": "connected"
}
```

---

### Ingestion Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/internal/admin/ingest/:chain` | Trigger ingestion for a chain |
| GET | `/internal/ingestion/runs` | List recent ingestion runs |
| GET | `/internal/ingestion/runs/:id` | Get specific run details |

#### Trigger Ingestion
```bash
POST /internal/admin/ingest/konzum
```

**Response:**
```json
{
  "run_id": "run_123",
  "chain": "konzum",
  "status": "running"
}
```

#### List Runs
```bash
GET /internal/ingestion/runs?chain=konzum&limit=10
```

**Response:**
```json
{
  "runs": [
    {
      "id": "run_123",
      "chain": "konzum",
      "status": "completed",
      "started_at": "2026-01-21T10:00:00Z",
      "completed_at": "2026-01-21T10:05:00Z",
      "files_processed": 150,
      "items_imported": 45000
    }
  ]
}
```

---

### Price Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/internal/prices/:chain/:store` | Get current prices for a store |
| GET | `/internal/items/search?q=` | Search items by name/barcode |

#### Get Store Prices
```bash
GET /internal/prices/konzum/store-123
```

**Response:**
```json
{
  "store_id": "store-123",
  "chain": "konzum",
  "prices": [
    {
      "item_id": "item-456",
      "name": "Milk 1L",
      "price_cents": 150,
      "unit_price_cents": 15,
      "unit": "100ml"
    }
  ]
}
```

#### Search Items
```bash
GET /internal/items/search?q=milk
```

**Response:**
```json
{
  "items": [
    {
      "id": "item-456",
      "name": "Milk 1L",
      "chain": "konzum",
      "category": "Dairy"
    }
  ]
}
```

---

### Basket Optimization Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/internal/basket/optimize/single` | Optimize for single store |
| POST | `/internal/basket/optimize/multi` | Optimize across multiple stores |

#### Single Store Optimization
```bash
POST /internal/basket/optimize/single
```

**Request:**
```json
{
  "store_id": "store-123",
  "items": ["item-456", "item-789"],
  "preferences": {
    "prefer_discounts": true
  }
}
```

**Response:**
```json
{
  "total_cents": 450,
  "items": [
    {
      "item_id": "item-456",
      "price_cents": 150,
      "has_discount": true
    }
  ]
}
```

#### Multi-Store Optimization
```bash
POST /internal/basket/optimize/multi
```

**Request:**
```json
{
  "items": ["item-456", "item-789"],
  "max_stores": 3,
  "preferences": {
    "minimize_stores": true,
    "prefer_discounts": true
  }
}
```

**Response:**
```json
{
  "total_cents": 420,
  "stores": [
    {
      "store_id": "store-123",
      "items": ["item-456"],
      "subtotal_cents": 150
    },
    {
      "store_id": "store-456",
      "items": ["item-789"],
      "subtotal_cents": 270
    }
  ]
}
```

---

### Product Matching Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/internal/matching/barcode` | Trigger barcode matching |

#### Trigger Barcode Match
```bash
POST /internal/matching/barcode
```

**Request:**
```json
{
  "retailer_item_id": "item-123",
  "barcode": "3850012345678"
}
```

**Response:**
```json
{
  "matches": [
    {
      "product_id": "prod-456",
      "name": "Milk 1L",
      "confidence": 0.95
    }
  ]
}
```

---

## oRPC Routes (via Node.js)

> **Base URL**: `http://localhost:3000/api/rpc`
> **Authentication**: Varies by route (public, authenticated, superadmin)

### Admin Routes (superadmin only)

| Route | Purpose | oRPC Path |
|-------|---------|-----------|
| Ingestion control | Trigger/manage ingestion | `admin.ingestion.*` |
| Store management | Approve/reject/merge stores | `admin.stores.*` |
| Product matching | Link products to retailer items | `admin.products.*` |

#### Ingestion Routes
```typescript
// Trigger ingestion
await orpc.admin.ingestion.trigger({ chain: 'konzum' })

// Get ingestion runs
await orpc.admin.ingestion.runs({ chain: 'konzum', limit: 10 })
```

#### Store Routes
```typescript
// List pending stores
await orpc.admin.stores.listPending()

// Approve store
await orpc.admin.stores.approve({ storeId: 'store-123' })

// Reject store
await orpc.admin.stores.reject({ storeId: 'store-123' })

// Merge stores
await orpc.admin.stores.merge({
  sourceId: 'store-123',
  targetId: 'store-456'
})
```

#### Product Routes
```typescript
// Search unmatched items
await orpc.admin.products.searchUnmatched({ query: 'milk' })

// Link item to product
await orpc.admin.products.link({
  retailerItemId: 'item-123',
  productId: 'prod-456'
})
```

---

### Public Routes

| Route | Purpose | oRPC Path |
|-------|---------|-----------|
| Price queries | Get prices for items/stores | `prices.*` |
| Basket optimization | Find optimal shopping combinations | `basket.*` |

#### Price Routes
```typescript
// Get prices for item across stores
await orpc.prices.forItem({
  itemId: 'item-123',
  location: { lat: 45.8, lng: 16.0 }
})

// Get prices for store
await orpc.prices.forStore({
  storeId: 'store-123'
})
```

#### Basket Routes
```typescript
// Optimize basket
await orpc.basket.optimize({
  items: ['item-123', 'item-456'],
  preferences: {
    minimizeStops: true,
    maxDistanceKm: 10
  }
})
```

---

## Error Format

All errors follow this structure:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "Additional context"
  }
}
```

### Common Error Codes

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | Missing or invalid authentication |
| `FORBIDDEN` | User lacks required permissions |
| `NOT_FOUND` | Resource not found |
| `INVALID_INPUT` | Request validation failed |
| `SERVICE_UNAVAILABLE` | Go service is down (circuit breaker open) |
| `RATE_LIMITED` | Too many requests |

---

## Rate Limiting

| Route | Limit |
|-------|-------|
| Public (unauthenticated) | 100 req/hour per IP |
| Authenticated users | 1000 req/hour |
| Admin (superadmin) | No limit |

---

## Authentication

### Better Auth Session

All authenticated routes require a valid session cookie.

```typescript
// Client-side
const session = await authClient.getSession()
if (!session) {
  // Redirect to login
}
```

### Admin Authorization

`admin.*` routes require `role = 'superadmin'`:

```typescript
// Server-side middleware
const user = await auth()
if (user?.role !== 'superadmin') {
  throw new Error('Forbidden')
}
```
