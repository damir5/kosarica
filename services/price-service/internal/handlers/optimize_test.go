package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/kosarica/price-service/internal/optimizer"
)

// TestOptimizeSingleHappyPath tests the single-store optimization happy path.
func TestOptimizeSingleHappyPath(t *testing.T) {
	ctx := context.Background()

	_, db, cleanup := setupHandlersTestDB(t)
	defer cleanup()

	// Set up test data
	setupTestData(ctx, t, db)

	// Initialize cache and optimizers
	config := optimizer.DefaultOptimizerConfig()
	metrics := optimizer.NewMetricsRecorder()
	cache := optimizer.NewPriceCache(db, config)

	err := cache.LoadChain(ctx, "test-chain")
	require.NoError(t, err)

	InitOptimizers(cache, config, metrics)

	// Create router
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/internal/basket/optimize/single", OptimizeSingle)

	// Create request
	reqBody := OptimizeRequest{
		ChainSlug: "test-chain",
		BasketItems: []*BasketItem{
			{ItemID: "rit-aaa-111", Name: "Item A", Quantity: 2},
			{ItemID: "rit-bbb-222", Name: "Item B", Quantity: 1},
		},
	}

	jsonBody, err := json.Marshal(reqBody)
	require.NoError(t, err)

	req, err := http.NewRequest("POST", "/internal/basket/optimize/single", bytes.NewBuffer(jsonBody))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")

	// Record response
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Assert response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.NotEmpty(t, response["results"])
	results := response["results"].([]interface{})
	assert.Greater(t, len(results), 0, "Should return at least one store")

	firstResult := results[0].(map[string]interface{})
	assert.NotEmpty(t, firstResult["storeId"])
	assert.NotEmpty(t, firstResult["coverageRatio"])
	assert.NotEmpty(t, firstResult["sortingTotal"])
}

// TestOptimizeMultiHappyPath tests the multi-store optimization happy path.
func TestOptimizeMultiHappyPath(t *testing.T) {
	ctx := context.Background()

	_, db, cleanup := setupHandlersTestDB(t)
	defer cleanup()

	// Set up test data with multiple stores
	setupMultiStoreTestData(ctx, t, db)

	// Initialize cache and optimizers
	config := optimizer.DefaultOptimizerConfig()
	metrics := optimizer.NewMetricsRecorder()
	cache := optimizer.NewPriceCache(db, config)

	err := cache.LoadChain(ctx, "test-chain")
	require.NoError(t, err)

	InitOptimizers(cache, config, metrics)

	// Create router
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/internal/basket/optimize/multi", OptimizeMulti)

	// Create request
	reqBody := OptimizeRequest{
		ChainSlug: "test-chain",
		BasketItems: []*BasketItem{
			{ItemID: "rit-aaa-111", Name: "Item A", Quantity: 2},
			{ItemID: "rit-bbb-222", Name: "Item B", Quantity: 1},
		},
		MaxStores: 3,
	}

	jsonBody, err := json.Marshal(reqBody)
	require.NoError(t, err)

	req, err := http.NewRequest("POST", "/internal/basket/optimize/multi", bytes.NewBuffer(jsonBody))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")

	// Record response
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Assert response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.NotEmpty(t, response["stores"])
	assert.NotEmpty(t, response["combinedTotal"])
	assert.NotEmpty(t, response["coverageRatio"])
	assert.NotEmpty(t, response["algorithmUsed"])
}

