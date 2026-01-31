package optimizer

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestNilMapSafety verifies that accessing missing stores, tiers, or items
// doesn't panic and returns appropriate empty values.
func TestNilMapSafety(t *testing.T) {
	cache := &PriceCache{
		chains: make(map[string]*ChainCache),
	}

	chainCache := &ChainCache{}
	snapshot := &ChainCacheSnapshot{
		tierPrices:       make(map[string]CachedPrice),
		storeItemTier:    make(map[string]map[string]string),
		storeIDs:         make(map[string]bool),
		exceptions:       make(map[string]map[string]CachedPrice),
		storeLocations:   make(map[string]Location),
		itemAveragePrice: make(map[string]int64),
	}
	chainCache.snapshot.Store(snapshot)
	cache.chains["test"] = chainCache

	// These should not panic
	price, ok := cache.GetPrice("test", "missing-store", "missing-item")
	assert.False(t, ok, "Missing store should return false")
	assert.Equal(t, CachedPrice{}, price, "Missing store should return zero price")

	avg := cache.GetAveragePrice("test", "missing-item")
	assert.Equal(t, int64(0), avg, "Missing item average should be 0")

	nearest := cache.GetNearestStores("test", 45.0, 15.0, 10.0, 5)
	assert.Nil(t, nearest, "Missing stores should return nil")
}
