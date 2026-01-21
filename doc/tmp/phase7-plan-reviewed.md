# Phase 7: Product Matching - Reviewed Implementation Plan

## Review Summary

Plan reviewed by: **Gemini Pro**, **Grok**, **GPT-4.1**, **GPT-5.2**

### Critical Issues Identified

| Issue | Severity | Source |
|-------|----------|--------|
| **ID Type Mismatch** - Plan uses integer IDs but schema uses CUID2 strings | BLOCKER | Gemini |
| **Race condition incomplete** - `SELECT FOR UPDATE` only locks existing rows | BLOCKER | GPT-5.2 |
| **Missing unique constraint** - `product_links.retailer_item_id` needs UNIQUE | HIGH | GPT-5.2 |
| **Queue limits one candidate per item** - Should support top-N candidates | HIGH | Grok |
| **In-memory embeddings won't scale** - Use pgvector exclusively | HIGH | All |
| **Rejected match exclusion too aggressive** - Blocks ALL future matching | HIGH | GPT-5.2 |
| **N+1 queries in admin** - 51+ queries for limit=50 | HIGH | GPT-5.2 |
| **No candidate versioning** - Can't invalidate old candidates after model changes | MEDIUM | GPT-5.2 |
| **Barcode normalization undefined** - UPC-A vs EAN-13, leading zeros | MEDIUM | GPT-5.2 |
| **Batch size unused** - AI matching ignores BatchSize config | MEDIUM | GPT-5.2 |
| **Audit FK missing** - queueId not a foreign key | MEDIUM | GPT-5.2 |
| **pgvector index choice** - ivfflat vs hnsw considerations | MEDIUM | GPT-5.2 |

---

## Revised Implementation Plan

### Step 1: Schema Updates (Drizzle)

**Fix ID types + add missing constraints:**

```typescript
// src/db/schema.ts additions

import { sql } from 'drizzle-orm';
import { pgTable, text, real, smallint, integer, timestamp, jsonb, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

// ============================================================================
// Product Links - add unique constraint on retailer_item_id
// ============================================================================

// NOTE: Modify existing productLinks table to add:
// uniqueIndex('product_links_item_uniq').on(table.retailerItemId)
// This enforces 1:1 mapping (each retailer item -> exactly one product)

// ============================================================================
// Match Candidates - supports top-N suggestions per item with versioning
// ============================================================================

export const productMatchCandidates = pgTable('product_match_candidates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  retailerItemId: text('retailer_item_id')
    .notNull()
    .references(() => retailerItems.id, { onDelete: 'cascade' }),
  candidateProductId: text('candidate_product_id')
    .references(() => products.id, { onDelete: 'cascade' }),
  similarity: real('similarity'),
  matchType: text('match_type').notNull(),  // 'barcode', 'ai', 'trgm', 'heuristic'
  rank: smallint('rank').default(1),  // 1 = best candidate
  flags: text('flags'),  // 'suspicious_barcode', 'private_label', etc.
  // Versioning for invalidation
  matchingRunId: text('matching_run_id'),  // Which run generated this
  modelVersion: text('model_version'),  // e.g., 'text-embedding-3-small-v1'
  normalizedTextHash: text('normalized_text_hash'),  // Hash of input text for cache invalidation
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  itemIdx: index('pmc_item_idx').on(table.retailerItemId),
  typeIdx: index('pmc_type_idx').on(table.matchType),
  // Prevent duplicate candidates per item
  itemCandidateUniq: uniqueIndex('pmc_item_candidate_uniq')
    .on(table.retailerItemId, table.candidateProductId),
  // Unique rank per item
  itemRankUniq: uniqueIndex('pmc_item_rank_uniq')
    .on(table.retailerItemId, table.rank),
}));

// ============================================================================
// Review Queue with audit trail
// ============================================================================

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
  // Version for optimistic locking (prevents concurrent review conflicts)
  version: integer('version').default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  statusIdx: index('pmq_status_idx').on(table.status),
  itemUniq: uniqueIndex('pmq_item_uniq').on(table.retailerItemId),
}));

// ============================================================================
// Scoped Rejections - reject specific candidates, not global block
// ============================================================================

export const productMatchRejections = pgTable('product_match_rejections', {
  retailerItemId: text('retailer_item_id')
    .notNull()
    .references(() => retailerItems.id, { onDelete: 'cascade' }),
  rejectedProductId: text('rejected_product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  reason: text('reason'),  // 'wrong_product', 'different_size', 'private_label', etc.
  rejectedBy: text('rejected_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.retailerItemId, table.rejectedProductId] }),
}));

// ============================================================================
// Audit Log - with proper FK
// ============================================================================

export const productMatchAudit = pgTable('product_match_audit', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  queueId: text('queue_id')
    .notNull()
    .references(() => productMatchQueue.id, { onDelete: 'cascade' }),  // FK!
  action: text('action').notNull(),  // 'approved', 'rejected', 'created', 'unlinked'
  userId: text('user_id').references(() => users.id),
  previousState: jsonb('previous_state'),
  newState: jsonb('new_state'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ============================================================================
// Canonical Barcodes - with nullable product_id for race-safe creation
// ============================================================================

export const canonicalBarcodes = pgTable('canonical_barcodes', {
  barcode: text('barcode').primaryKey(),
  productId: text('product_id')
    .references(() => products.id, { onDelete: 'cascade' }),  // NULLABLE for placeholder pattern
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ============================================================================
// Retailer Item Embeddings - cache embeddings to avoid recomputation
// ============================================================================

// Raw SQL migration required for pgvector:
/*
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE retailer_item_embeddings (
  retailer_item_id TEXT PRIMARY KEY REFERENCES retailer_items(id) ON DELETE CASCADE,
  embedding vector(1536),  -- Dimension varies by model
  model_version TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  normalized_text_hash TEXT NOT NULL,  -- For cache invalidation
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE product_embeddings (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  embedding vector(1536),
  model_version TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  normalized_text_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Use HNSW for better recall on growing corpus (vs ivfflat)
CREATE INDEX ON retailer_item_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON product_embeddings USING hnsw (embedding vector_cosine_ops);

-- Run ANALYZE after bulk inserts
ANALYZE retailer_item_embeddings;
ANALYZE product_embeddings;
*/
```