// TestOptimizeValidationErrors tests validation error responses.
func TestOptimizeValidationErrors(t *testing.T) {
	// Set cache to nil to ensure validation happens before cache check
	// These tests verify Gin's request binding validation, not optimization logic
	InitOptimizers(nil, nil, nil)

	tests := []struct {
		name       string
		reqBody    OptimizeRequest
		wantStatus int
		wantError  string
	}{
		{
			name: "empty chain slug",
			reqBody: OptimizeRequest{
				ChainSlug: "",
				BasketItems: []*BasketItem{
					{ItemID: "rit-aaa-111", Name: "Item A", Quantity: 1},
				},
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "empty basket items",
			reqBody: OptimizeRequest{
				ChainSlug:   "test-chain",
				BasketItems: []*BasketItem{},
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "invalid latitude",
			reqBody: OptimizeRequest{
				ChainSlug: "test-chain",
				BasketItems: []*BasketItem{
					{ItemID: "rit-aaa-111", Name: "Item A", Quantity: 1},
				},
				Location: &Location{Latitude: 95, Longitude: 0},
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "invalid longitude",
			reqBody: OptimizeRequest{
				ChainSlug: "test-chain",
				BasketItems: []*BasketItem{
					{ItemID: "rit-aaa-111", Name: "Item A", Quantity: 1},
				},
				Location: &Location{Latitude: 0, Longitude: 185},
			},
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			router := gin.New()
			router.POST("/internal/basket/optimize/single", OptimizeSingle)

			jsonBody, err := json.Marshal(tt.reqBody)
			require.NoError(t, err)

			req, err := http.NewRequest("POST", "/internal/basket/optimize/single", bytes.NewBuffer(jsonBody))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")

			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			assert.Equal(t, tt.wantStatus, w.Code)
		})
	}
}

// TestOptimizeCacheUnavailable tests 503 when cache unavailable.
func TestOptimizeCacheUnavailable(t *testing.T) {
	// Don't initialize cache - should return 503
	InitOptimizers(nil, nil, nil)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/internal/basket/optimize/single", OptimizeSingle)

	reqBody := OptimizeRequest{
		ChainSlug: "test-chain",
		BasketItems: []*BasketItem{
			{ItemID: "rit-aaa-111", Name: "Item A", Quantity: 1},
		},
	}

	jsonBody, err := json.Marshal(reqBody)
	require.NoError(t, err)

	req, err := http.NewRequest("POST", "/internal/basket/optimize/single", bytes.NewBuffer(jsonBody))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

// TestHaversineEdgeCases tests Haversine calculation edge cases.
func TestHaversineEdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		lat1     float64
		lon1     float64
		lat2     float64
		lon2     float64
		wantDist float64
	}{
		{
			name:     "same point",
			lat1:     45.0, lon1: 16.0,
			lat2: 45.0, lon2: 16.0,
			wantDist: 0,
		},
		{
			name:     "poles - north pole to south pole",
			lat1:     90.0, lon1: 0.0,
			lat2: -90.0, lon2: 0.0,
			wantDist: 20015, // Approximately half Earth's circumference
		},
		{
			name:     "date line crossing",
			lat1:     0.0, lon1: 179.0,
			lat2: 0.0, lon2: -179.0,
			wantDist: 222, // About 2 degrees of longitude at equator
		},
		{
			name:     "short distance",
			lat1:     45.0, lon1: 16.0,
			lat2: 45.1, lon2: 16.1,
			wantDist: 15, // Approximately 15km
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dist := optimizer.HaversineKm(tt.lat1, tt.lon1, tt.lat2, tt.lon2)
			// Allow 10% error margin for approximate distances
			assert.InDelta(t, tt.wantDist, dist, tt.wantDist*0.10)
		})
	}
}

// TestCacheHealthEndpoint tests the cache health endpoint.
func TestCacheHealthEndpoint(t *testing.T) {
	ctx := context.Background()

	_, db, cleanup := setupHandlersTestDB(t)
	defer cleanup()

	// Set up test data
	setupTestData(ctx, t, db)

	// Initialize cache and optimizers
	config := optimizer.DefaultOptimizerConfig()
	metrics := optimizer.NewMetricsRecorder()
	cache := optimizer.NewPriceCache(db, config)

	err := cache.LoadChain(ctx, "test-chain")
	require.NoError(t, err)

	InitOptimizers(cache, config, metrics)

	// Create router
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/internal/basket/cache/health", CacheHealth)

	req, err := http.NewRequest("GET", "/internal/basket/cache/health", nil)
	require.NoError(t, err)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, "ok", response["status"])
	assert.NotEmpty(t, response["chains"])
}

// TestCacheWarmupEndpoint tests the cache warmup endpoint.
func TestCacheWarmupEndpoint(t *testing.T) {
	ctx := context.Background()

	_, db, cleanup := setupHandlersTestDB(t)
	defer cleanup()

	// Set up test data
	setupTestData(ctx, t, db)

	// Initialize cache and optimizers
	config := optimizer.DefaultOptimizerConfig()
	metrics := optimizer.NewMetricsRecorder()
	cache := optimizer.NewPriceCache(db, config)

	InitOptimizers(cache, config, metrics)

	// Create router
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/internal/basket/cache/warmup", CacheWarmup)

	req, err := http.NewRequest("POST", "/internal/basket/cache/warmup", nil)
	require.NoError(t, err)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, "ok", response["status"])
}

