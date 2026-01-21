package matching

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// EmbeddingProvider defines the interface for AI embedding generation
// Implementations can use OpenAI, Anthropic, local models, etc.
type EmbeddingProvider interface {
	// GenerateEmbeddingBatch generates embeddings for multiple texts in a single API call
	// Batch requests are more efficient than individual calls
	GenerateEmbeddingBatch(ctx context.Context, texts []string) ([][]float32, error)

	// ModelVersion returns the model identifier (e.g., "text-embedding-3-small")
	// Used for cache invalidation when models change
	ModelVersion() string

	// Dimension returns the embedding vector dimension
	Dimension() int
}

// CachedEmbedding represents a stored embedding with metadata
type CachedEmbedding struct {
	ID             string
	Embedding      []float32
	ModelVersion   string
	NormalizedText string
	NormalizedHash string
	CreatedAt      time.Time
}

// getCachedEmbeddings retrieves embeddings from the database cache
// Returns nil for items that aren't cached
func getCachedEmbeddings(
	ctx context.Context,
	db *pgxpool.Pool,
	itemIDs []string,
	hashes []string,
	modelVersion string,
) ([][]float32, error) {
	if len(itemIDs) != len(hashes) {
		return nil, fmt.Errorf("itemIDs and hashes must have same length")
	}

	// Map to track which items we need
	result := make([][]float32, len(itemIDs))
	idsToFetch := make([]string, 0, len(itemIDs))
	indexMap := make(map[string]int) // itemID -> index in original slice

	for i, id := range itemIDs {
		indexMap[id] = i
		idsToFetch = append(idsToFetch, id)
	}

	// Query in batches
	rows, err := db.Query(ctx, `
		SELECT
			retailer_item_id,
			embedding,
			model_version,
			normalized_text_hash
		FROM retailer_item_embeddings
		WHERE retailer_item_id = ANY($1)
	`, idsToFetch)
	if err != nil {
		return nil, fmt.Errorf("query embeddings: %w", err)
	}
	defer rows.Close()

	// Scan results
	for rows.Next() {
		var itemID string
		var embedding []float32
		var model string
		var hash string

		if err := rows.Scan(&itemID, &embedding, &model, &hash); err != nil {
			slog.Error("scan embedding row", "error", err)
			continue
		}

		// Verify model version matches (cache invalidation)
		if model != modelVersion {
			// Model changed, don't use this cached embedding
			continue
		}

		// Verify hash matches (text changed, don't use)
		idx := indexMap[itemID]
		if hash != hashes[idx] {
			continue
		}

		result[idx] = embedding
	}

	if rows.Err() != nil {
		return nil, fmt.Errorf("iterate embedding rows: %w", rows.Err())
	}

	return result, nil
}

// getCachedProductEmbeddings retrieves product embeddings from cache
func getCachedProductEmbeddings(
	ctx context.Context,
	db *pgxpool.Pool,
	productIDs []string,
	modelVersion string,
) (map[string][]float32, error) {
	result := make(map[string][]float32)

	rows, err := db.Query(ctx, `
		SELECT product_id, embedding, model_version
		FROM product_embeddings
		WHERE product_id = ANY($1)
	`, productIDs)
	if err != nil {
		return nil, fmt.Errorf("query product embeddings: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var productID string
		var embedding []float32
		var model string

		if err := rows.Scan(&productID, &embedding, &model); err != nil {
			slog.Error("scan product embedding row", "error", err)
			continue
		}

		// Verify model version
		if model != modelVersion {
			continue
		}

		result[productID] = embedding
	}

	return result, nil
}

// storeEmbeddingCache stores an embedding in the database cache
func storeEmbeddingCache(
	ctx context.Context,
	db *pgxpool.Pool,
	itemID string,
	embedding []float32,
	normalizedText,
	hash,
	modelVersion string,
	isProduct bool,
) error {
	table := "retailer_item_embeddings"
	idCol := "retailer_item_id"

	if isProduct {
		table = "product_embeddings"
		idCol = "product_id"
	}

	_, err := db.Exec(ctx, `
		INSERT INTO `+table+` (`+idCol+`, embedding, model_version, normalized_text, normalized_text_hash, created_at)
		VALUES ($1, $2, $3, $4, $5, now())
		ON CONFLICT (`+idCol+`) DO UPDATE SET
			embedding = EXCLUDED.embedding,
			model_version = EXCLUDED.model_version,
			normalized_text = EXCLUDED.normalized_text,
			normalized_text_hash = EXCLUDED.normalized_text_hash,
			created_at = now()
	`, itemID, embedding, modelVersion, normalizedText, hash)

	if err != nil {
		return fmt.Errorf("store embedding cache: %w", err)
	}

	return nil
}

// hashText creates a SHA-256 hash of text for cache invalidation
// Returns first 16 bytes (32 hex chars) for efficient comparison
func hashText(text string) string {
	h := sha256.Sum256([]byte(text))
	return hex.EncodeToString(h[:16])
}

// EmbeddingRetryConfig configures retry behavior for embedding API calls
type EmbeddingRetryConfig struct {
	MaxRetries    int
	InitialDelay  time.Duration
	MaxDelay      time.Duration
	BackoffFactor float64
}

// DefaultEmbeddingRetryConfig returns sensible retry defaults
func DefaultEmbeddingRetryConfig() EmbeddingRetryConfig {
	return EmbeddingRetryConfig{
		MaxRetries:    3,
		InitialDelay:  500 * time.Millisecond,
		MaxDelay:      10 * time.Second,
		BackoffFactor: 2.0,
	}
}

// GenerateWithRetry generates embeddings with exponential backoff retry
func GenerateWithRetry(
	ctx context.Context,
	provider EmbeddingProvider,
	texts []string,
	config EmbeddingRetryConfig,
) ([][]float32, error) {
	var lastErr error

	for attempt := 0; attempt <= config.MaxRetries; attempt++ {
		if attempt > 0 {
			delay := time.Duration(float64(config.InitialDelay) * float64(uint(1)<<uint(attempt-1)))
			if delay > config.MaxDelay {
				delay = config.MaxDelay
			}

			slog.Warn("embedding generation retry",
				"attempt", attempt,
				"delay", delay,
				"error", lastErr)

			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(delay):
			}
		}

		embeddings, err := provider.GenerateEmbeddingBatch(ctx, texts)
		if err == nil {
			return embeddings, nil
		}

		lastErr = err

		// Don't retry on context cancellation or invalid input
		if ctx.Err() != nil {
			return nil, err
		}
	}

	return nil, fmt.Errorf("embedding generation failed after %d attempts: %w", config.MaxRetries, lastErr)
}

