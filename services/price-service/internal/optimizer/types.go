package optimizer

import (
	"fmt"
	"time"
)

// OptimizeRequest contains the parameters for basket optimization.
type OptimizeRequest struct {
	ChainSlug   string        // The retail chain to optimize for
	BasketItems []*BasketItem // Items in the basket
	Location    *Location     // Optional user location for distance calculation
	MaxDistance float64       // Maximum distance in km (0 = no limit)
	MaxStores   int           // Maximum number of stores to return (multi-store only)
}

// BasketItem represents a single item in the shopping basket.
type BasketItem struct {
	ItemID   string // CUID2 item identifier from retailer_items
	Name     string // Item name for display
	Quantity int    // Quantity requested (must be > 0)
}

// CoverageBin represents the coverage tier for ranking stores.
// Higher bins = better coverage = higher priority.
type CoverageBin int

const (
	CoverageBinLow    CoverageBin = 1 // < 80% coverage
	CoverageBinMedium CoverageBin = 2 // 80%+ coverage
	CoverageBinHigh   CoverageBin = 3 // 90%+ coverage
	CoverageBinFull   CoverageBin = 4 // 100% coverage
)

// SingleStoreResult represents the optimization result for a single store.
type SingleStoreResult struct {
	StoreID       string           // CUID2 store identifier
	CoverageRatio float64          // Ratio of available items to total items (0-1)
	CoverageBin   CoverageBin      // Coverage tier for sorting
	SortingTotal  int64            // Total used for sorting (includes penalties)
	RealTotal     int64            // Actual purchasable total (excludes missing items)
	MissingItems  []*MissingItem   // Items not available at this store
	Items         []*ItemPriceInfo // Price breakdown for each item
	Distance      float64          // Distance from user location in km (0 if not provided)
}

// MissingItem represents an item that was not available at a store.
type MissingItem struct {
	ItemID     string // CUID2 item identifier
	ItemName   string // Item name
	Penalty    int64  // Penalty value used for sorting (typically 2x average)
	IsOptional bool   // Whether user considers this item optional
}

// ItemPriceInfo contains detailed price information for a single item.
type ItemPriceInfo struct {
	ItemID         string // CUID2 item identifier
	ItemName       string // Item name
	Quantity       int    // Quantity requested
	BasePrice      int64  // Base price per unit
	EffectivePrice int64  // Price per unit after discount (if any)
	HasDiscount    bool   // Whether a discount is available
	DiscountPrice  *int64 // Discounted price per unit (nil if no discount)
	LineTotal      int64  // Total price for this line (EffectivePrice * Quantity)
}

// MultiStoreResult represents the optimization result across multiple stores.
type MultiStoreResult struct {
	Stores          []*StoreAllocation // Stores and their allocated items
	CombinedTotal   int64              // Total cost across all stores
	CoverageRatio   float64            // Combined coverage ratio (0-1)
	UnassignedItems []*MissingItem     // Items not available at any selected store
	AlgorithmUsed   string             // "greedy" or "optimal"
}

// StoreAllocation represents a single store in a multi-store optimization.
type StoreAllocation struct {
	StoreID    string           // CUID2 store identifier
	Items      []*ItemPriceInfo // Items allocated to this store
	StoreTotal int64            // Total cost for this store
	Distance   float64          // Distance from user location in km
	VisitOrder int              // Suggested visit order (1 = first)
}

// CacheLoadStats tracks statistics from a cache load operation.
type CacheLoadStats struct {
	ChainSlug          string        // Chain identifier
	Duration           time.Duration // Time taken to load
	GroupCount         int           // Number of price groups loaded
	StoreCount         int           // Number of stores mapped
	ExceptionCount     int           // Number of exception prices
	EstimatedSizeBytes int64         // Estimated memory footprint
	LoadTime           time.Time     // When the load completed
}

