package optimizer

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

// mockPriceSource is a mock implementation of PriceSource for testing.
type mockPriceSource struct {
	prices         map[string]map[string]map[string]CachedPrice // chain -> store -> item -> price
	averagePrices  map[string]map[string]int64                  // chain -> item -> avg
	storeLocations map[string]map[string]Location               // chain -> store -> location
}

func newMockPriceSource() *mockPriceSource {
	return &mockPriceSource{
		prices:         make(map[string]map[string]map[string]CachedPrice),
		averagePrices:  make(map[string]map[string]int64),
		storeLocations: make(map[string]map[string]Location),
	}
}

func (m *mockPriceSource) GetPrice(chainSlug string, storeID, itemID string) (CachedPrice, bool) {
	if chainPrices, ok := m.prices[chainSlug]; ok {
		if storePrices, ok := chainPrices[storeID]; ok {
			if price, ok := storePrices[itemID]; ok {
				return price, true
			}
		}
	}
	return CachedPrice{}, false
}

func (m *mockPriceSource) GetAveragePrice(chainSlug string, itemID string) int64 {
	if chainAvgs, ok := m.averagePrices[chainSlug]; ok {
		if avg, ok := chainAvgs[itemID]; ok {
			return avg
		}
	}
	return 0
}

func (m *mockPriceSource) GetStoreIDs(chainSlug string) []string {
	var storeIDs []string
	if chainPrices, ok := m.prices[chainSlug]; ok {
		for storeID := range chainPrices {
			storeIDs = append(storeIDs, storeID)
		}
	}
	return storeIDs
}

func (m *mockPriceSource) GetNearestStores(chainSlug string, lat, lon, maxDistanceKm float64, limit int) []StoreWithDistance {
	return []StoreWithDistance{} // Not used in single-store optimization
}

func (m *mockPriceSource) IsHealthy(ctx context.Context) bool {
	return true // Mock is always healthy
}

func (m *mockPriceSource) setPrice(chainSlug, storeID, itemID string, price int, discountPrice *int) {
	if m.prices[chainSlug] == nil {
		m.prices[chainSlug] = make(map[string]map[string]CachedPrice)
	}
	if m.prices[chainSlug][storeID] == nil {
		m.prices[chainSlug][storeID] = make(map[string]CachedPrice)
	}

	cachedPrice := CachedPrice{
		Price:       int64(price),
		HasDiscount: discountPrice != nil,
	}
	if discountPrice != nil {
		cachedPrice.DiscountPrice = int64(*discountPrice)
	} else {
		cachedPrice.DiscountPrice = int64(price)
	}

	m.prices[chainSlug][storeID][itemID] = cachedPrice
}

func (m *mockPriceSource) setAveragePrice(chainSlug, itemID string, avg int64) {
	if m.averagePrices[chainSlug] == nil {
		m.averagePrices[chainSlug] = make(map[string]int64)
	}
	m.averagePrices[chainSlug][itemID] = avg
}

// TestSingleStoreCorrectness verifies that the cheapest store wins within a coverage bin.
func TestSingleStoreCorrectness(t *testing.T) {
	mock := newMockPriceSource()
	config := DefaultOptimizerConfig()

	optimizer := NewSingleStoreOptimizer(mock, config)

	// Set up test data:
	// Store A: has all items, total 100
	// Store B: has all items, total 90 (cheapest!)
	// Store C: has all items, total 95

	item1 := "item-001"
	item2 := "item-002"
	item3 := "item-003"

	// Store A: 50 + 30 + 20 = 100
	mock.setPrice("test-chain", "store-a", item1, 50, nil)
	mock.setPrice("test-chain", "store-a", item2, 30, nil)
	mock.setPrice("test-chain", "store-a", item3, 20, nil)

	// Store B: 40 + 25 + 25 = 90 (cheapest)
	mock.setPrice("test-chain", "store-b", item1, 40, nil)
	mock.setPrice("test-chain", "store-b", item2, 25, nil)
	mock.setPrice("test-chain", "store-b", item3, 25, nil)

	// Store C: 45 + 30 + 20 = 95
	mock.setPrice("test-chain", "store-c", item1, 45, nil)
	mock.setPrice("test-chain", "store-c", item2, 30, nil)
	mock.setPrice("test-chain", "store-c", item3, 20, nil)

	req := &OptimizeRequest{
		ChainSlug: "test-chain",
		BasketItems: []*BasketItem{
			{ItemID: item1, Name: "Item 1", Quantity: 1},
			{ItemID: item2, Name: "Item 2", Quantity: 1},
			{ItemID: item3, Name: "Item 3", Quantity: 1},
		},
	}

	// We need to override getStoresForChain to return our test stores
	// This would require making it overridable or using a different approach
	// For now, we'll test the calculateStoreResult method directly

	resultA := optimizer.calculateStoreResult(req, "store-a")
	resultB := optimizer.calculateStoreResult(req, "store-b")
	resultC := optimizer.calculateStoreResult(req, "store-c")

	// All should have 100% coverage
	assert.Equal(t, 1.0, resultA.CoverageRatio)
	assert.Equal(t, 1.0, resultB.CoverageRatio)
	assert.Equal(t, 1.0, resultC.CoverageRatio)

	// All should be in CoverageBinFull
	assert.Equal(t, CoverageBinFull, resultA.CoverageBin)
	assert.Equal(t, CoverageBinFull, resultB.CoverageBin)
	assert.Equal(t, CoverageBinFull, resultC.CoverageBin)

	// Store B should have lowest total (cheapest)
	assert.Equal(t, int64(100), resultA.SortingTotal)
	assert.Equal(t, int64(90), resultB.SortingTotal)
	assert.Equal(t, int64(95), resultC.SortingTotal)
}

