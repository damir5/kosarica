package optimizer

import (
	"context"
)

// Location represents a store's geographic coordinates.
type Location struct {
	Latitude  float64
	Longitude float64
}

// StoreWithDistance combines a store ID with its distance from a query point.
type StoreWithDistance struct {
	StoreID  string  // CUID2 store ID
	Distance float64 // Distance in kilometers
}

// CachedPrice represents price data for an item at a store or price group.
// Uses int64 for all money values to reduce GC pressure.
// DiscountPrice of 0 with HasDiscount=false means no discount available.
type CachedPrice struct {
	Price         int64 // Base price in minor currency units (e.g., lipa)
	DiscountPrice int64 // Discounted price if HasDiscount is true
	HasDiscount   bool  // Whether a discount is available
	IsException   bool  // Whether this is a store-specific exception price
}

// PriceSource defines the interface for accessing price data.
// This allows the optimizer to be decoupled from the cache implementation.
type PriceSource interface {
	// GetPrice retrieves the price for a specific item at a store.
	// Returns the cached price and true if found, false otherwise.
	GetPrice(chainSlug string, storeID, itemID string) (CachedPrice, bool)

	// GetAveragePrice returns the chain-wide average price for an item.
	// Used for penalty calculations when items are missing at stores.
	GetAveragePrice(chainSlug string, itemID string) int64

	// GetNearestStores returns stores within maxDistanceKm of the given location,
	// sorted by distance (closest first) and limited to the specified count.
	GetNearestStores(chainSlug string, lat, lon, maxDistanceKm float64, limit int) []StoreWithDistance

	// GetStoreIDs returns all store IDs for a chain.
	// Used for candidate selection in multi-store optimization.
	GetStoreIDs(chainSlug string) []string

	// IsHealthy returns whether the price source is ready to serve requests.
	IsHealthy(ctx context.Context) bool
}

// Optimizer is the main interface for basket optimization operations.
type Optimizer interface {
	// SingleStoreOptimize finds the best single stores for a basket.
	SingleStoreOptimize(ctx context.Context, req *OptimizeRequest) ([]*SingleStoreResult, error)

	// MultiStoreOptimize finds the optimal combination of stores for a basket.
	MultiStoreOptimize(ctx context.Context, req *OptimizeRequest) (*MultiStoreResult, error)
}

// CacheWarmupper defines the interface for warming up the price cache.
type CacheWarmupper interface {
	// Warmup loads price data for all active chains into cache.
	Warmup(ctx context.Context) error

	// RefreshChain reloads price data for a specific chain.
	RefreshChain(ctx context.Context, chainSlug string) error
}

// CacheHealthReporter defines the interface for reporting cache health.
type CacheHealthReporter interface {
	// IsHealthy returns whether the cache is healthy and ready to serve requests.
	IsHealthy(ctx context.Context) bool

	// GetFreshness returns the last load time for each chain.
	GetFreshness(ctx context.Context) map[string]CacheFreshness
}

// CacheFreshness reports the freshness status of a chain's cache.
type CacheFreshness struct {
	LoadedAt    int64 // Unix timestamp of last load
	IsStale     bool  // Whether cache is considered stale
	EstimatedMB int64 // Estimated memory usage in megabytes
}
