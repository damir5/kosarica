# Phase 7: Product Matching - Implementation Plan

## Overview
Link retailer-specific items across chains to canonical products, enabling cross-chain price comparison.

## Current State
- `products` table: canonical products (cross-chain)
- `product_links` table: links products to retailer_items
- `retailer_items` table: chain-specific items with barcode, name, brand

## Implementation Steps

### Step 1: Barcode Auto-Match (Go)

**Location:** `services/price-service/internal/matching/barcode.go`

```go
// AutoMatchByBarcode finds exact barcode matches across chains
func AutoMatchByBarcode(ctx context.Context, db *pgxpool.Pool) (int, error) {
    // 1. Find retailer_items with barcodes not yet linked
    // 2. Group by barcode (items with same barcode = same product)
    // 3. If product exists for barcode -> link
    // 4. If no product exists but 2+ items share barcode -> create product, link all
    // 5. Return count of new links created
}
```

**SQL Queries needed:**
```sql
-- name: GetUnlinkedItemsWithBarcode :many
SELECT ri.* FROM retailer_items ri
LEFT JOIN product_links pl ON pl.retailer_item_id = ri.id
WHERE ri.barcode IS NOT NULL AND ri.barcode != '' AND pl.product_id IS NULL;

-- name: GetItemsByBarcode :many
SELECT * FROM retailer_items WHERE barcode = $1;

-- name: CreateProduct :one
INSERT INTO products (name, brand, category, unit, unit_quantity, image_url)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING id;

-- name: CreateProductLink :exec
INSERT INTO product_links (product_id, retailer_item_id, match_type, confidence, created_at)
VALUES ($1, $2, 'barcode', 1.0, now());
```

**Logic:**
1. Run after each ingestion (or nightly batch)
2. Barcode matches get confidence=1.0, match_type='barcode'
3. When creating product from barcode group, pick best name (longest, most common)

### Step 2: AI Name Matching (Go)

**Location:** `services/price-service/internal/matching/ai.go`

**Dependencies:**
- OpenAI API (embeddings + chat)
- pgvector extension OR store embeddings in Go memory

**Approach A: Embedding Similarity (Recommended)**
```go
type EmbeddingMatcher struct {
    openai *openai.Client
    cache  map[int64][]float32  // itemID -> embedding
}

func (m *EmbeddingMatcher) FindMatches(ctx context.Context, item RetailerItem) ([]Match, error) {
    // 1. Generate embedding for item: "{brand} {name} {unit} {unit_quantity}"
    // 2. Compare against existing product embeddings
    // 3. Return top-N matches with similarity > threshold
}
```

**Approach B: LLM Classification**
```go
func MatchWithLLM(ctx context.Context, item RetailerItem, candidates []Product) (*Match, error) {
    // 1. Send item + top candidates to GPT-4
    // 2. Ask: "Which product matches this item? Reply with product_id or 'none'"
    // 3. Parse response
}
```

**Hybrid Approach (Best):**
1. Use embeddings for initial candidate retrieval (fast, cheap)
2. Use LLM for final confirmation on uncertain matches (accurate, expensive)

**Confidence Thresholds:**
- similarity > 0.95 → auto-link (match_type='ai', confidence=0.95+)
- similarity 0.80-0.95 → queue for review (match_type='ai_pending')
- similarity < 0.80 → no match, needs manual

### Step 3: Match Queue Table

**Add to schema.ts:**
```typescript
export const productMatchQueue = pgTable('product_match_queue', {
  id: serial('id').primaryKey(),
  retailerItemId: bigint('retailer_item_id', { mode: 'number' }).notNull(),
  candidateProductId: integer('candidate_product_id'),  // NULL = no good candidate
  similarity: real('similarity'),
  status: varchar('status', { length: 16 }).default('pending'),  // pending, approved, rejected, skipped
  reviewedBy: varchar('reviewed_by', { length: 32 }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  statusIdx: index('product_match_queue_status_idx').on(table.status),
  itemIdx: uniqueIndex('product_match_queue_item_idx').on(table.retailerItemId),
}));
```

### Step 4: Admin Review UI (React)

**Location:** `src/components/admin/products/`

