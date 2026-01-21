# Phase 7: Product Matching - Reviewed Implementation Plan

## Review Summary

Plan reviewed by: **Gemini Pro**, **Grok**, **GPT-4.1**

### Critical Issues Identified

| Issue | Severity | Source |
|-------|----------|--------|
| **ID Type Mismatch** - Plan uses integer IDs but schema uses CUID2 strings | BLOCKER | Gemini |
| **Race Conditions** - Concurrent barcode matching can create duplicate products | HIGH | Gemini, GPT-4.1 |
| **Queue limits one candidate per item** - Should support top-N candidates | HIGH | Grok |
| **In-memory embeddings won't scale** - Use pgvector exclusively | HIGH | All three |
| **No rejected match exclusion** - AI will regenerate rejected matches | MEDIUM | Gemini |
| **Barcode trust issues** - Retailers may have wrong barcodes | MEDIUM | Gemini, Grok |
| **Missing bulk admin actions** | MEDIUM | Grok |
| **No AI provider abstraction** | MEDIUM | GPT-4.1 |
| **Missing audit trail** | MEDIUM | GPT-4.1 |

---

## Revised Implementation Plan

### Step 1: Schema Updates (Drizzle)

**Fix ID types to match existing schema (CUID2 strings):**

```typescript
// src/db/schema.ts additions

// Match candidates - supports top-N suggestions per item
export const productMatchCandidates = pgTable('product_match_candidates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  retailerItemId: text('retailer_item_id')
    .notNull()
    .references(() => retailerItems.id, { onDelete: 'cascade' }),
  candidateProductId: text('candidate_product_id')
    .references(() => products.id, { onDelete: 'cascade' }),
  similarity: real('similarity'),
  matchType: text('match_type').notNull(),  // 'barcode', 'ai', 'heuristic'
  rank: smallint('rank').default(1),  // 1 = best candidate
  flags: text('flags'),  // 'suspicious_barcode', 'private_label', etc.
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  itemIdx: index('pmc_item_idx').on(table.retailerItemId),
  typeIdx: index('pmc_type_idx').on(table.matchType),
}));

// Review queue with audit trail
export const productMatchQueue = pgTable('product_match_queue', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  retailerItemId: text('retailer_item_id')
    .notNull()
    .references(() => retailerItems.id, { onDelete: 'cascade' }),
  status: text('status').default('pending'),  // pending, approved, rejected, skipped
  decision: text('decision'),  // 'linked', 'new_product', 'no_match'
  linkedProductId: text('linked_product_id')
    .references(() => products.id),
  reviewedBy: text('reviewed_by')
    .references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNotes: text('review_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  statusIdx: index('pmq_status_idx').on(table.status),
  itemUniq: uniqueIndex('pmq_item_uniq').on(table.retailerItemId),
}));

// Audit log for all match decisions
export const productMatchAudit = pgTable('product_match_audit', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  queueId: text('queue_id').notNull(),
  action: text('action').notNull(),  // 'approved', 'rejected', 'created', 'unlinked'
  userId: text('user_id').references(() => users.id),
  previousState: jsonb('previous_state'),
  newState: jsonb('new_state'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Canonical barcode lookup (prevents race conditions)
export const canonicalBarcodes = pgTable('canonical_barcodes', {
  barcode: text('barcode').primaryKey(),
  productId: text('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Product embeddings (pgvector)
// NOTE: Requires pgvector extension and raw SQL migration
// CREATE TABLE product_embeddings (
//   product_id TEXT PRIMARY KEY REFERENCES products(id),
//   embedding vector(1536),  -- OpenAI ada-002 dimension
//   model_version TEXT NOT NULL,
//   created_at TIMESTAMPTZ DEFAULT now()
// );
// CREATE INDEX ON product_embeddings USING ivfflat (embedding vector_cosine_ops);
```

### Step 2: Barcode Matching (Go) - Race-Safe

**Location:** `services/price-service/internal/matching/barcode.go`

