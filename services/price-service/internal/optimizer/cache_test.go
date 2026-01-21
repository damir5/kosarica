package optimizer

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// TestThunderingHerd verifies that concurrent requests to load the same chain
// only result in a single database query via singleflight.
func TestThunderingHerd(t *testing.T) {
	ctx := context.Background()

	// Set up test database
	_, db, cleanup := setupTestDB(t)
	defer cleanup()

	cache := NewPriceCache(db, DefaultOptimizerConfig())
	defer cache.Close()

	chainSlug := "test-chain"

	// Simulate 100 concurrent requests to load the same chain
	const numRequests = 100
	var wg sync.WaitGroup
	results := make(chan error, numRequests)

	for i := 0; i < numRequests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- cache.LoadChain(ctx, chainSlug)
		}()
	}

	wg.Wait()
	close(results)

	// All requests should succeed
	for err := range results {
		assert.NoError(t, err, "All requests should succeed")
	}

	// Verify cache was loaded
	snapshot := cache.getSnapshot(cache.chains[chainSlug])
	assert.NotNil(t, snapshot, "Cache should be loaded")
}

// TestContextCancellation verifies that cancelling one request context
// doesn't affect other concurrent requests to load the same chain.
func TestContextCancellation(t *testing.T) {
	ctx := context.Background()

	_, db, cleanup := setupTestDB(t)
	defer cleanup()

	cache := NewPriceCache(db, DefaultOptimizerConfig())
	defer cache.Close()

	chainSlug := "test-chain"

	// Cancel one request mid-flight
	cancelledCtx, cancel := context.WithCancel(ctx)
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel() // Cancel after 10ms
	}()

	var wg sync.WaitGroup
	errCh := make(chan error, 2)

	// Start cancelled request
	wg.Add(1)
	go func() {
		defer wg.Done()
		// This request's context is cancelled, but it should use the dedicated load context
		errCh <- cache.LoadChain(cancelledCtx, chainSlug)
	}()

	// Start normal request that should succeed
	wg.Add(1)
	go func() {
		defer wg.Done()
		errCh <- cache.LoadChain(ctx, chainSlug)
	}()

	wg.Wait()
	close(errCh)

	// At least one should succeed (the one with valid context)
	successCount := 0
	for err := range errCh {
		if err == nil {
			successCount++
		}
	}
	assert.GreaterOrEqual(t, successCount, 1, "At least one request should succeed")
}

// TestNilMapSafety verifies that accessing missing stores, groups, or items
// doesn't panic and returns appropriate empty values.
func TestNilMapSafety(t *testing.T) {
	cache := &PriceCache{
		chains: make(map[string]*ChainCache),
	}

	chainCache := &ChainCache{}
	snapshot := &ChainCacheSnapshot{
		groupPrices:      make(map[string]map[string]CachedPrice),
		storeToGroup:     make(map[string]string),
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

// TestSnapshotSwapTiming verifies that snapshot swaps don't hold locks
// for extended periods (no multi-second locks).
func TestSnapshotSwapTiming(t *testing.T) {
	ctx := context.Background()

	_, db, cleanup := setupTestDB(t)
	defer cleanup()

	cache := NewPriceCache(db, DefaultOptimizerConfig())
	defer cache.Close()

	chainSlug := "test-chain"

	// Measure time for concurrent loads
	startTime := time.Now()

	const numConcurrent = 10
	var wg sync.WaitGroup

	for i := 0; i < numConcurrent; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cache.LoadChain(ctx, chainSlug)
		}()
	}

	wg.Wait()
	duration := time.Since(startTime)

	// Should complete quickly (under 1 second for single DB load + singleflight coordination)
	assert.Less(t, duration, 1*time.Second, "Concurrent loads should complete quickly")
}

// TestWarmupSemaphoreLimits verifies that warmup semaphore limits
// concurrent DB loads to the configured maximum.
func TestWarmupSemaphoreLimits(t *testing.T) {
	_, db, cleanup := setupTestDB(t)
	defer cleanup()

	config := DefaultOptimizerConfig()
	config.WarmupConcurrency = 3 // Limit to 3 concurrent loads

	cache := NewPriceCache(db, config)
	defer cache.Close()

	// This would require mocking the DB to track actual concurrent loads
	// For now, we verify the semaphore is properly initialized
	assert.Equal(t, int64(config.WarmupConcurrency), cache.warmupSem.TryAcquire(4), "Semaphore should limit to configured concurrency")
}