// OptimizerConfig contains configuration settings for the basket optimizer.
type OptimizerConfig struct {
	// Cache settings
	CacheLoadTimeout   time.Duration // Maximum time to wait for cache load
	CacheTTL           time.Duration // How long cache entries remain valid
	CacheRefreshJitter time.Duration // Random jitter to prevent thundering herd on refresh

	// Warmup settings
	WarmupConcurrency int // Maximum concurrent chain warmups

	// Candidate selection
	TopCheapestStores int // Number of cheapest stores to consider for multi-store
	TopNearestStores  int // Number of nearest stores to consider for multi-store
	MaxCandidates     int // Maximum total candidates for multi-store optimization

	// Geographic filtering
	MaxDistanceKm float64 // Maximum distance for nearest store queries

	// Algorithm settings
	OptimalTimeoutMs int // Maximum time to spend on optimal algorithm (ms)

	// Validation limits
	MaxBasketItems int // Maximum items allowed in a basket
	MinBasketItems int // Minimum items required for optimization

	// Missing item penalty
	MissingItemPenaltyMult float64 // Multiplier for average price (e.g., 2.0 = 2x average)
	MissingItemFallback    int64   // Fallback price when no average available

	// Coverage bins (must be descending)
	CoverageBins []float64 // Thresholds for coverage bins: [1.0, 0.9, 0.8]
}

// DefaultOptimizerConfig returns the default configuration for the optimizer.
func DefaultOptimizerConfig() *OptimizerConfig {
	return &OptimizerConfig{
		CacheLoadTimeout:       30 * time.Second,
		CacheTTL:               1 * time.Hour,
		CacheRefreshJitter:     5 * time.Minute,
		WarmupConcurrency:      3,
		TopCheapestStores:      10,
		TopNearestStores:       5,
		MaxCandidates:          20,
		MaxDistanceKm:          50.0,
		OptimalTimeoutMs:       100,
		MaxBasketItems:         100,
		MinBasketItems:         1,
		MissingItemPenaltyMult: 2.0,
		MissingItemFallback:    10000, // 100.00 in minor units
		CoverageBins:           []float64{1.0, 0.9, 0.8},
	}
}

// GetEffectivePrice returns the effective price (discount if available, otherwise base price).
func GetEffectivePrice(p CachedPrice) int64 {
	if p.HasDiscount && p.DiscountPrice > 0 && p.DiscountPrice < p.Price {
		return p.DiscountPrice
	}
	return p.Price
}

// CoverageBinFromRatio returns the coverage bin for a given coverage ratio.
func CoverageBinFromRatio(ratio float64) CoverageBin {
	switch {
	case ratio >= 1.0:
		return CoverageBinFull
	case ratio >= 0.9:
		return CoverageBinHigh
	case ratio >= 0.8:
		return CoverageBinMedium
	default:
		return CoverageBinLow
	}
}

// Validate validates the optimization request and returns an error if invalid.
func (r *OptimizeRequest) Validate(maxItems int) error {
	if r.ChainSlug == "" {
		return ErrInvalidRequest{Field: "chainSlug", Reason: "cannot be empty"}
	}
	if len(r.BasketItems) < 1 {
		return ErrInvalidRequest{Field: "basketItems", Reason: "must have at least one item"}
	}
	if len(r.BasketItems) > maxItems {
		return ErrInvalidRequest{Field: "basketItems", Reason: "exceeds maximum allowed"}
	}
	for i, item := range r.BasketItems {
		if item.ItemID == "" {
			return ErrInvalidRequest{Field: "basketItems", Reason: fmt.Sprintf("item at index %d has invalid itemID", i), Index: i}
		}
		if item.Quantity <= 0 {
			return ErrInvalidRequest{Field: "basketItems", Reason: fmt.Sprintf("item at index %d has invalid quantity", i), Index: i}
		}
	}
	if r.Location != nil {
		if r.Location.Latitude < -90 || r.Location.Latitude > 90 {
			return ErrInvalidRequest{Field: "location.latitude", Reason: "must be between -90 and 90"}
		}
		if r.Location.Longitude < -180 || r.Location.Longitude > 180 {
			return ErrInvalidRequest{Field: "location.longitude", Reason: "must be between -180 and 180"}
		}
	}
	return nil
}

// ErrInvalidRequest is returned when the optimization request is invalid.
type ErrInvalidRequest struct {
	Field  string
	Reason string
	Index  int
}

func (e ErrInvalidRequest) Error() string {
	if e.Index >= 0 {
		return e.Field + ": " + e.Reason
	}
	return e.Field + ": " + e.Reason
}