### Step 2: Barcode Normalization (Go)

**Location:** `services/price-service/internal/matching/normalize.go`

```go
package matching

import (
    "regexp"
    "strings"
    "unicode"

    "golang.org/x/text/runes"
    "golang.org/x/text/transform"
    "golang.org/x/text/unicode/norm"
)

var (
    nonDigitRe      = regexp.MustCompile(`[^0-9]`)
    placeholderRe   = regexp.MustCompile(`^0+$`)
    variableWeightRe = regexp.MustCompile(`^2[0-9]`)  // EAN-13 prefix 20-29
)

// NormalizeBarcode handles UPC-A vs EAN-13, leading zeros, invalid codes
func NormalizeBarcode(barcode string) string {
    // Strip non-digits
    bc := nonDigitRe.ReplaceAllString(barcode, "")
    if bc == "" {
        return ""
    }

    // Skip placeholder barcodes (all zeros)
    if placeholderRe.MatchString(bc) {
        return ""
    }

    // Skip variable-weight item codes (20-29 prefix in EAN-13)
    if len(bc) == 13 && variableWeightRe.MatchString(bc) {
        return ""
    }

    // UPC-A (12 digits) -> EAN-13 (add leading 0)
    if len(bc) == 12 {
        bc = "0" + bc
    }

    // Validate length (must be EAN-13 after normalization)
    if len(bc) != 13 {
        // Could be internal code - return as-is but flagged
        return bc
    }

    // Optional: validate check digit
    if !validateEAN13CheckDigit(bc) {
        return ""  // Invalid barcode
    }

    return bc
}

func validateEAN13CheckDigit(bc string) bool {
    if len(bc) != 13 {
        return false
    }
    sum := 0
    for i := 0; i < 12; i++ {
        d := int(bc[i] - '0')
        if i%2 == 0 {
            sum += d
        } else {
            sum += d * 3
        }
    }
    checkDigit := (10 - (sum % 10)) % 10
    return int(bc[12]-'0') == checkDigit
}

// RemoveDiacritics handles Croatian characters properly
func RemoveDiacritics(s string) string {
    // Croatian-specific mappings
    replacer := strings.NewReplacer(
        "č", "c", "Č", "C",
        "ć", "c", "Ć", "C",
        "đ", "d", "Đ", "D",
        "š", "s", "Š", "S",
        "ž", "z", "Ž", "Z",
    )
    s = replacer.Replace(s)

    // General NFD normalization + strip combining marks
    t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
    result, _, _ := transform.String(t, s)
    return result
}

// NormalizeUnit converts units to canonical form
func NormalizeUnit(unit, quantity string) string {
    u := strings.ToLower(strings.TrimSpace(unit))
    q := strings.TrimSpace(quantity)

    // Common conversions
    conversions := map[string]string{
        "l":    "l",
        "ltr":  "l",
        "lit":  "l",
        "ml":   "ml",
        "kg":   "kg",
        "g":    "g",
        "gr":   "g",
        "kom":  "kom",
        "pcs":  "kom",
        "pack": "kom",
    }

    if canonical, ok := conversions[u]; ok {
        u = canonical
    }

    // Convert ml to l, g to kg for comparison
    if u == "ml" && q != "" {
        // Try to parse and convert
        // 1000ml -> 1l
    }

    return q + u
}
```