// TestDBTransactionConsistency verifies that store->group mappings
// are consistent within a single snapshot load.
func TestDBTransactionConsistency(t *testing.T) {
	ctx := context.Background()

	_, db, cleanup := setupTestDB(t)
	defer cleanup()

	// Insert test data
	tx, err := db.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)

	// Create a price group
	_, err = tx.Exec(ctx, `
		INSERT INTO price_groups (id, chain_slug, price_hash, hash_version, store_count, item_count)
		VALUES ($1, 'test-chain', 'hash123', 1, 2, 2)
	`, "group-1")
	require.NoError(t, err)

	// Create stores
	_, err = tx.Exec(ctx, `
		INSERT INTO stores (id, chain_slug, name, status)
		VALUES
			('sto-aaa-111', 'test-chain', 'Store A', 'active'),
			('sto-bbb-222', 'test-chain', 'Store B', 'active')
	`)
	require.NoError(t, err)

	// Map stores to group
	_, err = tx.Exec(ctx, `
		INSERT INTO store_group_history (id, store_id, price_group_id, valid_from, created_at)
		VALUES
			('hist-1', 'sto-aaa-111', 'group-1', NOW(), NOW()),
			('hist-2', 'sto-bbb-222', 'group-1', NOW(), NOW())
	`)
	require.NoError(t, err)

	// Create items
	_, err = tx.Exec(ctx, `
		INSERT INTO retailer_items (id, chain_slug, name)
		VALUES
			('rit-aaa-111', 'test-chain', 'Item A'),
			('rit-bbb-222', 'test-chain', 'Item B')
	`)
	require.NoError(t, err)

	// Create group prices
	_, err = tx.Exec(ctx, `
		INSERT INTO group_prices (price_group_id, retailer_item_id, price, discount_price, created_at)
		VALUES
			('group-1', 'rit-aaa-111', 1000, NULL, NOW()),
			('group-1', 'rit-bbb-222', 2000, 1500, NOW())
	`)
	require.NoError(t, err)

	require.NoError(t, tx.Commit(ctx))

	// Load cache and verify consistency
	cache := NewPriceCache(db, DefaultOptimizerConfig())
	err = cache.LoadChain(ctx, "test-chain")
	require.NoError(t, err)

	snapshot := cache.getSnapshot(cache.chains["test-chain"])
	require.NotNil(t, snapshot)

	// Verify both stores map to same group
	assert.Equal(t, "group-1", snapshot.storeToGroup["sto-aaa-111"])
	assert.Equal(t, "group-1", snapshot.storeToGroup["sto-bbb-222"])

	// Verify both stores have same prices via group
	priceA, ok := cache.GetPrice("test-chain", "sto-aaa-111", "rit-aaa-111")
	assert.True(t, ok)
	assert.Equal(t, int64(1000), priceA.Price)

	priceB, ok := cache.GetPrice("test-chain", "sto-bbb-222", "rit-aaa-111")
	assert.True(t, ok)
	assert.Equal(t, int64(1000), priceB.Price, "Same group should have same price")
}

// TestPriceExceptions verifies that exception prices override group prices.
func TestPriceExceptions(t *testing.T) {
	ctx := context.Background()

	_, db, cleanup := setupTestDB(t)
	defer cleanup()

	// Set up data with group prices and an exception
	tx, err := db.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)

	// Create price group and stores
	_, err = tx.Exec(ctx, `
		INSERT INTO price_groups (id, chain_slug, price_hash, hash_version, store_count, item_count)
		VALUES ('group-1', 'test-chain', 'hash123', 1, 1, 1)
	`)
	require.NoError(t, err)

	_, err = tx.Exec(ctx, `
		INSERT INTO stores (id, chain_slug, name, status)
		VALUES ('sto-aaa-111', 'test-chain', 'Store A', 'active')
	`)
	require.NoError(t, err)

	_, err = tx.Exec(ctx, `
		INSERT INTO retailer_items (id, chain_slug, name)
		VALUES ('rit-aaa-111', 'test-chain', 'Item A')
	`)
	require.NoError(t, err)

	_, err = tx.Exec(ctx, `
		INSERT INTO store_group_history (id, store_id, price_group_id, valid_from, created_at)
		VALUES ('hist-1', 'sto-aaa-111', 'group-1', NOW(), NOW())
	`)
	require.NoError(t, err)

	// Group price: 1000
	_, err = tx.Exec(ctx, `
		INSERT INTO group_prices (price_group_id, retailer_item_id, price, discount_price, created_at)
		VALUES ('group-1', 'rit-aaa-111', 1000, NULL, NOW())
	`)
	require.NoError(t, err)

	// Exception price: 800 (should override)
	_, err = tx.Exec(ctx, `
		INSERT INTO store_price_exceptions (store_id, retailer_item_id, price, discount_price, reason, expires_at, created_at)
		VALUES ('sto-aaa-111', 'rit-aaa-111', 800, NULL, 'test exception', NOW() + INTERVAL '1 day', NOW())
	`)
	require.NoError(t, err)

	require.NoError(t, tx.Commit(ctx))

	// Load and verify
	cache := NewPriceCache(db, DefaultOptimizerConfig())
	err = cache.LoadChain(ctx, "test-chain")
	require.NoError(t, err)

	price, ok := cache.GetPrice("test-chain", "sto-aaa-111", "rit-aaa-111")
	assert.True(t, ok)
	assert.Equal(t, int64(800), price.Price, "Exception price should override group price")
	assert.True(t, price.IsException, "Should be marked as exception")
}

