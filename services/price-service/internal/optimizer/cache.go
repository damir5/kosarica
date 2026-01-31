package optimizer

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"golang.org/x/sync/semaphore"
	"golang.org/x/sync/singleflight"
)

// PriceCache implements the tier-aware price cache with per-chain sharding.
// It uses tierPrices + storeItemTier mappings for memory-efficient price storage.
// Multiple stores sharing the same price for an item reference the same tier.
type PriceCache struct {
	chainsMu sync.RWMutex
	chains   map[string]*ChainCache
	sf       singleflight.Group

	db     *pgxpool.Pool
	config *OptimizerConfig

	// Warmup semaphore limits concurrent DB loads
	warmupSem *semaphore.Weighted

	// Circuit breaker for cache failures
	circuitBreaker *CircuitBreaker

	// Warmup gate blocks requests until warmup is complete
	warmupGate *WarmupGate

	// Metrics recorder
	metrics *MetricsRecorder

	// Logger for structured logging
	logger *zerolog.Logger

	// Shutdown handling
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// ChainCache holds the price data for a single chain with atomic snapshot swaps.
type ChainCache struct {
	snapshot atomic.Value // *ChainCacheSnapshot
	loadedAt atomic.Value // time.Time
}

// ChainCacheSnapshot is an immutable snapshot of chain's price data.
// It is built off-lock and swapped atomically to minimize lock contention.
type ChainCacheSnapshot struct {
	// tierPrices maps tierID -> CachedPrice
	// Each price tier represents a unique (item, price, discount) combination.
	// Multiple stores can share the same tier for deduplication.
	tierPrices map[string]CachedPrice

	// storeItemTier maps storeID -> itemID -> tierID
	// This provides O(1) lookup from store+item to price tier.
	storeItemTier map[string]map[string]string

	// storeIDs tracks all active store IDs for this chain
	storeIDs map[string]bool

	// exceptions maps storeID -> itemID -> exception price
	// These are rare store-specific price overrides.
	exceptions map[string]map[string]CachedPrice

	// storeLocations maps storeID -> geographic coordinates
	storeLocations map[string]Location

	// itemAveragePrice maps itemID -> chain-wide average price
	// Used for penalty calculation when items are missing at stores.
	itemAveragePrice map[string]int64

	// estimatedSizeBytes is the approximate memory footprint
	estimatedSizeBytes int64
}

// NewPriceCache creates a new price cache instance.
func NewPriceCache(db *pgxpool.Pool, config *OptimizerConfig) *PriceCache {
	ctx, cancel := context.WithCancel(context.Background())

	metrics := NewMetricsRecorder()
	logger := log.With().Str("component", "price_cache").Logger()

	pc := &PriceCache{
		chains:         make(map[string]*ChainCache),
		db:             db,
		config:         config,
		warmupSem:      semaphore.NewWeighted(int64(config.WarmupConcurrency)),
		circuitBreaker: NewCircuitBreaker("price_cache", DefaultCircuitBreakerConfig(), metrics, &logger),
		warmupGate:     NewWarmupGate(&logger),
		metrics:        metrics,
		logger:         &logger,
		ctx:            ctx,
		cancel:         cancel,
	}

	return pc
}

// StartWarmup loads price data for all active chains into cache.
// It respects the WarmupConcurrency limit to avoid overwhelming the database.
func (c *PriceCache) StartWarmup(ctx context.Context) error {
	// Get all active chains
	chains, err := c.getActiveChains(ctx)
	if err != nil {
		return fmt.Errorf("failed to get active chains: %w", err)
	}

	c.logger.Info().Int("chains", len(chains)).Msg("Starting cache warmup")

	var wg sync.WaitGroup
	errCh := make(chan error, len(chains))

	for _, chain := range chains {
		// Acquire semaphore to limit concurrent loads
		if err := c.warmupSem.Acquire(ctx, 1); err != nil {
			c.logger.Warn().Err(err).Str("chain", chain).Msg("Failed to acquire warmup semaphore")
			continue
		}

		wg.Add(1)
		go func(chainSlug string) {
			defer c.warmupSem.Release(1)
			defer wg.Done()

			loadCtx, cancel := context.WithTimeout(context.Background(), c.config.CacheLoadTimeout)
			defer cancel()

			if err := c.LoadChain(loadCtx, chainSlug); err != nil {
				c.logger.Error().Err(err).Str("chain", chainSlug).Msg("Failed to warm chain cache")
				errCh <- fmt.Errorf("chain %s: %w", chainSlug, err)
			} else {
				c.logger.Info().Str("chain", chainSlug).Msg("Warmed chain cache")
			}
		}(chain)
	}

	// Wait for all warmups to complete
	go func() {
		wg.Wait()
		close(errCh)
	}()

	// Collect first error (if any)
	for err := range errCh {
		if err != nil {
			return err
		}
	}

	c.logger.Info().Msg("Cache warmup completed")
	c.warmupGate.Ready()
	return nil
}

// Warmup is an alias for StartWarmup to implement the CacheWarmupper interface.
func (c *PriceCache) Warmup(ctx context.Context) error {
	return c.StartWarmup(ctx)
}

// LoadChain loads price data for a specific chain using singleflight.
// Only one load per chain can happen at a time, preventing thundering herd.
func (c *PriceCache) LoadChain(ctx context.Context, chainSlug string) error {
	// Check circuit breaker before attempting load
	if !c.circuitBreaker.Allow(ctx) {
		c.logger.Warn().
			Str("chain", chainSlug).
			Str("circuit_state", c.circuitBreaker.State().String()).
			Msg("Circuit breaker rejected cache load")
		return fmt.Errorf("circuit breaker open for chain %s", chainSlug)
	}

	// Use singleflight to prevent concurrent loads of the same chain
	_, err, shared := c.sf.Do(chainSlug, func() (interface{}, error) {
		// Use a dedicated load context, not the request context
		// This ensures cancellation of one request doesn't fail others
		loadCtx, cancel := context.WithTimeout(context.Background(), c.config.CacheLoadTimeout)
		defer cancel()

		snapshot, loadErr := c.loadChainSnapshot(loadCtx, chainSlug)
		if loadErr != nil {
			c.circuitBreaker.RecordFailure(loadErr)
			return nil, loadErr
		}

		// Record success with circuit breaker
		c.circuitBreaker.RecordSuccess()

		// Get or create chain cache
		c.chainsMu.Lock()
		chainCache, exists := c.chains[chainSlug]
		if !exists {
			chainCache = &ChainCache{}
			c.chains[chainSlug] = chainCache
		}
		c.chainsMu.Unlock()

		// Atomic snapshot swap
		chainCache.snapshot.Store(snapshot)
		chainCache.loadedAt.Store(time.Now())

		// Record memory usage
		c.metrics.RecordSnapshotMemory(chainSlug, snapshot.estimatedSizeBytes)

		return snapshot, nil
	})

	// If this was a shared result, we still need to check if there was an error
	if shared && err != nil {
		// Don't double-record failure for shared results
		return err
	}

	return err
}

// RefreshChain is an alias for LoadChain for clarity.
func (c *PriceCache) RefreshChain(ctx context.Context, chainSlug string) error {
	return c.LoadChain(ctx, chainSlug)
}

// loadChainSnapshot loads a complete snapshot of chain's price data in a single transaction.
// This ensures consistency between store->tier mappings and tier prices.
func (c *PriceCache) loadChainSnapshot(ctx context.Context, chainSlug string) (*ChainCacheSnapshot, error) {
	startTime := time.Now()

	// Use a single transaction for consistent snapshot
	tx, err := c.db.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}

	// Track commit state to prevent rollback after commit
	txCommitted := false

	// Defer rollback with SEPARATE context
	defer func() {
		if txCommitted {
			return // Already committed, don't rollback
		}

		// Create a new context with timeout for rollback
		// This ensures rollback can complete even if original ctx is canceled
		rollbackCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := tx.Rollback(rollbackCtx); err != nil {
			log.Error().Err(err).Msg("Failed to rollback transaction (connection may be closed)")
		}
	}()

	log.Debug().Str("operation", "loadChainSnapshot").Str("chain", chainSlug).Msg("Transaction began")

	snapshot := &ChainCacheSnapshot{
		tierPrices:       make(map[string]CachedPrice),
		storeItemTier:    make(map[string]map[string]string),
		storeIDs:         make(map[string]bool),
		exceptions:       make(map[string]map[string]CachedPrice),
		storeLocations:   make(map[string]Location),
		itemAveragePrice: make(map[string]int64),
	}

	// Load stores with locations
	storeRows, err := tx.Query(ctx, `
		SELECT s.id, s.latitude, s.longitude
		FROM stores s
		WHERE s.chain_slug = $1
		  AND s.status = 'active'
	`, chainSlug)
	if err != nil {
		return nil, fmt.Errorf("failed to query stores: %w", err)
	}
	defer storeRows.Close()

	for storeRows.Next() {
		var storeID string
		var lat, lon *string // Stored as text in DB

		if err := storeRows.Scan(&storeID, &lat, &lon); err != nil {
			return nil, fmt.Errorf("failed to scan store: %w", err)
		}

		snapshot.storeIDs[storeID] = true
		snapshot.storeItemTier[storeID] = make(map[string]string)

		// Parse location if available
		if lat != nil && lon != nil {
			var latF, lonF float64
			if _, err := fmt.Sscanf(*lat, "%f", &latF); err == nil {
				if _, err := fmt.Sscanf(*lon, "%f", &lonF); err == nil {
					snapshot.storeLocations[storeID] = Location{
						Latitude:  latF,
						Longitude: lonF,
					}
				}
			}
		}
	}

	if err := storeRows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating stores: %w", err)
	}

	// Load price tiers for this chain
	tierRows, err := tx.Query(ctx, `
		SELECT id, retailer_item_id, price, discount_price
		FROM price_tiers
		WHERE chain_slug = $1
	`, chainSlug)
	if err != nil {
		return nil, fmt.Errorf("failed to query price tiers: %w", err)
	}
	defer tierRows.Close()

	// Track prices for average calculation
	itemPrices := make(map[string][]int64)

	for tierRows.Next() {
		var tierID, itemID string
		var price int
		var discountPrice *int
		if err := tierRows.Scan(&tierID, &itemID, &price, &discountPrice); err != nil {
			return nil, fmt.Errorf("failed to scan price tier: %w", err)
		}

		// Build cached price
		cachedPrice := CachedPrice{
			Price:       int64(price),
			IsException: false,
		}
		if discountPrice != nil && *discountPrice > 0 && *discountPrice < price {
			cachedPrice.DiscountPrice = int64(*discountPrice)
			cachedPrice.HasDiscount = true
		} else {
			cachedPrice.DiscountPrice = cachedPrice.Price
		}

		snapshot.tierPrices[tierID] = cachedPrice

		// Track for average calculation (each tier represents one unique price point)
		itemPrices[itemID] = append(itemPrices[itemID], cachedPrice.Price)
	}

	if err := tierRows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating price tiers: %w", err)
	}

	// Load store->tier references
	refRows, err := tx.Query(ctx, `
		SELECT spr.store_id, spr.retailer_item_id, spr.price_tier_id
		FROM store_price_refs spr
		JOIN stores s ON s.id = spr.store_id
		WHERE s.chain_slug = $1 AND s.status = 'active'
	`, chainSlug)
	if err != nil {
		return nil, fmt.Errorf("failed to query store price refs: %w", err)
	}
	defer refRows.Close()

	refCount := 0
	for refRows.Next() {
		var storeID, itemID, tierID string
		if err := refRows.Scan(&storeID, &itemID, &tierID); err != nil {
			return nil, fmt.Errorf("failed to scan store price ref: %w", err)
		}

		// Initialize store map if needed (may not exist if store was added after stores query)
		if snapshot.storeItemTier[storeID] == nil {
			snapshot.storeItemTier[storeID] = make(map[string]string)
		}

		snapshot.storeItemTier[storeID][itemID] = tierID
		refCount++
	}

	if err := refRows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating store price refs: %w", err)
	}

	// Load store exceptions
	exceptionRows, err := tx.Query(ctx, `
		SELECT spe.store_id, spe.retailer_item_id, spe.price, spe.discount_price
		FROM store_price_exceptions spe
		JOIN stores s ON s.id = spe.store_id
		WHERE s.chain_slug = $1 AND spe.expires_at > NOW()
	`, chainSlug)
	if err != nil {
		return nil, fmt.Errorf("failed to query exceptions: %w", err)
	}
	defer exceptionRows.Close()

	for exceptionRows.Next() {
		var storeID, itemID string
		var price int
		var discountPrice *int
		if err := exceptionRows.Scan(&storeID, &itemID, &price, &discountPrice); err != nil {
			return nil, fmt.Errorf("failed to scan exception: %w", err)
		}

		// Initialize store exception map if needed
		if snapshot.exceptions[storeID] == nil {
			snapshot.exceptions[storeID] = make(map[string]CachedPrice)
		}

		cachedPrice := CachedPrice{
			Price:       int64(price),
			IsException: true,
		}
		if discountPrice != nil && *discountPrice > 0 && *discountPrice < price {
			cachedPrice.DiscountPrice = int64(*discountPrice)
			cachedPrice.HasDiscount = true
		} else {
			cachedPrice.DiscountPrice = cachedPrice.Price
		}

		snapshot.exceptions[storeID][itemID] = cachedPrice
	}

	if err := exceptionRows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating exceptions: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}
	txCommitted = true

	log.Debug().Str("operation", "loadChainSnapshot").Str("chain", chainSlug).Msg("Transaction committed")

	// Compute item average prices
	for itemID, prices := range itemPrices {
		var sum int64
		for _, p := range prices {
			sum += p
		}
		snapshot.itemAveragePrice[itemID] = sum / int64(len(prices))
	}

	// Estimate memory size
	snapshot.estimatedSizeBytes = c.estimateSnapshotSize(snapshot)

	duration := time.Since(startTime)
	log.Info().
		Str("chain", chainSlug).
		Int("stores", len(snapshot.storeIDs)).
		Int("tiers", len(snapshot.tierPrices)).
		Int("refs", refCount).
		Int("exceptions", len(snapshot.exceptions)).
		Dur("duration", duration).
		Msg("Loaded chain cache snapshot")

	return snapshot, nil
}