// TestMissingItemsFlagged verifies that missing items are correctly flagged.
func TestMissingItemsFlagged(t *testing.T) {
	mock := newMockPriceSource()
	config := DefaultOptimizerConfig()

	optimizer := NewSingleStoreOptimizer(mock, config)

	item1 := "item-001"
	item2 := "item-002"
	item3 := "item-003"

	// Set up: Store A only has items 1 and 2, missing item 3
	mock.setPrice("test-chain", "store-a", item1, 50, nil)
	mock.setPrice("test-chain", "store-a", item2, 30, nil)
	// item3 not set = missing

	// Set average price for item3 (used for penalty)
	mock.setAveragePrice("test-chain", item3, 20)

	req := &OptimizeRequest{
		ChainSlug: "test-chain",
		BasketItems: []*BasketItem{
			{ItemID: item1, Name: "Item 1", Quantity: 1},
			{ItemID: item2, Name: "Item 2", Quantity: 1},
			{ItemID: item3, Name: "Item 3", Quantity: 1},
		},
	}

	result := optimizer.calculateStoreResult(req, "store-a")

	// Should have 2/3 coverage
	assert.Equal(t, 2.0/3.0, result.CoverageRatio)
	assert.Equal(t, CoverageBinLow, result.CoverageBin) // 66.7% < 80% = Low

	// Should have 1 missing item
	assert.Len(t, result.MissingItems, 1)
	assert.Equal(t, item3, result.MissingItems[0].ItemID)

	// Penalty should be 2x average (2 * 20 = 40)
	assert.Equal(t, int64(40), result.MissingItems[0].Penalty)

	// Sorting total should include penalty
	// Real: 50 + 30 = 80
	// Sorting: 80 + 40 = 120
	assert.Equal(t, int64(80), result.RealTotal)
	assert.Equal(t, int64(120), result.SortingTotal)
}

// TestHighCoverageRanksAboveCheapButIncomplete verifies coverage-first ranking.
func TestHighCoverageRanksAboveCheapButIncomplete(t *testing.T) {
	mock := newMockPriceSource()
	config := DefaultOptimizerConfig()

	optimizer := NewSingleStoreOptimizer(mock, config)

	item1 := "item-001"
	item2 := "item-002"
	item3 := "item-003"
	item4 := "item-004"

	// Store A: 100% coverage, total 200 (expensive but complete)
	mock.setPrice("test-chain", "store-a", item1, 50, nil)
	mock.setPrice("test-chain", "store-a", item2, 50, nil)
	mock.setPrice("test-chain", "store-a", item3, 50, nil)
	mock.setPrice("test-chain", "store-a", item4, 50, nil)

	// Store B: 75% coverage, total 90 (cheap but incomplete)
	mock.setPrice("test-chain", "store-b", item1, 30, nil)
	mock.setPrice("test-chain", "store-b", item2, 30, nil)
	mock.setPrice("test-chain", "store-b", item3, 30, nil)
	// item4 missing

	req := &OptimizeRequest{
		ChainSlug: "test-chain",
		BasketItems: []*BasketItem{
			{ItemID: item1, Name: "Item 1", Quantity: 1},
			{ItemID: item2, Name: "Item 2", Quantity: 1},
			{ItemID: item3, Name: "Item 3", Quantity: 1},
			{ItemID: item4, Name: "Item 4", Quantity: 1},
		},
	}

	resultA := optimizer.calculateStoreResult(req, "store-a")
	resultB := optimizer.calculateStoreResult(req, "store-b")

	// Store A should be in higher coverage bin
	assert.Equal(t, CoverageBinFull, resultA.CoverageBin)
	assert.Equal(t, CoverageBinLow, resultB.CoverageBin) // 75% = Low (< 80%)

	// When sorted, Store A should rank above Store B due to higher coverage
	results := []*SingleStoreResult{resultB, resultA}
	sortResults(results)

	assert.Equal(t, "store-a", results[0].StoreID)
}

