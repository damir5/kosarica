package matching

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AIMatchResult tracks the outcome of AI matching
type AIMatchResult struct {
	Processed       int
	HighConfidence  int
	QueuedForReview int
	NoMatch         int
	CacheHits       int
}

// AIMatcherConfig configures the AI matching behavior
type AIMatcherConfig struct {
	Provider          EmbeddingProvider
	AutoLinkThreshold float32 // >= this = auto-link (default 0.95)
	ReviewThreshold   float32 // >= this = queue for review (default 0.80)
	BatchSize         int     // Embedding batch size (default 100)
	MaxCandidates     int     // Top-N candidates to store (default 5)
	TrgmPrefilter     int     // Top-N from pg_trgm before embeddings (default 200)
}

// DefaultAIMatcherConfig returns sensible defaults
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

// RunAIMatching runs 2-stage AI matching: pg_trgm prefilter + embedding rerank
func RunAIMatching(ctx context.Context, db *pgxpool.Pool, cfg AIMatcherConfig, runID string) (*AIMatchResult, error) {
	result := &AIMatchResult{}

	// 1. Get unmatched items (excluding already linked items)
	items, err := getUnmatchedItemsForAI(ctx, db, cfg.BatchSize*10) // Process in chunks
	if err != nil {
		return nil, fmt.Errorf("get unmatched items: %w", err)
	}

	if len(items) == 0 {
		return result, nil
	}

	// 2. Process in batches
	for i := 0; i < len(items); i += cfg.BatchSize {
		end := i + cfg.BatchSize
		if end > len(items) {
			end = len(items)
		}
		batch := items[i:end]

		if err := processAIBatch(ctx, db, cfg, runID, batch, result); err != nil {
			slog.Error("AI batch failed", "batch_start", i, "error", err)
			// Continue with next batch
		}
	}

	return result, nil
}