// GetPrice retrieves the price for a specific item at a store.
// It checks exceptions first, then resolves via tier mapping.
// Safe for concurrent use and handles nil-maps gracefully.
func (c *PriceCache) GetPrice(chainSlug string, storeID, itemID string) (CachedPrice, bool) {
	c.chainsMu.RLock()
	chainCache, exists := c.chains[chainSlug]
	c.chainsMu.RUnlock()

	if !exists {
		return CachedPrice{}, false
	}

	snapshot := c.getSnapshot(chainCache)
	if snapshot == nil {
		return CachedPrice{}, false
	}

	// 1. Check exceptions first (nil-map safe)
	if storeExceptions, ok := snapshot.exceptions[storeID]; ok {
		if price, ok := storeExceptions[itemID]; ok {
			return price, true
		}
	}

	// 2. Get tier for store+item (nil-map safe)
	storeItems, ok := snapshot.storeItemTier[storeID]
	if !ok {
		return CachedPrice{}, false
	}

	tierID, ok := storeItems[itemID]
	if !ok {
		return CachedPrice{}, false
	}

	// 3. Get price from tier (nil-map safe)
	price, ok := snapshot.tierPrices[tierID]
	if !ok {
		return CachedPrice{}, false
	}

	return price, true
}

// GetAveragePrice returns the chain-wide average price for an item.
func (c *PriceCache) GetAveragePrice(chainSlug string, itemID string) int64 {
	c.chainsMu.RLock()
	chainCache, exists := c.chains[chainSlug]
	c.chainsMu.RUnlock()

	if !exists {
		return 0
	}

	snapshot := c.getSnapshot(chainCache)
	if snapshot == nil {
		return 0
	}

	avgPrice, ok := snapshot.itemAveragePrice[itemID]
	if !ok {
		return 0
	}

	return avgPrice
}

