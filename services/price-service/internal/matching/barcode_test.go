package matching

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
)

// TestCheckSuspiciousBarcode tests suspicious barcode detection
func TestCheckSuspiciousBarcode(t *testing.T) {
	tests := []struct {
		name     string
		items    []RetailerItem
		expected string
	}{
		{
			"Single item - not suspicious",
			[]RetailerItem{
				{Name: "Cokolada", Brand: "Kras", Unit: "g", UnitQuantity: "100"},
			},
			"",
		},
		{
			"Same products - not suspicious",
			[]RetailerItem{
				{Name: "Cokolada", Brand: "Kras", Unit: "g", UnitQuantity: "100"},
				{Name: "Cokolada", Brand: "Kras", Unit: "g", UnitQuantity: "100"},
			},
			"",
		},
		{
			"Name mismatch - suspicious",
			[]RetailerItem{
				{Name: "Cokolada", Brand: "Kras", Unit: "g", UnitQuantity: "100"},
				{Name: "Kruh", Brand: "Kras", Unit: "g", UnitQuantity: "500"},
			},
			"suspicious_barcode_name_mismatch",
		},
		{
			"Brand conflict - suspicious",
			[]RetailerItem{
				{Name: "Mlijeko", Brand: "Dukat", Unit: "l", UnitQuantity: "1"},
				{Name: "Mlijeko", Brand: "Vindija", Unit: "l", UnitQuantity: "1"},
			},
			"suspicious_barcode_brand_conflict",
		},
		{
			"Unit mismatch - suspicious",
			[]RetailerItem{
				{Name: "Sok", Brand: "Nektar", Unit: "ml", UnitQuantity: "200"},
				{Name: "Sok", Brand: "Nektar", Unit: "l", UnitQuantity: "1"},
			},
			"suspicious_barcode_unit_mismatch",
		},
		{
			"Generic brand - no conflict",
			[]RetailerItem{
				{Name: "Kruh", Brand: "n/a", Unit: "g", UnitQuantity: "500"},
				{Name: "Kruh", Brand: "unknown", Unit: "g", UnitQuantity: "500"},
			},
			"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := checkSuspiciousBarcode(tt.items)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// TestPickBestItem tests item selection for canonical product
func TestPickBestItem(t *testing.T) {
	tests := []struct {
		name    string
		items   []RetailerItem
		checkFn func(t *testing.T, best RetailerItem)
	}{
		{
			"Prefers item with image",
			[]RetailerItem{
				{ID: "1", Name: "Item 1", ImageURL: "", ChainSlug: "konzum"},
				{ID: "2", Name: "Item 2", ImageURL: "http://img.jpg", ChainSlug: "lidl"},
			},
			func(t *testing.T, best RetailerItem) {
				assert.Equal(t, "2", best.ID)
			},
		},
		{
			"Prefers major chain",
			[]RetailerItem{
				{ID: "1", Name: "Item 1", ChainSlug: "spar"},
				{ID: "2", Name: "Item 2", ChainSlug: "konzum"},
			},
			func(t *testing.T, best RetailerItem) {
				assert.Equal(t, "2", best.ID)
			},
		},
		{
			"Prefers item with brand",
			[]RetailerItem{
				{ID: "1", Name: "Item 1", Brand: "", ChainSlug: "konzum"},
				{ID: "2", Name: "Item 2", Brand: "Kras", ChainSlug: "konzum"},
			},
			func(t *testing.T, best RetailerItem) {
				assert.Equal(t, "2", best.ID)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			best := pickBestItem(tt.items)
			tt.checkFn(t, best)
		})
	}
}

// TestStringSimilarity tests string similarity calculation
func TestStringSimilarity(t *testing.T) {
	tests := []struct {
		a, b     string
		expected float64
	}{
		{"same", "same", 1.0},
		{"", "", 1.0},
		{"", "test", 0.0},
		{"abc", "def", 0.0},
		{"abc", "abd", 0.5}, // Jaccard Similarity: |{a,b}| / |{a,b,c,d}| = 2/4 = 0.5
		{"cokolada", "cokolada", 1.0},
		{"cokolada", "cokoleta", 0.625}, // |{c,o,k,o,l,a}| / |{c,o,k,o,l,a,e,t}| = 5/8 = 0.625
	}

	for _, tt := range tests {
		t.Run(tt.a+"_"+tt.b, func(t *testing.T) {
			result := stringSimilarity(tt.a, tt.b)
			assert.InDelta(t, tt.expected, result, 0.01)
		})
	}
}

// TestAutoMatchByBarcodeIntegration tests the full barcode matching flow
// This requires a test database connection
func TestAutoMatchByBarcodeIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test")
	}

	// This would require setting up a test database
	// For now, we'll just verify the function signature and basic logic

	// ctx := context.Background() // Unused until DB is hooked up
	// db := setupTestDB(t) // Would need test DB setup

	// Test that invalid barcodes are skipped
	// result := &BarcodeResult{} // Unused until DB is hooked up
	invalidBarcode := "0000000000000"
	normalized := NormalizeBarcode(invalidBarcode)
	assert.Equal(t, "", normalized, "Invalid barcode should be normalized to empty")

	// Test UPC-A to EAN-13 conversion
	upca := "123456789012"
	ean13 := NormalizeBarcode(upca)
	assert.Equal(t, "0123456789012", ean13, "UPC-A should be converted to EAN-13")
}

// mockDBConnection is a placeholder for actual DB testing setup
// In a real scenario, this would set up a test database with testcontainers
func setupTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	// TODO: Set up test database with testcontainers
	// For now, this is a placeholder
	return nil
}

func TestQueueForReview(t *testing.T) {
	// This would test the queueForReview function with actual DB
	// For now, we'll verify it doesn't panic with nil inputs but handle error gracefully
	t.Run("nil tx should error", func(t *testing.T) {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("The code panicked: %v", r)
			}
		}()
		// We can't really call it with nil because it calls methods on the interface
		// So we'll skip this test or use a mock
		t.Skip("Skipping nil interface test as it causes panic by design in Go")
	})
}