```go
package matching

import (
    "context"
    "crypto/sha256"
    "encoding/hex"
    "strings"

    "github.com/jackc/pgx/v5/pgxpool"
)

type BarcodeResult struct {
    NewProducts     int
    NewLinks        int
    SuspiciousFlags int
}

// AutoMatchByBarcode - race-safe barcode matching
func AutoMatchByBarcode(ctx context.Context, db *pgxpool.Pool) (*BarcodeResult, error) {
    result := &BarcodeResult{}

    // 1. Get unmatched items with barcodes (use NOT EXISTS for performance)
    items, err := getUnmatchedItemsWithBarcode(ctx, db)
    if err != nil {
        return nil, fmt.Errorf("get unmatched: %w", err)
    }

    // 2. Group by barcode
    byBarcode := make(map[string][]RetailerItem)
    for _, item := range items {
        bc := normalizeBarcode(item.Barcode)
        if bc == "" {
            continue
        }
        byBarcode[bc] = append(byBarcode[bc], item)
    }

    // 3. Process each barcode atomically
    for barcode, items := range byBarcode {
        if err := processBarcodeGroup(ctx, db, barcode, items, result); err != nil {
            log.Error("barcode match failed", "barcode", barcode, "error", err)
            // Continue with other barcodes
        }
    }

    return result, nil
}

func processBarcodeGroup(ctx context.Context, db *pgxpool.Pool, barcode string, items []RetailerItem, result *BarcodeResult) error {
    return pgx.BeginTxFunc(ctx, db, pgx.TxOptions{}, func(tx pgx.Tx) error {
        // Lock-based "get or create" via canonical_barcodes table
        var productID string

        // Try to get existing
        err := tx.QueryRow(ctx, `
            SELECT product_id FROM canonical_barcodes WHERE barcode = $1 FOR UPDATE
        `, barcode).Scan(&productID)

        if err == pgx.ErrNoRows {
            // Check if items pass sanity check before creating product
            if flag := checkSuspiciousBarcode(items); flag != "" {
                // Queue for manual review instead of auto-linking
                for _, item := range items {
                    if err := queueForReview(ctx, tx, item.ID, flag); err != nil {
                        return err
                    }
                }
                result.SuspiciousFlags += len(items)
                return nil
            }

            // Create new product from best item
            best := pickBestItem(items)
            productID, err = createProduct(ctx, tx, best)
            if err != nil {
                return fmt.Errorf("create product: %w", err)
            }

            // Register in canonical_barcodes (prevents races)
            _, err = tx.Exec(ctx, `
                INSERT INTO canonical_barcodes (barcode, product_id) VALUES ($1, $2)
                ON CONFLICT (barcode) DO NOTHING
            `, barcode, productID)
            if err != nil {
                return err
            }
            result.NewProducts++
        } else if err != nil {
            return err
        }

        // Link all items to product
        for _, item := range items {
            _, err := tx.Exec(ctx, `
                INSERT INTO product_links (product_id, retailer_item_id, match_type, confidence, created_at)
                VALUES ($1, $2, 'barcode', 1.0, now())
                ON CONFLICT (product_id, retailer_item_id) DO NOTHING
            `, productID, item.ID)
            if err != nil {
                return err
            }
            result.NewLinks++
        }

        return nil
    })
}

// checkSuspiciousBarcode - sanity check for barcode groups
func checkSuspiciousBarcode(items []RetailerItem) string {
    if len(items) < 2 {
        return ""
    }

    // Check name similarity across items
    names := make([]string, len(items))
    for i, item := range items {
        names[i] = normalizeProductName(item.Name)
    }

    // If names are too different, flag as suspicious
    for i := 1; i < len(names); i++ {
        sim := stringSimilarity(names[0], names[i])
        if sim < 0.3 {
            return "suspicious_barcode_name_mismatch"
        }
    }

    // Check for private label conflicts (different brands)
    brands := make(map[string]bool)
    for _, item := range items {
        if item.Brand != "" && item.Brand != "N/A" {
            brands[strings.ToLower(item.Brand)] = true
        }
    }
    if len(brands) > 1 {
        return "suspicious_barcode_brand_conflict"
    }

    return ""
}
```

### Step 3: AI Matching with Provider Abstraction (Go)

**Location:** `services/price-service/internal/matching/embedding.go`

```go
package matching

import "context"

// EmbeddingProvider - abstraction for different AI providers
type EmbeddingProvider interface {
    GenerateEmbedding(ctx context.Context, text string) ([]float32, error)
    ModelVersion() string
    Dimension() int
}

// OpenAIProvider implements EmbeddingProvider
type OpenAIProvider struct {
    client *openai.Client
    model  string
}

func (p *OpenAIProvider) GenerateEmbedding(ctx context.Context, text string) ([]float32, error) {
    resp, err := p.client.CreateEmbeddings(ctx, openai.EmbeddingRequest{
        Model: p.model,
        Input: []string{text},
    })
    if err != nil {
        return nil, fmt.Errorf("openai embedding: %w", err)
    }
    return resp.Data[0].Embedding, nil
}

// LocalProvider - fallback using sentence-transformers
type LocalProvider struct {
    endpoint string  // Local inference server
}

func (p *LocalProvider) GenerateEmbedding(ctx context.Context, text string) ([]float32, error) {
    // Call local inference endpoint
    // ...
}
```