### Step 3: Barcode Matching - Truly Race-Safe (Go)

**Location:** `services/price-service/internal/matching/barcode.go`

```go
package matching

import (
    "context"
    "fmt"

    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"
)

type BarcodeResult struct {
    NewProducts     int
    NewLinks        int
    SuspiciousFlags int
    Skipped         int  // Invalid/placeholder barcodes
}

// AutoMatchByBarcode - processes barcodes in batches with worker pool
func AutoMatchByBarcode(ctx context.Context, db *pgxpool.Pool, batchSize int) (*BarcodeResult, error) {
    result := &BarcodeResult{}

    // Stream barcodes from DB instead of loading all into memory
    rows, err := db.Query(ctx, `
        SELECT DISTINCT ri.barcode
        FROM retailer_items ri
        WHERE ri.barcode IS NOT NULL AND ri.barcode != ''
        AND NOT EXISTS (
            SELECT 1 FROM product_links pl WHERE pl.retailer_item_id = ri.id
        )
        ORDER BY ri.barcode
    `)
    if err != nil {
        return nil, fmt.Errorf("query barcodes: %w", err)
    }
    defer rows.Close()

    // Process in batches
    batch := make([]string, 0, batchSize)
    for rows.Next() {
        var barcode string
        if err := rows.Scan(&barcode); err != nil {
            continue
        }

        normalized := NormalizeBarcode(barcode)
        if normalized == "" {
            result.Skipped++
            continue
        }

        batch = append(batch, normalized)
        if len(batch) >= batchSize {
            if err := processBarcodesBatch(ctx, db, batch, result); err != nil {
                log.Error("batch failed", "error", err)
            }
            batch = batch[:0]
        }
    }

    // Process remaining
    if len(batch) > 0 {
        if err := processBarcodesBatch(ctx, db, batch, result); err != nil {
            log.Error("final batch failed", "error", err)
        }
    }

    return result, nil
}

func processBarcodesBatch(ctx context.Context, db *pgxpool.Pool, barcodes []string, result *BarcodeResult) error {
    for _, barcode := range barcodes {
        if err := processSingleBarcode(ctx, db, barcode, result); err != nil {
            log.Error("barcode failed", "barcode", barcode[:4]+"...", "error", err)
            // Continue with other barcodes
        }
    }
    return nil
}

// processSingleBarcode - truly race-safe using advisory lock
func processSingleBarcode(ctx context.Context, db *pgxpool.Pool, barcode string, result *BarcodeResult) error {
    return pgx.BeginTxFunc(ctx, db, pgx.TxOptions{}, func(tx pgx.Tx) error {
        // 1. Advisory lock on barcode hash - works BEFORE row exists
        _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, barcode)
        if err != nil {
            return fmt.Errorf("advisory lock: %w", err)
        }

        // 2. Get all items with this barcode
        items, err := getItemsByBarcode(ctx, tx, barcode)
        if err != nil {
            return err
        }
        if len(items) == 0 {
            return nil  // Already processed
        }

        // 3. Check if canonical barcode already exists
        var productID *string
        err = tx.QueryRow(ctx, `
            SELECT product_id FROM canonical_barcodes WHERE barcode = $1
        `, barcode).Scan(&productID)

        if err == pgx.ErrNoRows {
            // 4a. No existing mapping - check sanity before creating
            if flag := checkSuspiciousBarcode(items); flag != "" {
                for _, item := range items {
                    if err := queueForReview(ctx, tx, item.ID, flag); err != nil {
                        return err
                    }
                }
                result.SuspiciousFlags += len(items)
                return nil
            }

            // 4b. Create product and register barcode atomically
            best := pickBestItem(items)
            newProductID, err := createProduct(ctx, tx, best)
            if err != nil {
                return fmt.Errorf("create product: %w", err)
            }

            _, err = tx.Exec(ctx, `
                INSERT INTO canonical_barcodes (barcode, product_id)
                VALUES ($1, $2)
            `, barcode, newProductID)
            if err != nil {
                return fmt.Errorf("register barcode: %w", err)
            }

            productID = &newProductID
            result.NewProducts++
        } else if err != nil {
            return err
        } else if productID == nil {
            // Placeholder row exists but no product yet (shouldn't happen with advisory lock)
            return fmt.Errorf("orphan barcode entry: %s", barcode)
        }

        // 5. Link all items to product
        for _, item := range items {
            _, err := tx.Exec(ctx, `
                INSERT INTO product_links (product_id, retailer_item_id, match_type, confidence, created_at)
                VALUES ($1, $2, 'barcode', 1.0, now())
                ON CONFLICT (retailer_item_id) DO NOTHING
            `, *productID, item.ID)
            if err != nil {
                return err
            }
            result.NewLinks++
        }

        return nil
    })
}

// checkSuspiciousBarcode - includes unit/quantity check
func checkSuspiciousBarcode(items []RetailerItem) string {
    if len(items) < 2 {
        return ""
    }

    // Check name similarity
    names := make([]string, len(items))
    for i, item := range items {
        names[i] = strings.ToLower(RemoveDiacritics(item.Name))
    }

    for i := 1; i < len(names); i++ {
        sim := stringSimilarity(names[0], names[i])
        if sim < 0.3 {
            return "suspicious_barcode_name_mismatch"
        }
    }

    // Check brand conflicts (private labels)
    brands := make(map[string]bool)
    for _, item := range items {
        if item.Brand != "" && !isGenericBrand(item.Brand) {
            brands[strings.ToLower(item.Brand)] = true
        }
    }
    if len(brands) > 1 {
        return "suspicious_barcode_brand_conflict"
    }

    // Check unit/quantity mismatch (e.g., 500ml vs 1.5L)
    units := make(map[string]bool)
    for _, item := range items {
        normalized := NormalizeUnit(item.Unit, item.UnitQuantity)
        if normalized != "" {
            units[normalized] = true
        }
    }
    if len(units) > 1 {
        return "suspicious_barcode_unit_mismatch"
    }

    return ""
}

func isGenericBrand(brand string) bool {
    generic := []string{"n/a", "nepoznato", "unknown", "-", ""}
    b := strings.ToLower(strings.TrimSpace(brand))
    for _, g := range generic {
        if b == g {
            return true
        }
    }
    return false
}
```

