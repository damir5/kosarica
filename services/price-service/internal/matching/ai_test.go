package matching

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestComputeCosineSimilarity tests the cosine similarity calculation
func TestComputeCosineSimilarity(t *testing.T) {
	tests := []struct {
		name     string
		a        []float32
		b        []float32
		expected float32
	}{
		{
			"Identical vectors",
			[]float32{1, 2, 3},
			[]float32{1, 2, 3},
			1.0,
		},
		{
			"Orthogonal vectors",
			[]float32{1, 0, 0},
			[]float32{0, 1, 0},
			0.0,
		},
		{
			"Opposite vectors",
			[]float32{1, 1, 1},
			[]float32{-1, -1, -1},
			-1.0,
		},
		{
			"Similar vectors",
			[]float32{1, 2, 3},
			[]float32{1, 2, 4},
			// Cosine similarity should be high but not 1
			0.99146,
		},
		{
			"Zero vector",
			[]float32{0, 0, 0},
			[]float32{1, 2, 3},
			0.0,
		},
		{
			"Different lengths",
			[]float32{1, 2},
			[]float32{1, 2, 3},
			0.0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ComputeCosineSimilarity(tt.a, tt.b)
			// Always use delta for float comparison
			assert.InDelta(t, float64(tt.expected), float64(result), 0.00001)
		})
	}
}

// TestRerankWithEmbeddings tests candidate reranking
func TestRerankWithEmbeddings(t *testing.T) {
	itemEmbedding := []float32{1, 2, 3}
	productEmbeddings := map[string][]float32{
		"p1": {1, 2, 3},    // identical
		"p2": {1, 2, 4},    // similar
		"p3": {0, 1, 0},    // different
		"p4": {-1, -2, -3}, // opposite
	}
	productIDs := []string{"p3", "p1", "p4", "p2"} // not in order

	candidates := rerankWithEmbeddings(itemEmbedding, productEmbeddings, productIDs, 3)

	// Should return top 3 by similarity
	assert.Len(t, candidates, 3)
	assert.Equal(t, "p1", candidates[0].ProductID) // Most similar
	assert.Equal(t, "p2", candidates[1].ProductID)
	assert.Equal(t, "p3", candidates[2].ProductID)
	assert.Greater(t, candidates[0].Similarity, candidates[1].Similarity)
	assert.Greater(t, candidates[1].Similarity, candidates[2].Similarity)
}

// TestHasPrivateLabelConflict tests private label conflict detection
func TestHasPrivateLabelConflict(t *testing.T) {
	tests := []struct {
		name      string
		item      RetailerItem
		candidate *Candidate
		expected  bool
	}{
		{
			"Same brand - no conflict",
			RetailerItem{Brand: "Kras"},
			&Candidate{Product: ProductInfo{Brand: "Kras"}},
			false,
		},
		{
			"Different brands - conflict",
			RetailerItem{Brand: "Kras"},
			&Candidate{Product: ProductInfo{Brand: "Podravka"}},
			true,
		},
		{
			"Generic item brand - no conflict",
			RetailerItem{Brand: "n/a"},
			&Candidate{Product: ProductInfo{Brand: "Kras"}},
			false,
		},
		{
			"Generic candidate brand - no conflict",
			RetailerItem{Brand: "Kras"},
			&Candidate{Product: ProductInfo{Brand: "unknown"}},
			false,
		},
		{
			"Both generic - no conflict",
			RetailerItem{Brand: "n/a"},
			&Candidate{Product: ProductInfo{Brand: "unknown"}},
			false,
		},
		{
			"No brands - no conflict",
			RetailerItem{Brand: ""},
			&Candidate{Product: ProductInfo{Brand: ""}},
			false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := hasPrivateLabelConflict(tt.item, tt.candidate)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// TestHashText tests text hashing for cache invalidation
func TestHashText(t *testing.T) {
	tests := []struct {
		name     string
		text     string
		expected int // length of hash
	}{
		{"Simple text", "hello world", 32},
		{"Empty string", "", 32},
		{"Special chars", "Čokolada Špagete", 32},
		{"Long text", "a very long text that should still produce 32 char hash", 32},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := hashText(tt.text)
			assert.Len(t, result, tt.expected)
			// Same input should produce same hash
			result2 := hashText(tt.text)
			assert.Equal(t, result, result2)
		})
	}
}

// TestDefaultAIMatcherConfig tests default configuration
func TestDefaultAIMatcherConfig(t *testing.T) {
	mockProvider := &mockEmbeddingProvider{}

	cfg := DefaultAIMatcherConfig(mockProvider)

	assert.Equal(t, mockProvider, cfg.Provider)
	assert.Equal(t, float32(0.95), cfg.AutoLinkThreshold)
	assert.Equal(t, float32(0.80), cfg.ReviewThreshold)
	assert.Equal(t, 100, cfg.BatchSize)
	assert.Equal(t, 5, cfg.MaxCandidates)
	assert.Equal(t, 200, cfg.TrgmPrefilter)
}

// Mock implementation for testing
type mockEmbeddingProvider struct{}

func (m *mockEmbeddingProvider) GenerateEmbeddingBatch(ctx context.Context, texts []string) ([][]float32, error) {
	result := make([][]float32, len(texts))
	for i := range texts {
		result[i] = []float32{1, 2, 3}
	}
	return result, nil
}

func (m *mockEmbeddingProvider) ModelVersion() string {
	return "mock-v1"
}

func (m *mockEmbeddingProvider) Dimension() int {
	return 3
}

// TestDefaultEmbeddingRetryConfig tests retry configuration
func TestDefaultEmbeddingRetryConfig(t *testing.T) {
	cfg := DefaultEmbeddingRetryConfig()

	assert.Equal(t, 3, cfg.MaxRetries)
	assert.Greater(t, int64(cfg.InitialDelay), int64(0))
	assert.Greater(t, int64(cfg.MaxDelay), int64(cfg.InitialDelay))
	assert.Greater(t, cfg.BackoffFactor, 1.0)
}