**Location:** `services/price-service/internal/matching/ai.go`

```go
package matching

type AIMatchResult struct {
    Processed       int
    HighConfidence  int  // Auto-linked
    QueuedForReview int
    NoMatch         int
}

type AIMatcherConfig struct {
    Provider          EmbeddingProvider
    AutoLinkThreshold float32  // >= this = auto-link (default 0.95)
    ReviewThreshold   float32  // >= this = queue for review (default 0.80)
    BatchSize         int      // Embedding batch size
    MaxCandidates     int      // Top-N candidates to store
}

func RunAIMatching(ctx context.Context, db *pgxpool.Pool, cfg AIMatcherConfig) (*AIMatchResult, error) {
    result := &AIMatchResult{}

    // 1. Get unmatched items (excluding already rejected)
    items, err := getUnmatchedItemsForAI(ctx, db)
    if err != nil {
        return nil, err
    }

    for _, item := range items {
        // 2. Normalize and generate embedding
        text := normalizeForEmbedding(item)
        embedding, err := cfg.Provider.GenerateEmbedding(ctx, text)
        if err != nil {
            log.Error("embedding failed", "item", item.ID, "error", err)
            continue
        }

        // 3. Find similar products using pgvector
        candidates, err := findSimilarProducts(ctx, db, embedding, cfg.MaxCandidates)
        if err != nil {
            log.Error("similarity search failed", "item", item.ID, "error", err)
            continue
        }

        // 4. Store candidates
        for rank, cand := range candidates {
            if err := storeCandidateMatch(ctx, db, item.ID, cand, rank+1); err != nil {
                log.Error("store candidate failed", "error", err)
            }
        }

        // 5. Decision based on best candidate
        if len(candidates) == 0 || candidates[0].Similarity < cfg.ReviewThreshold {
            result.NoMatch++
            continue
        }

        best := candidates[0]
        if best.Similarity >= cfg.AutoLinkThreshold && !hasPrivateLabelConflict(item, best.Product) {
            // Auto-link high confidence
            if err := createProductLink(ctx, db, best.Product.ID, item.ID, "ai", best.Similarity); err != nil {
                log.Error("auto-link failed", "error", err)
                continue
            }
            result.HighConfidence++
        } else {
            // Queue for review
            if err := queueForReview(ctx, db, item.ID, "ai_uncertain"); err != nil {
                log.Error("queue failed", "error", err)
                continue
            }
            result.QueuedForReview++
        }

        result.Processed++
    }

    return result, nil
}

// normalizeForEmbedding - consistent text preparation
func normalizeForEmbedding(item RetailerItem) string {
    // Normalize units: "1 L" -> "1l", "1000 ml" -> "1l"
    unit := normalizeUnit(item.Unit, item.UnitQuantity)

    // Remove accents, lowercase
    name := removeDiacritics(strings.ToLower(item.Name))
    brand := removeDiacritics(strings.ToLower(item.Brand))

    return fmt.Sprintf("%s %s %s", brand, name, unit)
}

// getUnmatchedItemsForAI - excludes already rejected matches
func getUnmatchedItemsForAI(ctx context.Context, db *pgxpool.Pool) ([]RetailerItem, error) {
    rows, err := db.Query(ctx, `
        SELECT ri.* FROM retailer_items ri
        WHERE NOT EXISTS (
            SELECT 1 FROM product_links pl WHERE pl.retailer_item_id = ri.id
        )
        AND NOT EXISTS (
            SELECT 1 FROM product_match_queue pmq
            WHERE pmq.retailer_item_id = ri.id AND pmq.status = 'rejected'
        )
    `)
    // ...
}
```

### Step 4: Admin Review UI (React)

**Location:** `src/components/admin/products/`