// processAIBatch processes a batch of items through 2-stage matching
func processAIBatch(
	ctx context.Context,
	db *pgxpool.Pool,
	cfg AIMatcherConfig,
	runID string,
	items []RetailerItem,
	result *AIMatchResult,
) error {
	// 1. Normalize all items and compute text hashes
	texts := make([]string, len(items))
	hashes := make([]string, len(items))
	itemIDs := make([]string, len(items))

	for i, item := range items {
		normalized := NormalizeForEmbedding(item.Name, item.Brand, item.Category, item.Unit)
		texts[i] = normalized
		hashes[i] = hashText(normalized)
		itemIDs[i] = item.ID
	}

	// 2. Check embedding cache
	cached, err := getCachedEmbeddings(ctx, db, itemIDs, hashes, cfg.Provider.ModelVersion())
	if err != nil {
		return fmt.Errorf("get cached embeddings: %w", err)
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

		embeddings, err := GenerateWithRetry(ctx, cfg.Provider, batchTexts, DefaultEmbeddingRetryConfig())
		if err != nil {
			return fmt.Errorf("generate embeddings: %w", err)
		}

		// Store in cache
		for i, idx := range toGenerate {
			cached[idx] = embeddings[i]
			if err := storeEmbeddingCache(ctx, db, items[idx].ID, embeddings[i], texts[idx], hashes[idx], cfg.Provider.ModelVersion(), false); err != nil {
				slog.Error("cache store failed", "item_id", items[idx].ID, "error", err)
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
		trgmProductIDs, err := getTrgmCandidates(ctx, db, texts[i], cfg.TrgmPrefilter)
		if err != nil {
			slog.Error("trgm prefilter failed", "error", err)
			continue
		}

		if len(trgmProductIDs) == 0 {
			result.NoMatch++
			continue
		}

		// Get product embeddings
		productEmbeddings, err := getCachedProductEmbeddings(ctx, db, trgmProductIDs, cfg.Provider.ModelVersion())
		if err != nil {
			slog.Error("get product embeddings failed", "error", err)
			continue
		}

		// Stage 2: Embedding rerank on prefiltered candidates
		candidates := rerankWithEmbeddings(embedding, productEmbeddings, trgmProductIDs, cfg.MaxCandidates)

		// 5. Store candidates with versioning
		for rank, cand := range candidates {
			_, err := getProductInfo(ctx, db, cand.ProductID)
			if err != nil {
				slog.Error("get product info failed", "product_id", cand.ProductID, "error", err)
				continue
			}

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
				slog.Error("store candidate failed", "error", err)
			}
		}

		// 6. Decision based on best candidate (excluding scoped rejections)
		best := filterRejections(ctx, db, item.ID, candidates)
		if best == nil || best.Similarity < cfg.ReviewThreshold {
			result.NoMatch++
			continue
		}

		// Check for private label conflict
		if hasPrivateLabelConflict(item, best) {
			if err := queueForReview(ctx, db, item.ID, "ai_private_label_conflict"); err != nil {
				slog.Error("queue failed", "error", err)
			}
			result.QueuedForReview++
			result.Processed++
			continue
		}

		if best.Similarity >= cfg.AutoLinkThreshold {
			if err := createProductLink(ctx, db, best.ProductID, item.ID, "ai", best.Similarity); err != nil {
				slog.Error("auto-link failed", "error", err)
				continue
			}
			result.HighConfidence++
		} else {
			if err := queueForReview(ctx, db, item.ID, "ai_uncertain"); err != nil {
				slog.Error("queue failed", "error", err)
				continue
			}
			result.QueuedForReview++
		}

		result.Processed++
	}

	return nil
}

// getUnmatchedItemsForAI gets items that aren't linked to products
func getUnmatchedItemsForAI(ctx context.Context, db *pgxpool.Pool, limit int) ([]RetailerItem, error) {
	rows, err := db.Query(ctx, `
		SELECT
			ri.id,
			ri.name,
			ri.brand,
			ri.unit,
			ri.unit_quantity,
			ri.category,
			ri.image_url,
			c.slug as chain_slug
		FROM retailer_items ri
		JOIN chains c ON c.slug = ri.chain_slug
		WHERE NOT EXISTS (
			SELECT 1 FROM product_links pl WHERE pl.retailer_item_id = ri.id
		)
		AND NOT EXISTS (
			SELECT 1 FROM product_match_queue pmq WHERE pmq.retailer_item_id = ri.id AND pmq.status = 'pending'
		)
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []RetailerItem
	for rows.Next() {
		var item RetailerItem
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.Brand,
			&item.Unit,
			&item.UnitQuantity,
			&item.Category,
			&item.ImageURL,
			&item.ChainSlug,
		); err != nil {
			slog.Error("scan retailer item row", "error", err)
			continue
		}
		items = append(items, item)
	}

	return items, rows.Err()
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

	return ids, rows.Err()
}

// rerankWithEmbeddings - Stage 2: embedding similarity rerank
func rerankWithEmbeddings(
	itemEmbedding []float32,
	productEmbeddings map[string][]float32,
	productIDs []string,
	maxCandidates int,
) []Candidate {
	candidates := make([]Candidate, 0, len(productIDs))

	for _, productID := range productIDs {
		embedding := productEmbeddings[productID]
		if embedding == nil {
			continue
		}

		similarity := ComputeCosineSimilarity(itemEmbedding, embedding)
		candidates = append(candidates, Candidate{
			ProductID:  productID,
			Similarity: similarity,
		})
	}

	// Sort by similarity descending
	for i := 0; i < len(candidates); i++ {
		for j := i + 1; j < len(candidates); j++ {
			if candidates[j].Similarity > candidates[i].Similarity {
				candidates[i], candidates[j] = candidates[j], candidates[i]
			}
		}
	}

	// Take top N
	if len(candidates) > maxCandidates {
		candidates = candidates[:maxCandidates]
	}

	return candidates
}

// filterRejections removes candidates that were explicitly rejected
func filterRejections(ctx context.Context, db *pgxpool.Pool, itemID string, candidates []Candidate) *Candidate {
	for _, c := range candidates {
		var exists bool
		err := db.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM product_match_rejections
				WHERE retailer_item_id = $1 AND rejected_product_id = $2
			)
		`, itemID, c.ProductID).Scan(&exists)

		if err != nil || !exists {
			return &c // First non-rejected candidate
		}
	}
	return nil
}