// EnsureProductEmbeddings ensures all products have embeddings cached
// Used to warm up the cache before matching
func EnsureProductEmbeddings(
	ctx context.Context,
	db *pgxpool.Pool,
	provider EmbeddingProvider,
) error {
	// Get products without embeddings for current model version
	rows, err := db.Query(ctx, `
		SELECT p.id, p.name, p.brand, p.category, p.unit
		FROM products p
		WHERE NOT EXISTS (
			SELECT 1 FROM product_embeddings pe
			WHERE pe.product_id = p.id AND pe.model_version = $1
		)
		LIMIT 1000
	`, provider.ModelVersion())
	if err != nil {
		return fmt.Errorf("query products: %w", err)
	}
	defer rows.Close()

	type productInfo struct {
		ID       string
		Name     string
		Brand    string
		Category string
		Unit     string
	}

	products := []productInfo{}
	for rows.Next() {
		var p productInfo
		if err := rows.Scan(&p.ID, &p.Name, &p.Brand, &p.Category, &p.Unit); err != nil {
			slog.Error("scan product row", "error", err)
			continue
		}
		products = append(products, p)
	}

	if rows.Err() != nil {
		return fmt.Errorf("iterate product rows: %w", rows.Err())
	}

	// Generate and cache embeddings
	batchSize := 100
	for i := 0; i < len(products); i += batchSize {
		end := i + batchSize
		if end > len(products) {
			end = len(products)
		}
		batch := products[i:end]

		texts := make([]string, len(batch))
		hashes := make([]string, len(batch))
		for j, p := range batch {
			normalized := NormalizeForEmbedding(p.Name, p.Brand, p.Category, p.Unit)
			texts[j] = normalized
			hashes[j] = hashText(normalized)
		}

		embeddings, err := GenerateWithRetry(ctx, provider, texts, DefaultEmbeddingRetryConfig())
		if err != nil {
			return fmt.Errorf("generate embeddings: %w", err)
		}

		for j, p := range batch {
			if err := storeEmbeddingCache(ctx, db, p.ID, embeddings[j], texts[j], hashes[j], provider.ModelVersion(), true); err != nil {
				slog.Error("store product embedding", "product_id", p.ID, "error", err)
			}
		}

		slog.Info("cached product embeddings", "count", len(batch))
	}

	return nil
}

// ComputeCosineSimilarity computes cosine similarity between two vectors
func ComputeCosineSimilarity(a, b []float32) float32 {
	if len(a) != len(b) {
		return 0
	}

	var dotProduct float32
	var normA float32
	var normB float32

	for i := range a {
		dotProduct += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}

	if normA == 0 || normB == 0 {
		return 0
	}

	return dotProduct / (sqrt32(normA) * sqrt32(normB))
}

// sqrt32 computes square root for float32
func sqrt32(x float32) float32 {
	return float32(sqrt(float64(x)))
}

// sqrt is a simple square root implementation
func sqrt(x float64) float64 {
	// Newton's method
	z := 1.0
	for i := 0; i < 10; i++ {
		z -= (z*z - x) / (2 * z)
	}
	return z
}

// Candidate represents a potential product match
type Candidate struct {
	ProductID   string
	Similarity  float32
	ProductName string
	Product     ProductInfo
}

// ProductInfo contains product information
type ProductInfo struct {
	ID           string
	Name         string
	Brand        string
	Category     string
	Unit         string
	UnitQuantity string
	ImageURL     string
}