### Step 4: AI Matching - 2-Stage with Batching (Go)

**Location:** `services/price-service/internal/matching/ai.go`

```go
package matching

import (
    "context"
    "crypto/sha256"
    "encoding/hex"
    "fmt"

    "github.com/jackc/pgx/v5/pgxpool"
)

type AIMatchResult struct {
    Processed       int
    HighConfidence  int
    QueuedForReview int
    NoMatch         int
    CacheHits       int
}

type AIMatcherConfig struct {
    Provider          EmbeddingProvider
    AutoLinkThreshold float32  // >= this = auto-link (default 0.95)
    ReviewThreshold   float32  // >= this = queue for review (default 0.80)
    BatchSize         int      // Embedding batch size (default 100)
    MaxCandidates     int      // Top-N candidates to store (default 5)
    TrgmPrefilter     int      // Top-N from pg_trgm before embeddings (default 200)
}

func DefaultAIMatcherConfig(provider EmbeddingProvider) AIMatcherConfig {
    return AIMatcherConfig{
        Provider:          provider,
        AutoLinkThreshold: 0.95,
        ReviewThreshold:   0.80,
        BatchSize:         100,
        MaxCandidates:     5,
        TrgmPrefilter:     200,
    }
}

// RunAIMatching - 2-stage: pg_trgm prefilter + embedding rerank
func RunAIMatching(ctx context.Context, db *pgxpool.Pool, cfg AIMatcherConfig, runID string) (*AIMatchResult, error) {
    result := &AIMatchResult{}

    // 1. Get unmatched items (excluding scoped rejections)
    items, err := getUnmatchedItemsForAI(ctx, db)
    if err != nil {
        return nil, err
    }

    // 2. Process in batches
    for i := 0; i < len(items); i += cfg.BatchSize {
        end := i + cfg.BatchSize
        if end > len(items) {
            end = len(items)
        }
        batch := items[i:end]

        if err := processAIBatch(ctx, db, cfg, runID, batch, result); err != nil {
            log.Error("AI batch failed", "error", err)
            // Continue with next batch
        }
    }

    return result, nil
}

func processAIBatch(ctx context.Context, db *pgxpool.Pool, cfg AIMatcherConfig, runID string, items []RetailerItem, result *AIMatchResult) error {
    // 1. Normalize all items and compute text hashes
    texts := make([]string, len(items))
    hashes := make([]string, len(items))
    for i, item := range items {
        texts[i] = normalizeForEmbedding(item)
        hashes[i] = hashText(texts[i])
    }

    // 2. Check embedding cache
    cached, err := getCachedEmbeddings(ctx, db, items, hashes, cfg.Provider.ModelVersion())
    if err != nil {
        return err
    }

    // 3. Generate missing embeddings in batch
    toGenerate := make([]int, 0)
    for i := range items {
        if cached[i] == nil {
            toGenerate = append(toGenerate, i)
        } else {
            result.CacheHits++
        }
    }

    if len(toGenerate) > 0 {
        batchTexts := make([]string, len(toGenerate))
        for i, idx := range toGenerate {
            batchTexts[i] = texts[idx]
        }

        embeddings, err := cfg.Provider.GenerateEmbeddingBatch(ctx, batchTexts)
        if err != nil {
            return fmt.Errorf("generate embeddings: %w", err)
        }

        // Store in cache
        for i, idx := range toGenerate {
            cached[idx] = embeddings[i]
            if err := storeEmbeddingCache(ctx, db, items[idx].ID, embeddings[i], texts[idx], hashes[idx], cfg.Provider.ModelVersion()); err != nil {
                log.Error("cache store failed", "error", err)
            }
        }
    }

    // 4. For each item, run 2-stage matching
    for i, item := range items {
        embedding := cached[i]
        if embedding == nil {
            continue
        }

        // Stage 1: pg_trgm prefilter (cheap, in-DB)
        trgmCandidates, err := getTrgmCandidates(ctx, db, texts[i], cfg.TrgmPrefilter)
        if err != nil {
            log.Error("trgm prefilter failed", "error", err)
            continue
        }

        // Stage 2: Embedding rerank on prefiltered candidates
        candidates, err := rerankWithEmbeddings(ctx, db, embedding, trgmCandidates, cfg.MaxCandidates)
        if err != nil {
            log.Error("embedding rerank failed", "error", err)
            continue
        }

        // 5. Store candidates with versioning
        for rank, cand := range candidates {
            if err := storeCandidateMatch(ctx, db, StoreCandidateParams{
                RetailerItemID:     item.ID,
                CandidateProductID: cand.ProductID,
                Similarity:         cand.Similarity,
                MatchType:          "ai",
                Rank:               rank + 1,
                MatchingRunID:      runID,
                ModelVersion:       cfg.Provider.ModelVersion(),
                NormalizedTextHash: hashes[i],
            }); err != nil {
                log.Error("store candidate failed", "error", err)
            }
        }

        // 6. Decision based on best candidate (excluding scoped rejections)
        best := filterRejections(ctx, db, item.ID, candidates)
        if best == nil || best.Similarity < cfg.ReviewThreshold {
            result.NoMatch++
            continue
        }

        if best.Similarity >= cfg.AutoLinkThreshold && !hasPrivateLabelConflict(item, best.Product) {
            if err := createProductLink(ctx, db, best.ProductID, item.ID, "ai", best.Similarity); err != nil {
                log.Error("auto-link failed", "error", err)
                continue
            }
            result.HighConfidence++
        } else {
            if err := queueForReview(ctx, db, item.ID, "ai_uncertain"); err != nil {
                log.Error("queue failed", "error", err)
                continue
            }
            result.QueuedForReview++
        }

        result.Processed++
    }

    return nil
}

// getUnmatchedItemsForAI - uses scoped rejections, not global block
func getUnmatchedItemsForAI(ctx context.Context, db *pgxpool.Pool) ([]RetailerItem, error) {
    rows, err := db.Query(ctx, `
        SELECT ri.* FROM retailer_items ri
        WHERE NOT EXISTS (
            SELECT 1 FROM product_links pl WHERE pl.retailer_item_id = ri.id
        )
        -- Don't globally exclude rejected items - just filter candidates later
    `)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    // ... scan rows
    return nil, nil
}

// filterRejections removes candidates that were explicitly rejected
func filterRejections(ctx context.Context, db *pgxpool.Pool, itemID string, candidates []Candidate) *Candidate {
    for _, c := range candidates {
        var exists bool
        db.QueryRow(ctx, `
            SELECT EXISTS(
                SELECT 1 FROM product_match_rejections
                WHERE retailer_item_id = $1 AND rejected_product_id = $2
            )
        `, itemID, c.ProductID).Scan(&exists)

        if !exists {
            return &c  // First non-rejected candidate
        }
    }
    return nil
}

// getTrgmCandidates - Stage 1: cheap trigram similarity
func getTrgmCandidates(ctx context.Context, db *pgxpool.Pool, text string, limit int) ([]string, error) {
    // Requires pg_trgm extension
    rows, err := db.Query(ctx, `
        SELECT p.id
        FROM products p
        WHERE similarity(lower(p.name), lower($1)) > 0.1
        ORDER BY similarity(lower(p.name), lower($1)) DESC
        LIMIT $2
    `, text, limit)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var ids []string
    for rows.Next() {
        var id string
        if err := rows.Scan(&id); err != nil {
            continue
        }
        ids = append(ids, id)
    }
    return ids, nil
}

func hashText(text string) string {
    h := sha256.Sum256([]byte(text))
    return hex.EncodeToString(h[:16])  // 32 chars
}
```