// setupHandlersTestDB creates a test database for handler tests.
func setupHandlersTestDB(t *testing.T) (*postgres.PostgresContainer, *pgxpool.Pool, func()) {
	if testing.Short() {
		t.Skip("skipping handler test in short mode (requires Docker)")
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

	config, err := pgxpool.ParseConfig(connStr)
	require.NoError(t, err)

	pool, err := pgxpool.NewWithConfig(ctx, config)
	require.NoError(t, err, "Failed to create connection pool")

	err = runHandlersTestMigrations(ctx, pool)
	require.NoError(t, err, "Failed to run migrations")

	cleanup := func() {
		pool.Close()
		testcontainers.TerminateContainer(container)
	}

	return container, pool, cleanup
}

// runHandlersTestMigrations runs migrations for handler tests.
func runHandlersTestMigrations(ctx context.Context, db *pgxpool.Pool) error {
	schema := `
	CREATE TABLE IF NOT EXISTS chains (
		slug TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		website TEXT,
		logo_url TEXT,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

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

	CREATE TABLE IF NOT EXISTS store_group_history (
		id TEXT PRIMARY KEY,
		store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
		price_group_id TEXT NOT NULL REFERENCES price_groups(id) ON DELETE CASCADE,
		valid_from TIMESTAMPTZ NOT NULL,
		valid_to TIMESTAMPTZ,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

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

	CREATE INDEX IF NOT EXISTS stores_chain_slug_idx ON stores(chain_slug);
	CREATE INDEX IF NOT EXISTS store_group_history_store_id_idx ON store_group_history(store_id);
	CREATE INDEX IF NOT EXISTS store_group_history_valid_to_idx ON store_group_history(valid_to) WHERE valid_to IS NULL;
	CREATE INDEX IF NOT EXISTS group_prices_group_id_idx ON group_prices(price_group_id);
	`

	_, err := db.Exec(ctx, schema)
	return err
}

// setupTestData sets up basic test data.
func setupTestData(ctx context.Context, t *testing.T, db *pgxpool.Pool) {
	tx, err := db.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)

	// Create chain
	_, err = tx.Exec(ctx, `INSERT INTO chains (slug, name) VALUES ('test-chain', 'Test Chain')`)
	require.NoError(t, err)

	// Create price group
	_, err = tx.Exec(ctx, `
		INSERT INTO price_groups (id, chain_slug, price_hash, hash_version, store_count, item_count)
		VALUES ('group-1', 'test-chain', 'hash123', 1, 1, 2)
	`)
	require.NoError(t, err)

	// Create store
	_, err = tx.Exec(ctx, `
		INSERT INTO stores (id, chain_slug, name, status, latitude, longitude)
		VALUES ('sto-aaa-111', 'test-chain', 'Store A', 'active', '45.0', '16.0')
	`)
	require.NoError(t, err)

	// Map store to group
	_, err = tx.Exec(ctx, `
		INSERT INTO store_group_history (id, store_id, price_group_id, valid_from, created_at)
		VALUES ('hist-1', 'sto-aaa-111', 'group-1', NOW(), NOW())
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

	// Create prices
	_, err = tx.Exec(ctx, `
		INSERT INTO group_prices (price_group_id, retailer_item_id, price, discount_price, created_at)
		VALUES
			('group-1', 'rit-aaa-111', 1000, NULL, NOW()),
			('group-1', 'rit-bbb-222', 2000, 1500, NOW())
	`)
	require.NoError(t, err)

	require.NoError(t, tx.Commit(ctx))
}

// setupMultiStoreTestData sets up test data for multi-store optimization.
func setupMultiStoreTestData(ctx context.Context, t *testing.T, db *pgxpool.Pool) {
	tx, err := db.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)

	// Create chain
	_, err = tx.Exec(ctx, `INSERT INTO chains (slug, name) VALUES ('test-chain', 'Test Chain')`)
	require.NoError(t, err)

	// Create price groups with different prices
	_, err = tx.Exec(ctx, `
		INSERT INTO price_groups (id, chain_slug, price_hash, hash_version, store_count, item_count)
		VALUES
			('group-1', 'test-chain', 'hash1', 1, 1, 2),
			('group-2', 'test-chain', 'hash2', 1, 1, 2)
	`)
	require.NoError(t, err)

	// Create stores at different locations
	_, err = tx.Exec(ctx, `
		INSERT INTO stores (id, chain_slug, name, status, latitude, longitude)
		VALUES
			('sto-aaa-111', 'test-chain', 'Store A', 'active', '45.0', '16.0'),
			('sto-bbb-222', 'test-chain', 'Store B', 'active', '45.1', '16.1'),
			('sto-ccc-333', 'test-chain', 'Store C', 'active', '45.2', '16.2')
	`)
	require.NoError(t, err)

	// Map stores to groups
	_, err = tx.Exec(ctx, `
		INSERT INTO store_group_history (id, store_id, price_group_id, valid_from, created_at)
		VALUES
			('hist-1', 'sto-aaa-111', 'group-1', NOW(), NOW()),
			('hist-2', 'sto-bbb-222', 'group-1', NOW(), NOW()),
			('hist-3', 'sto-ccc-333', 'group-2', NOW(), NOW())
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

	// Create prices - group-1 has cheaper prices for A, group-2 has cheaper for B
	_, err = tx.Exec(ctx, `
		INSERT INTO group_prices (price_group_id, retailer_item_id, price, discount_price, created_at)
		VALUES
			('group-1', 'rit-aaa-111', 1000, NULL, NOW()),
			('group-1', 'rit-bbb-222', 2000, 1500, NOW()),
			('group-2', 'rit-aaa-111', 1200, NULL, NOW()),
			('group-2', 'rit-bbb-222', 1800, 1700, NOW())
	`)
	require.NoError(t, err)

	require.NoError(t, tx.Commit(ctx))
}