**MatchReviewQueue.tsx** - with bulk actions:
```typescript
import { useState } from 'react';
import { orpc } from '@/orpc/client';

export function MatchReviewQueue() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = orpc.products.getPendingMatches.useQuery({
    limit: 50,
    offset: 0,
  });

  const bulkApproveMutation = orpc.products.bulkApprove.useMutation();
  const bulkRejectMutation = orpc.products.bulkReject.useMutation();

  const handleBulkApprove = () => {
    bulkApproveMutation.mutate({ queueIds: Array.from(selected) });
    setSelected(new Set());
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2>Product Match Review ({data?.total ?? 0} pending)</h2>

        {selected.size > 0 && (
          <div className="flex gap-2">
            <span>{selected.size} selected</span>
            <button onClick={handleBulkApprove}>Bulk Approve</button>
            <button onClick={() => bulkRejectMutation.mutate({ queueIds: Array.from(selected) })}>
              Bulk Reject
            </button>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {data?.items.map((item) => (
          <MatchReviewCard
            key={item.id}
            item={item}
            selected={selected.has(item.id)}
            onSelect={(sel) => {
              const next = new Set(selected);
              sel ? next.add(item.id) : next.delete(item.id);
              setSelected(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

**MatchReviewCard.tsx** - shows multiple candidates:
```typescript
export function MatchReviewCard({ item, selected, onSelect }) {
  const approveMutation = orpc.products.approveMatch.useMutation();
  const rejectMutation = orpc.products.rejectMatch.useMutation();

  return (
    <div className="border rounded p-4">
      <div className="flex items-start gap-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
        />

        <div className="flex-1">
          <div className="font-medium">{item.retailerItem.name}</div>
          <div className="text-sm text-gray-500">
            {item.retailerItem.chainName} | Barcode: {item.retailerItem.barcode || 'N/A'}
          </div>

          {item.flags && (
            <div className="mt-2 text-orange-600 text-sm">
              ⚠️ {item.flags}
            </div>
          )}

          <div className="mt-4">
            <div className="text-sm font-medium mb-2">
              Candidates ({item.candidates.length}):
            </div>
            {item.candidates.map((cand, idx) => (
              <div key={cand.productId} className="flex items-center gap-2 py-1">
                <span className="text-gray-400">#{idx + 1}</span>
                <span>{cand.product.name}</span>
                <span className="text-sm text-gray-500">
                  ({(cand.similarity * 100).toFixed(0)}%)
                </span>
                <button
                  onClick={() => approveMutation.mutate({
                    queueId: item.id,
                    productId: cand.productId,
                  })}
                  className="text-green-600"
                >
                  Link
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => {/* Open create product modal */}}
              className="text-blue-600"
            >
              Create New Product
            </button>
            <button
              onClick={() => rejectMutation.mutate({ queueId: item.id })}
              className="text-red-600"
            >
              No Match
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

### Step 5: oRPC Routes

```typescript
// src/orpc/router/products.ts

export const productsRouter = router({
  getPendingMatches: adminProcedure
    .input(z.object({
      limit: z.number().default(20),
      offset: z.number().default(0),
      flags: z.string().optional(),  // Filter by flag type
    }))
    .query(async ({ input, ctx }) => {
      const items = await db
        .select()
        .from(productMatchQueue)
        .where(eq(productMatchQueue.status, 'pending'))
        .limit(input.limit)
        .offset(input.offset);

      // Get candidates for each item
      const withCandidates = await Promise.all(
        items.map(async (item) => {
          const candidates = await db
            .select()
            .from(productMatchCandidates)
            .where(eq(productMatchCandidates.retailerItemId, item.retailerItemId))
            .orderBy(asc(productMatchCandidates.rank))
            .limit(5);

          return { ...item, candidates };
        })
      );

      return {
        items: withCandidates,
        total: await db.select({ count: count() }).from(productMatchQueue).where(eq(productMatchQueue.status, 'pending')),
      };
    }),

  approveMatch: adminProcedure
    .input(z.object({
      queueId: z.string(),
      productId: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return await db.transaction(async (tx) => {
        const queue = await tx.select().from(productMatchQueue).where(eq(productMatchQueue.id, input.queueId)).for('update');
        if (!queue[0] || queue[0].status !== 'pending') {
          throw new Error('Queue item not found or already processed');
        }

        // Create link
        await tx.insert(productLinks).values({
          productId: input.productId,
          retailerItemId: queue[0].retailerItemId,
          matchType: 'manual',
          confidence: 1.0,
        });

        // Update queue
        await tx.update(productMatchQueue)
          .set({
            status: 'approved',
            decision: 'linked',
            linkedProductId: input.productId,
            reviewedBy: ctx.user.id,
            reviewedAt: new Date(),
            reviewNotes: input.notes,
          })
          .where(eq(productMatchQueue.id, input.queueId));

        // Audit log
        await tx.insert(productMatchAudit).values({
          queueId: input.queueId,
          action: 'approved',
          userId: ctx.user.id,
          newState: { productId: input.productId },
        });
      });
    }),

  bulkApprove: adminProcedure
    .input(z.object({
      queueIds: z.array(z.string()),
    }))
    .mutation(async ({ input, ctx }) => {
      // Approve each with best candidate
      let approved = 0;
      for (const queueId of input.queueIds) {
        try {
          const queue = await db.select().from(productMatchQueue).where(eq(productMatchQueue.id, queueId));
          const bestCandidate = await db.select().from(productMatchCandidates)
            .where(and(
              eq(productMatchCandidates.retailerItemId, queue[0].retailerItemId),
              eq(productMatchCandidates.rank, 1)
            ));

          if (bestCandidate[0]) {
            await approveMatch(queueId, bestCandidate[0].candidateProductId, ctx.user.id);
            approved++;
          }
        } catch (e) {
          log.error('bulk approve failed', { queueId, error: e });
        }
      }
      return { approved };
    }),

  // ... rejectMatch, createProductAndLink, etc.
});
```

### Step 6: Testing Requirements

```go
// services/price-service/internal/matching/barcode_test.go

func TestBarcodeMatching_RaceCondition(t *testing.T) {
    // Simulate concurrent matching for same barcode
    var wg sync.WaitGroup
    results := make(chan error, 10)

    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            err := processBarcodeGroup(ctx, db, "1234567890123", testItems, &BarcodeResult{})
            results <- err
        }()
    }

    wg.Wait()
    close(results)

    // Should only create ONE product
    var count int
    db.QueryRow(ctx, "SELECT COUNT(*) FROM canonical_barcodes WHERE barcode = $1", "1234567890123").Scan(&count)
    assert.Equal(t, 1, count)
}

func TestBarcodeMatching_SuspiciousFlagging(t *testing.T) {
    // Items with same barcode but very different names
    items := []RetailerItem{
        {ID: "1", Barcode: "123", Name: "Mlijeko 1L"},
        {ID: "2", Barcode: "123", Name: "Coca Cola 2L"},  // Very different!
    }

    result, _ := AutoMatchByBarcode(ctx, db)

    // Should flag as suspicious, not auto-link
    assert.Equal(t, 0, result.NewProducts)
    assert.Equal(t, 2, result.SuspiciousFlags)
}

func TestAIMatching_PrivateLabelBlock(t *testing.T) {
    // Private labels should not match across chains
    item := RetailerItem{Brand: "K-Plus"}  // Konzum brand
    product := Product{Brand: "S-Budget"}  // Spar brand

    assert.True(t, hasPrivateLabelConflict(item, product))
}
```

---

## File Changes Summary

### Create
| Path | Purpose |
|------|---------|
| `services/price-service/internal/matching/barcode.go` | Barcode auto-matching |
| `services/price-service/internal/matching/ai.go` | AI embedding matching |
| `services/price-service/internal/matching/embedding.go` | Provider abstraction |
| `services/price-service/internal/matching/normalize.go` | Text normalization |
| `services/price-service/internal/matching/*_test.go` | Unit tests |
| `services/price-service/queries/matching.sql` | sqlc queries |
| `src/components/admin/products/MatchReviewQueue.tsx` | Review list |
| `src/components/admin/products/MatchReviewCard.tsx` | Review card |
| `src/components/admin/products/ProductSearch.tsx` | Search component |
| `src/components/admin/products/CreateProductModal.tsx` | Create form |
| `src/orpc/router/products.ts` | oRPC routes |
| `drizzle/XXXX_add_matching_tables.sql` | Migration |

### Modify
| Path | Changes |
|------|---------|
| `src/db/schema.ts` | Add matching tables |
| `src/orpc/router/index.ts` | Add products router |
| `services/price-service/internal/api/router.go` | Add matching endpoints |

---

## Implementation Order

1. **Schema first** - Add Drizzle tables, run migration
2. **pgvector setup** - Add extension, create embeddings table
3. **Barcode matching** - Go implementation with tests
4. **AI matching** - Provider abstraction, OpenAI impl, tests
5. **Internal API** - Go endpoints for triggering matching
6. **Admin UI** - Review queue, bulk actions
7. **Integration** - End-to-end testing
8. **Monitoring** - Add metrics dashboard

---

## Risks Addressed

| Original Risk | Mitigation Applied |
|---------------|-------------------|
| ID type mismatch | All IDs now use CUID2 strings |
| Race conditions | `canonical_barcodes` table + `FOR UPDATE` locks |
| Single candidate per item | Separate `product_match_candidates` table with rank |
| In-memory embeddings | pgvector exclusively |
| Regenerating rejected matches | Query excludes rejected items |
| Barcode trust issues | `checkSuspiciousBarcode()` sanity checks |
| No bulk actions | `bulkApprove`, `bulkReject` mutations |
| AI vendor lock-in | `EmbeddingProvider` interface |
| No audit trail | `product_match_audit` table |