// GetNearestStores returns stores within maxDistanceKm of the given location.
func (c *PriceCache) GetNearestStores(chainSlug string, lat, lon, maxDistanceKm float64, limit int) []StoreWithDistance {
	c.chainsMu.RLock()
	chainCache, exists := c.chains[chainSlug]
	c.chainsMu.RUnlock()

	if !exists {
		return nil
	}

	snapshot := c.getSnapshot(chainCache)
	if snapshot == nil {
		return nil
	}

	// Calculate distances for all stores
	// TODO: For large number of stores (>1000), use an R-Tree or similar spatial index
	var candidates []StoreWithDistance

	for storeID, location := range snapshot.storeLocations {
		dist := HaversineKm(lat, lon, location.Latitude, location.Longitude)
		if maxDistanceKm > 0 && dist > maxDistanceKm {
			continue
		}
		candidates = append(candidates, StoreWithDistance{
			StoreID:  storeID,
			Distance: dist,
		})
	}

	// Sort by distance (simple bubble sort for small N or standard sort)
	// Since we need top K, we could use a heap, but for N=500 stores, sort is fine.
	// Optimizing: just find top K.
	// For simplicity in this implementation, we won't sort yet, let the caller or separate util sort.
	// BUT the interface says "sorted by distance". So we MUST sort.

	// Basic selection sort for top K is faster than full sort if K is small
	if limit > 0 && len(candidates) > limit {
		SortStoresByDistance(candidates)
		return candidates[:limit]
	}

	SortStoresByDistance(candidates)
	return candidates
}