### Step 5: Admin Queries - Set-Based (No N+1)

**Location:** `services/price-service/queries/matching.sql`

```sql
-- name: GetPendingMatchesWithCandidates :many
-- Single query instead of N+1
WITH pending AS (
    SELECT q.*
    FROM product_match_queue q
    WHERE q.status = 'pending'
    ORDER BY q.created_at
    LIMIT $1 OFFSET $2
),
candidates AS (
    SELECT
        c.*,
        p.name as product_name,
        p.brand as product_brand,
        p.image_url as product_image,
        ROW_NUMBER() OVER (PARTITION BY c.retailer_item_id ORDER BY c.rank) as rn
    FROM product_match_candidates c
    JOIN products p ON p.id = c.candidate_product_id
    WHERE c.retailer_item_id IN (SELECT retailer_item_id FROM pending)
)
SELECT
    q.id,
    q.status,
    q.created_at,
    q.version,
    ri.id as retailer_item_id,
    ri.name as retailer_item_name,
    ri.barcode as retailer_item_barcode,
    ri.brand as retailer_item_brand,
    ch.name as chain_name,
    ch.slug as chain_slug,
    -- Aggregate candidates as JSON array
    COALESCE(
        json_agg(
            json_build_object(
                'candidateProductId', c.candidate_product_id,
                'similarity', c.similarity,
                'rank', c.rank,
                'productName', c.product_name,
                'productBrand', c.product_brand,
                'productImage', c.product_image,
                'matchType', c.match_type,
                'flags', c.flags
            ) ORDER BY c.rank
        ) FILTER (WHERE c.id IS NOT NULL AND c.rn <= 5),
        '[]'
    ) as candidates
FROM pending q
JOIN retailer_items ri ON ri.id = q.retailer_item_id
JOIN chains ch ON ch.id = ri.chain_id
LEFT JOIN candidates c ON c.retailer_item_id = q.retailer_item_id
GROUP BY q.id, q.status, q.created_at, q.version,
         ri.id, ri.name, ri.barcode, ri.brand,
         ch.name, ch.slug;

-- name: GetPendingMatchCount :one
SELECT COUNT(*) FROM product_match_queue WHERE status = 'pending';

-- name: BulkApproveWithBestCandidate :exec
-- Set-based bulk approve
WITH best_candidates AS (
    SELECT DISTINCT ON (c.retailer_item_id)
        q.id as queue_id,
        q.retailer_item_id,
        c.candidate_product_id
    FROM product_match_queue q
    JOIN product_match_candidates c ON c.retailer_item_id = q.retailer_item_id
    WHERE q.id = ANY($1::text[])
      AND q.status = 'pending'
      AND c.rank = 1
    ORDER BY c.retailer_item_id, c.rank
),
insert_links AS (
    INSERT INTO product_links (product_id, retailer_item_id, match_type, confidence)
    SELECT candidate_product_id, retailer_item_id, 'bulk_approved', 1.0
    FROM best_candidates
    ON CONFLICT (retailer_item_id) DO NOTHING
    RETURNING retailer_item_id
)
UPDATE product_match_queue q
SET status = 'approved',
    decision = 'linked',
    linked_product_id = bc.candidate_product_id,
    reviewed_by = $2,
    reviewed_at = now()
FROM best_candidates bc
WHERE q.id = bc.queue_id;
```

