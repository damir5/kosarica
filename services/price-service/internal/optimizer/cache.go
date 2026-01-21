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
)

// PriceCache implements the group-aware price cache with per-chain sharding.
// It mirrors the database structure with groupPrices + storeToGroup mappings,
// NOT map[storeID]map[itemID]Price which would defeat price group deduplication.
type PriceCache struct {
	chainsMu sync.RWMutex
	chains   map[string]*ChainCache
	sf       singleFlightGroup

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

// singleFlightGroup prevents thundering herd on cache loads.
// We use a custom type instead of golang.org/x/sync/singleflight to allow
// dedicated load context (not request ctx) for better cancellation handling.
type singleFlightGroup struct {
	mu    sync.Mutex
	calls map[string]*singleFlightCall
}

type singleFlightCall struct {
	wg  sync.WaitGroup
	val *ChainCacheSnapshot
	err error
}

// ChainCache holds the price data for a single chain with atomic snapshot swaps.
type ChainCache struct {
	snapshot atomic.Value // *ChainCacheSnapshot
	loadedAt atomic.Value // time.Time
}

// ChainCacheSnapshot is an immutable snapshot of chain's price data.
// It is built off-lock and swapped atomically to minimize lock contention.
type ChainCacheSnapshot struct {
	// groupPrices maps groupID -> itemID -> price
	// This mirrors the database structure and enables price group deduplication.
	// If 300 stores share the same "National Price Group", prices are stored ONCE.
	groupPrices map[string]map[string]CachedPrice

	// storeToGroup maps storeID -> current groupID
	storeToGroup map[string]string

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
// This ensures consistency between store->group mappings and group prices.
func (c *PriceCache) loadChainSnapshot(ctx context.Context, chainSlug string) (*ChainCacheSnapshot, error) {
	startTime := time.Now()

	// Use a single transaction for consistent snapshot
	tx, err := c.db.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	snapshot := &ChainCacheSnapshot{
		groupPrices:      make(map[string]map[string]CachedPrice),
		storeToGroup:     make(map[string]string),
		exceptions:       make(map[string]map[string]CachedPrice),
		storeLocations:   make(map[string]Location),
		itemAveragePrice: make(map[string]int64),
	}

	// Load store->group mappings with locations
	storeRows, err := tx.Query(ctx, `
		SELECT s.id, s.latitude, s.longitude, sgh.price_group_id
		FROM stores s
		JOIN store_group_history sgh ON sgh.store_id = s.id
		WHERE s.chain_slug = $1
		  AND s.status = 'active'
		  AND sgh.valid_to IS NULL
	`, chainSlug)
	if err != nil {
		return nil, fmt.Errorf("failed to query stores: %w", err)
	}
	defer storeRows.Close()

	for storeRows.Next() {
		var storeID, groupID string
		var lat, lon *float64 // Use pointers for nullable float64

		// Note: pgx handles NULLs correctly with pointers or NullFloat64
		// Assuming latitude/longitude are nullable numeric/float columns in DB
		if err := storeRows.Scan(&storeID, &lat, &lon, &groupID); err != nil {
			return nil, fmt.Errorf("failed to scan store: %w", err)
		}

		snapshot.storeToGroup[storeID] = groupID

		// Parse location if available
		if lat != nil && lon != nil {
			snapshot.storeLocations[storeID] = Location{
				Latitude:  *lat,
				Longitude: *lon,
			}
		}
	}

	if err := storeRows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating stores: %w", err)
	}

	// Load group prices for all groups in this chain
	groupPriceRows, err := tx.Query(ctx, `
		SELECT gp.price_group_id, gp.retailer_item_id,
		       gp.price, gp.discount_price
		FROM group_prices gp
		JOIN price_groups pg ON pg.id = gp.price_group_id
		WHERE pg.chain_slug = $1
	`, chainSlug)
	if err != nil {
		return nil, fmt.Errorf("failed to query group prices: %w", err)
	}
	defer groupPriceRows.Close()

	// Track prices for average calculation
	itemPrices := make(map[string][]int64)

	for groupPriceRows.Next() {
		var groupID, itemID string
		var price int
		var discountPrice *int
		if err := groupPriceRows.Scan(&groupID, &itemID, &price, &discountPrice); err != nil {
			return nil, fmt.Errorf("failed to scan group price: %w", err)
		}

		// Initialize group map if needed
		if snapshot.groupPrices[groupID] == nil {
			snapshot.groupPrices[groupID] = make(map[string]CachedPrice)
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

		snapshot.groupPrices[groupID][itemID] = cachedPrice

		// Track for average calculation
		itemPrices[itemID] = append(itemPrices[itemID], cachedPrice.Price)
	}

	if err := groupPriceRows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating group prices: %w", err)
	}

	// Load store exceptions
	exceptionRows, err := tx.Query(ctx, `
		SELECT spe.store_id, spe.retailer_item_id, spe.price, spe.discount_price
		FROM store_price_exceptions spe
		JOIN stores s ON s.id = spe.store_id
		WHERE s.chain_slug = $1 AND spe.valid_to > NOW()
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
		Int("stores", len(snapshot.storeToGroup)).
		Int("groups", len(snapshot.groupPrices)).
		Int("exceptions", len(snapshot.exceptions)).
		Dur("duration", duration).
		Msg("Loaded chain cache snapshot")

	return snapshot, nil
}

// GetPrice retrieves the price for a specific item at a store.
// It checks exceptions first, then resolves via group mapping.
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

	// 2. Get group for store (nil-map safe)
	groupID, ok := snapshot.storeToGroup[storeID]
	if !ok {
		return CachedPrice{}, false
	}

	// 3. Get price from group (nil-map safe)
	groupPrices, ok := snapshot.groupPrices[groupID]
	if !ok {
		return CachedPrice{}, false
	}

	price, ok := groupPrices[itemID]
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

	storeIDs := make([]string, 0, len(snapshot.storeToGroup))
	for storeID := range snapshot.storeToGroup {
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

	// groupPrices: map overhead + entries
	size += int64(len(s.groupPrices)) * 64 // map overhead
	for groupID, items := range s.groupPrices {
		size += int64(len(groupID)) + 64 // groupID + map entry overhead
		size += int64(len(items)) * 64   // items map overhead
		for itemID := range items {
			size += int64(len(itemID)) + 32 // itemID + CachedPrice
		}
	}

	// storeToGroup
	size += int64(len(s.storeToGroup)) * 64
	for storeID, groupID := range s.storeToGroup {
		size += int64(len(storeID)+len(groupID)) + 16
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

// Do executes a single-flight call.
func (g *singleFlightGroup) Do(key string, fn func() (interface{}, error)) (interface{}, error, bool) {
	g.mu.Lock()
	if g.calls == nil {
		g.calls = make(map[string]*singleFlightCall)
	}

	if call, ok := g.calls[key]; ok {
		g.mu.Unlock()
		call.wg.Wait()
		return call.val, call.err, false // shared result
	}

	call := &singleFlightCall{}
	call.wg.Add(1)
	g.calls[key] = call
	g.mu.Unlock()

	// Execute function
	result, err := fn()
	call.val, call.err = result.(*ChainCacheSnapshot), err
	call.wg.Done()

	g.mu.Lock()
	delete(g.calls, key)
	g.mu.Unlock()

	return call.val, call.err, true // new result
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