// GetStoreIDs returns all store IDs for a chain.
func (c *PriceCache) GetStoreIDs(chainSlug string) []string {
	c.chainsMu.RLock()
	chainCache, exists := c.chains[chainSlug]
	c.chainsMu.RUnlock()

	if !exists {
		return nil
	}

	snapshot := c.getSnapshot(chainCache)
	if snapshot == nil {
		return nil
	}

	storeIDs := make([]string, 0, len(snapshot.storeIDs))
	for storeID := range snapshot.storeIDs {
		storeIDs = append(storeIDs, storeID)
	}

	return storeIDs
}

// getSnapshot safely gets the current snapshot for a chain cache.
func (c *PriceCache) getSnapshot(chainCache *ChainCache) *ChainCacheSnapshot {
	val := chainCache.snapshot.Load()
	if val == nil {
		return nil
	}
	return val.(*ChainCacheSnapshot)
}

// estimateSnapshotSize estimates the memory footprint of a snapshot in bytes.
func (c *PriceCache) estimateSnapshotSize(s *ChainCacheSnapshot) int64 {
	size := int64(0)

	// tierPrices: map overhead + entries
	size += int64(len(s.tierPrices)) * 64 // map overhead
	for tierID := range s.tierPrices {
		size += int64(len(tierID)) + 32 // tierID + CachedPrice
	}

	// storeItemTier: nested map
	size += int64(len(s.storeItemTier)) * 64 // outer map overhead
	for storeID, items := range s.storeItemTier {
		size += int64(len(storeID)) + 64 // storeID + inner map overhead
		for itemID, tierID := range items {
			size += int64(len(itemID)+len(tierID)) + 16 // itemID + tierID + entry overhead
		}
	}

	// storeIDs
	size += int64(len(s.storeIDs)) * 64
	for storeID := range s.storeIDs {
		size += int64(len(storeID)) + 8 // storeID + bool
	}

	// exceptions
	size += int64(len(s.exceptions)) * 64
	for storeID, items := range s.exceptions {
		size += int64(len(storeID)) + 64
		size += int64(len(items)) * 64
		for itemID := range items {
			size += int64(len(itemID)) + 32
		}
	}

	// storeLocations
	size += int64(len(s.storeLocations)) * (64 + 16) // string key + Location struct

	// itemAveragePrice
	size += int64(len(s.itemAveragePrice)) * (64 + 16) // string key + int64

	return size
}