### Step 6: oRPC Routes - Using Set-Based Queries

```typescript
// src/orpc/router/products.ts

import { sql } from 'drizzle-orm';

export const productsRouter = router({
  getPendingMatches: adminProcedure
    .input(z.object({
      limit: z.number().default(20),
      cursor: z.string().optional(),  // Keyset pagination, not offset
    }))
    .query(async ({ input, ctx }) => {
      // Use raw SQL for set-based query with JSON aggregation
      const result = await db.execute(sql`
        WITH pending AS (
          SELECT q.*
          FROM product_match_queue q
          WHERE q.status = 'pending'
            ${input.cursor ? sql`AND q.created_at > ${input.cursor}` : sql``}
          ORDER BY q.created_at
          LIMIT ${input.limit + 1}
        )
        SELECT
          q.id,
          q.status,
          q.created_at,
          q.version,
          json_build_object(
            'id', ri.id,
            'name', ri.name,
            'barcode', ri.barcode,
            'brand', ri.brand,
            'chainName', ch.name,
            'chainSlug', ch.slug
          ) as retailer_item,
          COALESCE(
            (
              SELECT json_agg(
                json_build_object(
                  'productId', c.candidate_product_id,
                  'similarity', c.similarity,
                  'rank', c.rank,
                  'matchType', c.match_type,
                  'flags', c.flags,
                  'product', json_build_object(
                    'id', p.id,
                    'name', p.name,
                    'brand', p.brand,
                    'imageUrl', p.image_url
                  )
                ) ORDER BY c.rank
              )
              FROM product_match_candidates c
              JOIN products p ON p.id = c.candidate_product_id
              WHERE c.retailer_item_id = q.retailer_item_id
                AND c.rank <= 5
            ),
            '[]'
          ) as candidates
        FROM pending q
        JOIN retailer_items ri ON ri.id = q.retailer_item_id
        JOIN chains ch ON ch.id = ri.chain_id
        ORDER BY q.created_at
      `);

      const items = result.rows.slice(0, input.limit);
      const hasMore = result.rows.length > input.limit;
      const nextCursor = hasMore ? items[items.length - 1].created_at : undefined;

      return {
        items,
        nextCursor,
        hasMore,
      };
    }),

  approveMatch: adminProcedure
    .input(z.object({
      queueId: z.string(),
      productId: z.string(),
      notes: z.string().optional(),
      version: z.number(),  // Optimistic locking
    }))
    .mutation(async ({ input, ctx }) => {
      return await db.transaction(async (tx) => {
        // Check version for optimistic locking
        const [queue] = await tx
          .select()
          .from(productMatchQueue)
          .where(and(
            eq(productMatchQueue.id, input.queueId),
            eq(productMatchQueue.version, input.version)
          ))
          .for('update');

        if (!queue) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Queue item was modified by another user. Please refresh.',
          });
        }

        if (queue.status !== 'pending') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Queue item already processed',
          });
        }

        // Create link (unique constraint prevents duplicates)
        await tx.insert(productLinks).values({
          productId: input.productId,
          retailerItemId: queue.retailerItemId,
          matchType: 'manual',
          confidence: 1.0,
        });

        // Update queue with version increment
        await tx.update(productMatchQueue)
          .set({
            status: 'approved',
            decision: 'linked',
            linkedProductId: input.productId,
            reviewedBy: ctx.user.id,
            reviewedAt: new Date(),
            reviewNotes: input.notes,
            version: queue.version + 1,
          })
          .where(eq(productMatchQueue.id, input.queueId));

        // Audit log
        await tx.insert(productMatchAudit).values({
          queueId: input.queueId,
          action: 'approved',
          userId: ctx.user.id,
          previousState: { status: queue.status },
          newState: { status: 'approved', productId: input.productId },
        });

        return { success: true };
      });
    }),

  rejectMatch: adminProcedure
    .input(z.object({
      queueId: z.string(),
      productId: z.string().optional(),  // Specific product rejection
      reason: z.string(),
      version: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      return await db.transaction(async (tx) => {
        const [queue] = await tx
          .select()
          .from(productMatchQueue)
          .where(and(
            eq(productMatchQueue.id, input.queueId),
            eq(productMatchQueue.version, input.version)
          ))
          .for('update');

        if (!queue || queue.status !== 'pending') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Refresh required' });
        }

        if (input.productId) {
          // Scoped rejection - reject specific candidate
          await tx.insert(productMatchRejections).values({
            retailerItemId: queue.retailerItemId,
            rejectedProductId: input.productId,
            reason: input.reason,
            rejectedBy: ctx.user.id,
          }).onConflictDoNothing();

          // Don't change queue status - user can still approve other candidates
        } else {
          // Full rejection - no match exists
          await tx.update(productMatchQueue)
            .set({
              status: 'rejected',
              decision: 'no_match',
              reviewedBy: ctx.user.id,
              reviewedAt: new Date(),
              reviewNotes: input.reason,
              version: queue.version + 1,
            })
            .where(eq(productMatchQueue.id, input.queueId));
        }

        // Audit
        await tx.insert(productMatchAudit).values({
          queueId: input.queueId,
          action: input.productId ? 'rejected_candidate' : 'rejected',
          userId: ctx.user.id,
          newState: { reason: input.reason, productId: input.productId },
        });

        return { success: true };
      });
    }),

  bulkApprove: adminProcedure
    .input(z.object({
      queueIds: z.array(z.string()),
    }))
    .mutation(async ({ input, ctx }) => {
      // Set-based bulk operation
      const result = await db.execute(sql`
        WITH best_candidates AS (
          SELECT DISTINCT ON (q.retailer_item_id)
            q.id as queue_id,
            q.retailer_item_id,
            c.candidate_product_id
          FROM product_match_queue q
          JOIN product_match_candidates c ON c.retailer_item_id = q.retailer_item_id
          WHERE q.id = ANY(${input.queueIds}::text[])
            AND q.status = 'pending'
            AND c.rank = 1
          ORDER BY q.retailer_item_id, c.rank
        ),
        insert_links AS (
          INSERT INTO product_links (product_id, retailer_item_id, match_type, confidence)
          SELECT candidate_product_id, retailer_item_id, 'bulk_approved', 1.0
          FROM best_candidates
          ON CONFLICT (retailer_item_id) DO NOTHING
          RETURNING retailer_item_id
        ),
        update_queue AS (
          UPDATE product_match_queue q
          SET status = 'approved',
              decision = 'linked',
              linked_product_id = bc.candidate_product_id,
              reviewed_by = ${ctx.user.id},
              reviewed_at = now(),
              version = version + 1
          FROM best_candidates bc
          WHERE q.id = bc.queue_id
          RETURNING q.id
        )
        SELECT COUNT(*) as approved FROM update_queue
      `);

      return { approved: result.rows[0]?.approved ?? 0 };
    }),
});
```