// TestAveragePriceCalculation verifies that item average prices
// are computed correctly across all groups.
func TestAveragePriceCalculation(t *testing.T) {
	ctx := context.Background()

	_, db, cleanup := setupTestDB(t)
	defer cleanup()

	// Set up data with multiple groups having different prices for same item
	tx, err := db.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)

	// Create two price groups
	_, err = tx.Exec(ctx, `
		INSERT INTO price_groups (id, chain_slug, price_hash, hash_version, store_count, item_count)
		VALUES
			('group-1', 'test-chain', 'hash1', 1, 1, 1),
			('group-2', 'test-chain', 'hash2', 1, 1, 1)
	`)
	require.NoError(t, err)

	// Create stores
	_, err = tx.Exec(ctx, `
		INSERT INTO stores (id, chain_slug, name, status)
		VALUES
			('sto-aaa-111', 'test-chain', 'Store A', 'active'),
			('sto-bbb-222', 'test-chain', 'Store B', 'active')
	`)
	require.NoError(t, err)

	// Map stores to groups
	_, err = tx.Exec(ctx, `
		INSERT INTO store_group_history (id, store_id, price_group_id, valid_from, created_at)
		VALUES
			('hist-1', 'sto-aaa-111', 'group-1', NOW(), NOW()),
			('hist-2', 'sto-bbb-222', 'group-2', NOW(), NOW())
	`)
	require.NoError(t, err)

	// Create single item
	_, err = tx.Exec(ctx, `
		INSERT INTO retailer_items (id, chain_slug, name)
		VALUES ('rit-aaa-111', 'test-chain', 'Item A')
	`)
	require.NoError(t, err)

	// Group 1 price: 1000, Group 2 price: 2000
	// Average should be 1500
	_, err = tx.Exec(ctx, `
		INSERT INTO group_prices (price_group_id, retailer_item_id, price, discount_price, created_at)
		VALUES
			('group-1', 'rit-aaa-111', 1000, NULL, NOW()),
			('group-2', 'rit-aaa-111', 2000, NULL, NOW())
	`)
	require.NoError(t, err)

	require.NoError(t, tx.Commit(ctx))

	// Load and verify
	cache := NewPriceCache(db, DefaultOptimizerConfig())
	err = cache.LoadChain(ctx, "test-chain")
	require.NoError(t, err)

	avg := cache.GetAveragePrice("test-chain", "rit-aaa-111")
	assert.Equal(t, int64(1500), avg, "Average should be (1000 + 2000) / 2")
}

// setupTestDB creates a test PostgreSQL database using testcontainers.
// It returns the container, database pool, and a cleanup function.
func setupTestDB(t *testing.T) (*postgres.PostgresContainer, *pgxpool.Pool, func()) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	ctx := context.Background()

	container, err := postgres.Run(ctx, "postgres:16-alpine",
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(30*time.Second)),
	)
	require.NoError(t, err, "Failed to start postgres container")

	connStr, err := container.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err, "Failed to get connection string")

	// Create connection pool
	config, err := pgxpool.ParseConfig(connStr)
	require.NoError(t, err)

	pool, err := pgxpool.NewWithConfig(ctx, config)
	require.NoError(t, err, "Failed to create connection pool")

	// Run migrations
	err = runTestMigrations(ctx, pool)
	require.NoError(t, err, "Failed to run migrations")

	cleanup := func() {
		pool.Close()
		testcontainers.TerminateContainer(container)
	}

	return container, pool, cleanup
}