// getActiveChains retrieves all active chain slugs from the database.
func (c *PriceCache) getActiveChains(ctx context.Context) ([]string, error) {
	rows, err := c.db.Query(ctx, `
		SELECT DISTINCT chain_slug
		FROM stores
		WHERE status = 'active'
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var chains []string
	for rows.Next() {
		var chainSlug string
		if err := rows.Scan(&chainSlug); err != nil {
			return nil, err
		}
		chains = append(chains, chainSlug)
	}

	return chains, rows.Err()
}

// Close gracefully shuts down the cache.
func (c *PriceCache) Close() error {
	c.cancel()
	c.wg.Wait()
	return nil
}

// IsHealthy returns whether the cache is healthy and ready to serve requests.
// It checks:
// 1. Circuit breaker state (open = unhealthy)
// 2. Warmup gate (not ready = unhealthy)
// 3. At least one chain has valid snapshot data
func (c *PriceCache) IsHealthy(ctx context.Context) bool {
	// Check circuit breaker
	if c.circuitBreaker.State() == CircuitOpen {
		c.logger.Debug().Msg("Cache unhealthy: circuit breaker is open")
		return false
	}

	// Check warmup gate
	if !c.warmupGate.IsReady() {
		c.logger.Debug().Msg("Cache unhealthy: warmup not complete")
		return false
	}

	c.chainsMu.RLock()
	defer c.chainsMu.RUnlock()

	// Check that we have at least one chain with valid snapshot
	for _, chainCache := range c.chains {
		if c.getSnapshot(chainCache) != nil {
			return true
		}
	}

	c.logger.Debug().Msg("Cache unhealthy: no valid snapshots")
	return false
}

// GetFreshness returns the last load time for each chain.
func (c *PriceCache) GetFreshness(ctx context.Context) map[string]CacheFreshness {
	c.chainsMu.RLock()
	defer c.chainsMu.RUnlock()

	result := make(map[string]CacheFreshness)
	for chainSlug, chainCache := range c.chains {
		snapshot := c.getSnapshot(chainCache)
		if snapshot == nil {
			result[chainSlug] = CacheFreshness{
				IsStale: true,
			}
			continue
		}

		loadedAtVal := chainCache.loadedAt.Load()
		var loadedAt time.Time
		if loadedAtVal != nil {
			loadedAt = loadedAtVal.(time.Time)
		}

		result[chainSlug] = CacheFreshness{
			LoadedAt:    loadedAt.Unix(),
			IsStale:     time.Since(loadedAt) > c.config.CacheTTL,
			EstimatedMB: snapshot.estimatedSizeBytes / (1024 * 1024),
		}
	}

	return result
}

// GetCircuitBreakerState returns the current state of the circuit breaker.
func (c *PriceCache) GetCircuitBreakerState() CircuitBreakerState {
	return c.circuitBreaker.State()
}

// ResetCircuitBreaker resets the circuit breaker to closed state.
// This is useful for manually recovering from a failure state.
func (c *PriceCache) ResetCircuitBreaker() {
	c.circuitBreaker.Reset()
}

// GetWarmupStatus returns whether warmup is complete.
func (c *PriceCache) GetWarmupStatus() bool {
	return c.warmupGate.IsReady()
}

// WaitForWarmup blocks until warmup is complete or context is cancelled.
// Returns false if context was cancelled before warmup completed.
func (c *PriceCache) WaitForWarmup(ctx context.Context) bool {
	return c.warmupGate.Wait(ctx)
}