---

## File Changes Summary

### Create
| Path | Purpose |
|------|---------|
| `services/price-service/internal/matching/barcode.go` | Race-safe barcode matching |
| `services/price-service/internal/matching/ai.go` | 2-stage AI matching with batching |
| `services/price-service/internal/matching/embedding.go` | Provider abstraction |
| `services/price-service/internal/matching/normalize.go` | Barcode/text normalization |
| `services/price-service/internal/matching/*_test.go` | Unit tests |
| `services/price-service/queries/matching.sql` | sqlc queries |
| `src/components/admin/products/MatchReviewQueue.tsx` | Review list with keyset pagination |
| `src/components/admin/products/MatchReviewCard.tsx` | Review card with scoped rejections |
| `src/components/admin/products/ProductSearch.tsx` | Search component |
| `src/components/admin/products/CreateProductModal.tsx` | Create form |
| `src/orpc/router/products.ts` | Set-based oRPC routes |
| `drizzle/XXXX_add_matching_tables.sql` | Migration |

### Modify
| Path | Changes |
|------|---------|
| `src/db/schema.ts` | Add matching tables, constraints |
| `src/orpc/router/index.ts` | Add products router |
| `services/price-service/internal/api/router.go` | Add matching endpoints |

### Raw SQL Migrations
```sql
-- Required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add unique constraint to product_links
ALTER TABLE product_links
ADD CONSTRAINT product_links_item_uniq UNIQUE (retailer_item_id);

-- Create embedding tables with HNSW indexes
-- (see Step 1 schema comments)
```