**Components:**
1. `MatchReviewQueue.tsx` - List of pending matches
2. `MatchReviewCard.tsx` - Single item to review
3. `ProductSearch.tsx` - Search existing products
4. `CreateProductModal.tsx` - Create new product inline

**UI Flow:**
```
┌─────────────────────────────────────────────────────────────┐
│ Product Match Review                          [32 pending]  │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Konzum: Mlijeko 1L 2.8% (barcode: 3850123456789)       │ │
│ │                                                         │ │
│ │ Suggested Match (87% similarity):                       │ │
│ │ [Image] Mlijeko svježe 2.8% 1L - Dukat                 │ │
│ │                                                         │ │
│ │ [✓ Approve] [✗ Reject] [Create New] [Skip]             │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ DM: Nutella 400g (barcode: 8000500000001)              │ │
│ │ ...                                                     │ │
└─────────────────────────────────────────────────────────────┘
```

**oRPC Routes:**
```typescript
// src/orpc/router/products.ts
export const productsRouter = router({
  getPendingMatches: adminProcedure
    .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ ctx }) => {
      // Fetch from product_match_queue where status='pending'
    }),

  approveMatch: adminProcedure
    .input(z.object({ queueId: z.number(), productId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // 1. Create product_link
      // 2. Update queue status='approved'
    }),

  rejectMatch: adminProcedure
    .input(z.object({ queueId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // Update queue status='rejected'
    }),

  createProductAndLink: adminProcedure
    .input(z.object({
      queueId: z.number(),
      product: productSchema
    }))
    .mutation(async ({ input, ctx }) => {
      // 1. Create product
      // 2. Create product_link
      // 3. Update queue status='approved'
    }),
});
```

### Step 5: Go Internal API

**Endpoints:**
```
POST /internal/matching/run-barcode     # Run barcode matching
POST /internal/matching/run-ai          # Run AI matching
GET  /internal/matching/stats           # Match statistics
POST /internal/matching/queue           # Add to review queue
```

### Step 6: Cross-Chain Price Display

**API Changes:**
```typescript
// src/orpc/router/products.ts
export const getProductPrices = publicProcedure
  .input(z.object({ productId: z.number() }))
  .query(async ({ input }) => {
    // Returns prices from all linked retailer_items across chains
    return {
      product: { id, name, brand, ... },
      prices: [
        { chainSlug: 'konzum', storeName: 'Konzum Zagreb', price: 1299, discountPrice: 999 },
        { chainSlug: 'dm', storeName: 'DM Zagreb', price: 1349, discountPrice: null },
        ...
      ]
    };
  });
```

## Testing Requirements

### Unit Tests
- Barcode matching: same barcode across chains links correctly
- AI matching: embedding similarity thresholds work
- Queue processing: approve/reject updates correctly

### Integration Tests
- Full flow: ingest → match → review → linked
- Cross-chain query returns all prices

### Manual Tests
- Admin UI: review queue works
- Create new product from queue
- Search existing products

## Metrics to Track
- Items with barcode: X%
- Items auto-matched by barcode: X%
- Items auto-matched by AI (high confidence): X%
- Items in review queue: X
- Items with no match candidate: X%

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Embedding costs (OpenAI) | Batch processing, cache embeddings, use local model (sentence-transformers) |
| Slow matching | Run async after ingestion, not in hot path |
| Wrong auto-matches | Set conservative thresholds, require review for < 0.95 |
| Duplicate products | Check existing before create, merge UI later |

## File Changes Summary

### Create
- `services/price-service/internal/matching/barcode.go`
- `services/price-service/internal/matching/ai.go`
- `services/price-service/internal/matching/queue.go`
- `services/price-service/queries/matching.sql`
- `src/components/admin/products/MatchReviewQueue.tsx`
- `src/components/admin/products/MatchReviewCard.tsx`
- `src/components/admin/products/ProductSearch.tsx`
- `src/components/admin/products/CreateProductModal.tsx`
- `src/orpc/router/products.ts`

### Modify
- `src/db/schema.ts` - add product_match_queue table
- `src/orpc/router/index.ts` - add products router
- `services/price-service/internal/api/router.go` - add matching endpoints

## Dependencies
- OpenAI API key (for embeddings)
- pgvector extension (optional, for DB-side similarity search)

## Estimated Scope
- 8-10 new files
- ~1500 lines of Go
- ~800 lines of TypeScript/React