// getProductInfo fetches product information
func getProductInfo(ctx context.Context, db *pgxpool.Pool, productID string) (ProductInfo, error) {
	var p ProductInfo
	err := db.QueryRow(ctx, `
		SELECT id, name, brand, category, unit, unit_quantity, image_url
		FROM products WHERE id = $1
	`, productID).Scan(
		&p.ID,
		&p.Name,
		&p.Brand,
		&p.Category,
		&p.Unit,
		&p.UnitQuantity,
		&p.ImageURL,
	)

	return p, err
}

// StoreCandidateParams contains parameters for storing a candidate match
type StoreCandidateParams struct {
	RetailerItemID     string
	CandidateProductID string
	Similarity         float32
	MatchType          string
	Rank               int
	MatchingRunID      string
	ModelVersion       string
	NormalizedTextHash string
}

// storeCandidateMatch stores a candidate match in the database
func storeCandidateMatch(ctx context.Context, db *pgxpool.Pool, params StoreCandidateParams) error {
	// Convert similarity to string for storage (PostgreSQL real type)
	similarityStr := fmt.Sprintf("%.6f", params.Similarity)

	_, err := db.Exec(ctx, `
		INSERT INTO product_match_candidates (
			id, retailer_item_id, candidate_product_id, similarity, match_type, rank,
			matching_run_id, model_version, normalized_text_hash, created_at
		)
		VALUES (
			gen_random_text(), $1, $2, $3::real, $4, $5, $6, $7, $8, now()
		)
		ON CONFLICT (retailer_item_id, candidate_product_id)
		DO UPDATE SET
			similarity = EXCLUDED.similarity,
			rank = EXCLUDED.rank,
			matching_run_id = EXCLUDED.matching_run_id,
			model_version = EXCLUDED.model_version
	`, params.RetailerItemID, params.CandidateProductID, similarityStr, params.MatchType,
		params.Rank, params.MatchingRunID, params.ModelVersion, params.NormalizedTextHash)

	return err
}

// DBExecutor is an interface that matches both pgx.Tx and *pgxpool.Pool
// allowing functions to accept either a transaction or a connection pool
type DBExecutor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// createProductLink creates a link between a retailer item and a product
func createProductLink(ctx context.Context, db DBExecutor, productID, itemID, matchType string, confidence float32) error {
	confidenceStr := fmt.Sprintf("%.6f", confidence)

	_, err := db.Exec(ctx, `
		INSERT INTO product_links (id, product_id, retailer_item_id, match_type, confidence, created_at)
		VALUES (gen_random_text(), $1, $2, $3, $4::real, now())
		ON CONFLICT (retailer_item_id) DO NOTHING
	`, productID, itemID, matchType, confidenceStr)

	return err
}

// hasPrivateLabelConflict checks if there's a private label brand conflict
func hasPrivateLabelConflict(item RetailerItem, candidate *Candidate) bool {
	// Both have specific, different brands
	if item.Brand != "" && !isGenericBrand(item.Brand) &&
		candidate.Product.Brand != "" && !isGenericBrand(candidate.Product.Brand) {

		itemBrand := strings.ToLower(RemoveDiacritics(item.Brand))
		candidateBrand := strings.ToLower(RemoveDiacritics(candidate.Product.Brand))

		if itemBrand != candidateBrand {
			return true
		}
	}
	return false
}