---

## Implementation Order

1. **Schema + migrations** - Drizzle tables, raw SQL for pgvector/pg_trgm
2. **Normalization** - Barcode validation, text normalization, diacritics
3. **Barcode matching** - Advisory locks, suspicious detection, tests
4. **Embedding cache** - Store/retrieve embeddings, hash-based invalidation
5. **AI matching** - 2-stage pipeline, batching, scoped rejections
6. **Internal API** - Go endpoints for triggering matching
7. **Admin UI** - Keyset pagination, optimistic locking, bulk actions
8. **Integration tests** - End-to-end, concurrent access
9. **Monitoring** - Match rates, cache hit rates, processing times

---

## Risks Addressed

| Risk | Mitigation |
|------|------------|
| ID type mismatch | All IDs use CUID2 strings |
| Race conditions (rows exist) | `FOR UPDATE` locks |
| Race conditions (rows don't exist) | `pg_advisory_xact_lock` on barcode hash |
| Single candidate per item | Separate candidates table with rank |
| Duplicate candidates | Unique constraint on `(item, candidate)` |
| In-memory embeddings | pgvector + embedding cache tables |
| Rejected matches regenerated | Scoped `product_match_rejections` table |
| Rejection blocks all future matches | Rejections are per-candidate, not global |
| N+1 queries in admin | Set-based queries with JSON aggregation |
| Batch size unused | `GenerateEmbeddingBatch()` in provider |
| Concurrent review conflicts | Optimistic locking with `version` column |
| Audit FK missing | Proper FK to queue table |
| Barcode normalization issues | UPC-A/EAN-13 handling, check digit validation |
| pgvector performance | HNSW index (vs ivfflat), pg_trgm prefilter |
| Candidate staleness | `matching_run_id`, `model_version`, `normalized_text_hash` |