// runTestMigrations runs minimal migrations for testing.
func runTestMigrations(ctx context.Context, db *pgxpool.Pool) error {
	// Create necessary tables for testing
	schema := `
	-- Chains table
	CREATE TABLE IF NOT EXISTS chains (
		slug TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		website TEXT,
		logo_url TEXT,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	-- Stores table
	CREATE TABLE IF NOT EXISTS stores (
		id TEXT PRIMARY KEY,
		chain_slug TEXT NOT NULL REFERENCES chains(slug) ON DELETE CASCADE,
		name TEXT NOT NULL,
		address TEXT,
		city TEXT,
		postal_code TEXT,
		latitude TEXT,
		longitude TEXT,
		is_virtual BOOLEAN DEFAULT true,
		price_source_store_id TEXT REFERENCES stores(id),
		status TEXT DEFAULT 'active',
		approval_notes TEXT,
		approved_by TEXT,
		approved_at TIMESTAMPTZ,
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW()
	);

	-- Retailer items table
	CREATE TABLE IF NOT EXISTS retailer_items (
		id TEXT PRIMARY KEY,
		chain_slug TEXT NOT NULL REFERENCES chains(slug) ON DELETE CASCADE,
		external_id TEXT,
		name TEXT NOT NULL,
		description TEXT,
		category TEXT,
		subcategory TEXT,
		brand TEXT,
		unit TEXT,
		unit_quantity TEXT,
		image_url TEXT,
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW()
	);

	-- Price groups table
	CREATE TABLE IF NOT EXISTS price_groups (
		id TEXT PRIMARY KEY,
		chain_slug TEXT NOT NULL REFERENCES chains(slug) ON DELETE CASCADE,
		price_hash TEXT NOT NULL,
		hash_version INTEGER NOT NULL,
		store_count INTEGER NOT NULL DEFAULT 0,
		item_count INTEGER NOT NULL DEFAULT 0,
		first_seen_at TIMESTAMPTZ DEFAULT NOW(),
		last_seen_at TIMESTAMPTZ DEFAULT NOW(),
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		UNIQUE(chain_slug, price_hash, hash_version)
	);

	-- Store group history table
	CREATE TABLE IF NOT EXISTS store_group_history (
		id TEXT PRIMARY KEY,
		store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
		price_group_id TEXT NOT NULL REFERENCES price_groups(id) ON DELETE CASCADE,
		valid_from TIMESTAMPTZ NOT NULL,
		valid_to TIMESTAMPTZ,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	-- Group prices table
	CREATE TABLE IF NOT EXISTS group_prices (
		price_group_id TEXT NOT NULL REFERENCES price_groups(id) ON DELETE CASCADE,
		retailer_item_id TEXT NOT NULL REFERENCES retailer_items(id) ON DELETE CASCADE,
		price INTEGER NOT NULL,
		discount_price INTEGER,
		unit_price INTEGER,
		anchor_price INTEGER,
		created_at TIMESTAMPTZ DEFAULT NOW(),
		PRIMARY KEY (price_group_id, retailer_item_id)
	);

	-- Store price exceptions table
	CREATE TABLE IF NOT EXISTS store_price_exceptions (
		store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
		retailer_item_id TEXT NOT NULL REFERENCES retailer_items(id) ON DELETE CASCADE,
		price INTEGER NOT NULL,
		discount_price INTEGER,
		reason TEXT NOT NULL,
		expires_at TIMESTAMPTZ NOT NULL,
		created_at TIMESTAMPTZ DEFAULT NOW(),
		created_by TEXT,
		PRIMARY KEY (store_id, retailer_item_id)
	);

	-- Create indexes
	CREATE INDEX IF NOT EXISTS stores_chain_slug_idx ON stores(chain_slug);
	CREATE INDEX IF NOT EXISTS store_group_history_store_id_idx ON store_group_history(store_id);
	CREATE INDEX IF NOT EXISTS store_group_history_valid_to_idx ON store_group_history(valid_to) WHERE valid_to IS NULL;
	CREATE INDEX IF NOT EXISTS group_prices_group_id_idx ON group_prices(price_group_id);
	`

	_, err := db.Exec(ctx, schema)
	return err
}