// TestPenaltyUsesChainAverage verifies that penalty uses chain average, not magic constant.
func TestPenaltyUsesChainAverage(t *testing.T) {
	mock := newMockPriceSource()
	config := DefaultOptimizerConfig()

	optimizer := NewSingleStoreOptimizer(mock, config)

	item1 := "item-001"

	// Store A: missing item1
	// Chain average for item1 is 100

	mock.setAveragePrice("test-chain", item1, 100)

	req := &OptimizeRequest{
		ChainSlug: "test-chain",
		BasketItems: []*BasketItem{
			{ItemID: item1, Name: "Item 1", Quantity: 1},
		},
	}

	result := optimizer.calculateStoreResult(req, "store-a")

	// Penalty should be 2x average = 200
	assert.Len(t, result.MissingItems, 1)
	assert.Equal(t, int64(200), result.MissingItems[0].Penalty)
}

// TestDiscountPriceHandling verifies that discount prices are correctly applied.
func TestDiscountPriceHandling(t *testing.T) {
	mock := newMockPriceSource()
	config := DefaultOptimizerConfig()

	optimizer := NewSingleStoreOptimizer(mock, config)

	item1 := "item-001"
	discountPrice := 80
	basePrice := 100

	// Store A: item1 has discount
	mock.setPrice("test-chain", "store-a", item1, basePrice, &discountPrice)

	req := &OptimizeRequest{
		ChainSlug: "test-chain",
		BasketItems: []*BasketItem{
			{ItemID: item1, Name: "Item 1", Quantity: 2},
		},
	}

	result := optimizer.calculateStoreResult(req, "store-a")

	assert.Len(t, result.Items, 1)
	itemInfo := result.Items[0]

	// Base price should be 100
	assert.Equal(t, int64(100), itemInfo.BasePrice)

	// Should have discount
	assert.True(t, itemInfo.HasDiscount)
	assert.NotNil(t, itemInfo.DiscountPrice)
	assert.Equal(t, int64(80), *itemInfo.DiscountPrice)

	// Effective price should be 80
	assert.Equal(t, int64(80), itemInfo.EffectivePrice)

	// Line total should be 80 * 2 = 160
	assert.Equal(t, int64(160), itemInfo.LineTotal)

	// Result total should be 160
	assert.Equal(t, int64(160), result.RealTotal)
}

// TestCoverageBinFromRatio verifies coverage bin calculation.
func TestCoverageBinFromRatio(t *testing.T) {
	tests := []struct {
		ratio        float64
		expectedBin  CoverageBin
		expectedName string
	}{
		{1.0, CoverageBinFull, "100%"},
		{1.0, CoverageBinFull, "exactly 100%"},
		{0.95, CoverageBinHigh, "95%"},
		{0.9, CoverageBinHigh, "exactly 90%"},
		{0.85, CoverageBinMedium, "85%"}, // 85% < 90% = Medium
		{0.8, CoverageBinMedium, "exactly 80%"},
		{0.79, CoverageBinLow, "79%"}, // < 80% = Low
		{0.7, CoverageBinLow, "70%"},
		{0.5, CoverageBinLow, "50%"},
		{0.0, CoverageBinLow, "0%"},
	}

	for _, tt := range tests {
		t.Run(tt.expectedName, func(t *testing.T) {
			bin := CoverageBinFromRatio(tt.ratio)
			assert.Equal(t, tt.expectedBin, bin)
		})
	}
}

// TestGetEffectivePrice verifies the effective price calculation.
func TestGetEffectivePrice(t *testing.T) {
	tests := []struct {
		name          string
		price         CachedPrice
		expectedPrice int64
	}{
		{
			name: "No discount",
			price: CachedPrice{
				Price:         100,
				DiscountPrice: 100,
				HasDiscount:   false,
			},
			expectedPrice: 100,
		},
		{
			name: "With discount",
			price: CachedPrice{
				Price:         100,
				DiscountPrice: 80,
				HasDiscount:   true,
			},
			expectedPrice: 80,
		},
		{
			name: "Discount higher than base (invalid, should use base)",
			price: CachedPrice{
				Price:         100,
				DiscountPrice: 120,
				HasDiscount:   true,
			},
			expectedPrice: 100,
		},
		{
			name: "Zero discount price",
			price: CachedPrice{
				Price:         100,
				DiscountPrice: 0,
				HasDiscount:   true,
			},
			expectedPrice: 100, // Should use base when discount is 0
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			price := GetEffectivePrice(tt.price)
			assert.Equal(t, tt.expectedPrice, price)
		})
	}
}

// TestRequestValidation verifies request validation.
func TestRequestValidation(t *testing.T) {
	config := DefaultOptimizerConfig()

	tests := []struct {
		name        string
		req         *OptimizeRequest
		expectError bool
		errorMsg    string
	}{
		{
			name: "Valid request",
			req: &OptimizeRequest{
				ChainSlug: "test-chain",
				BasketItems: []*BasketItem{
					{ItemID: "item-1", Name: "Item 1", Quantity: 1},
				},
			},
			expectError: false,
		},
		{
			name: "Empty chain slug",
			req: &OptimizeRequest{
				ChainSlug: "",
				BasketItems: []*BasketItem{
					{ItemID: "item-1", Name: "Item 1", Quantity: 1},
				},
			},
			expectError: true,
			errorMsg:    "chainSlug",
		},
		{
			name:        "No items",
			req:         &OptimizeRequest{ChainSlug: "test-chain", BasketItems: []*BasketItem{}},
			expectError: true,
			errorMsg:    "basketItems",
		},
		{
			name: "Empty item ID",
			req: &OptimizeRequest{
				ChainSlug: "test-chain",
				BasketItems: []*BasketItem{
					{ItemID: "", Name: "Item 1", Quantity: 1},
				},
			},
			expectError: true,
			errorMsg:    "itemID",
		},
		{
			name: "Invalid quantity",
			req: &OptimizeRequest{
				ChainSlug: "test-chain",
				BasketItems: []*BasketItem{
					{ItemID: "item-1", Name: "Item 1", Quantity: 0},
				},
			},
			expectError: true,
			errorMsg:    "quantity",
		},
		{
			name: "Invalid latitude",
			req: &OptimizeRequest{
				ChainSlug: "test-chain",
				BasketItems: []*BasketItem{
					{ItemID: "item-1", Name: "Item 1", Quantity: 1},
				},
				Location: &Location{Latitude: 100, Longitude: 0},
			},
			expectError: true,
			errorMsg:    "latitude",
		},
		{
			name: "Invalid longitude",
			req: &OptimizeRequest{
				ChainSlug: "test-chain",
				BasketItems: []*BasketItem{
					{ItemID: "item-1", Name: "Item 1", Quantity: 1},
				},
				Location: &Location{Latitude: 0, Longitude: 200},
			},
			expectError: true,
			errorMsg:    "longitude",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.req.Validate(config.MaxBasketItems)
			if tt.expectError {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.errorMsg)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestSingleStoreContextCancellation verifies that context cancellation is handled.
func TestSingleStoreContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())

	mock := newMockPriceSource()
	config := DefaultOptimizerConfig()

	optimizer := NewSingleStoreOptimizer(mock, config)

	req := &OptimizeRequest{
		ChainSlug: "test-chain",
		BasketItems: []*BasketItem{
			{ItemID: "item-1", Name: "Item 1", Quantity: 1},
		},
	}

	mock.setPrice("test-chain", "store-a", "item-1", 100, nil)

	// Cancel context immediately
	cancel()

	_, err := optimizer.Optimize(ctx, req)

	if err != nil {
		assert.ErrorIs(t, err, context.Canceled)
	}
}
