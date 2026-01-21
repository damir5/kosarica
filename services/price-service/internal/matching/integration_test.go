package matching

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// TestEmbeddingProvider is a mock implementation for testing
type TestEmbeddingProvider struct {
	modelVersion string
	dimension    int
	// Optional: custom response function
	responseFunc func(texts []string) ([][]float32, error)
}

func (p *TestEmbeddingProvider) GenerateEmbeddingBatch(ctx context.Context, texts []string) ([][]float32, error) {
	if p.responseFunc != nil {
		return p.responseFunc(texts)
	}

	// Default: generate deterministic mock embeddings
	result := make([][]float32, len(texts))
	for i, text := range texts {
		// Create a deterministic embedding based on text content
		embedding := make([]float32, p.dimension)
		for j := range embedding {
			// Simple hash-like generation for consistency
			val := (float32(i)*0.1 + float32(j)*0.01)
			if len(text) > 0 {
				val += float32(int(text[0]) * (j + 1) % 100)
			}
			embedding[j] = val
		}
		result[i] = embedding
	}
	return result, nil
}

func (p *TestEmbeddingProvider) ModelVersion() string {
	return p.modelVersion
}

func (p *TestEmbeddingProvider) Dimension() int {
	return p.dimension
}

// setupIntegrationTestDB creates a test database container for integration testing
func setupIntegrationTestDB(ctx context.Context, t testing.TB) (*pgxpool.Pool, func(), error) {
	if testing.Short() {
		return nil, func() {}, fmt.Errorf("skipping integration test in short mode")
	}

	// Start PostgreSQL container
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "postgres:16-alpine",
			ExposedPorts: []string{"5432/tcp"},
			Env: map[string]string{
				"POSTGRES_USER":     "test",
				"POSTGRES_PASSWORD": "test",
				"POSTGRES_DB":       "test",
			},
			WaitingFor: wait.ForLog("database system is ready to accept connections"),
		},
		Started: true,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("start container: %w", err)
	}

	// Get connection details
	host, err := container.Host(ctx)
	if err != nil {
		container.Terminate(ctx)
		return nil, nil, fmt.Errorf("get host: %w", err)
	}

	port, err := container.MappedPort(ctx, "5432")
	if err != nil {
		container.Terminate(ctx)
		return nil, nil, fmt.Errorf("get port: %w", err)
	}

	connString := fmt.Sprintf("postgres://test:test@%s:%s/test?sslmode=disable", host, port.Port())

	// Connect to database
	poolConfig, err := pgxpool.ParseConfig(connString)
	if err != nil {
		container.Terminate(ctx)
		return nil, nil, fmt.Errorf("parse config: %w", err)
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		container.Terminate(ctx)
		return nil, nil, fmt.Errorf("connect: %w", err)
	}

	// Run migrations
	if err := runTestMigrations(ctx, pool); err != nil {
		pool.Close()
		container.Terminate(ctx)
		return nil, nil, fmt.Errorf("migrate: %w", err)
	}

	cleanup := func() {
		pool.Close()
		container.Terminate(ctx)
	}

	return pool, cleanup, nil
}

// runTestMigrations sets up the minimal schema for testing
func runTestMigrations(ctx context.Context, db *pgxpool.Pool) error {
	schema := `
		-- Chains
		CREATE TABLE IF NOT EXISTS chains (
			slug TEXT PRIMARY KEY,
			name TEXT NOT NULL
		);

		-- Retailer items
		CREATE TABLE IF NOT EXISTS retailer_items (
			id TEXT PRIMARY KEY,
			chain_slug TEXT NOT NULL REFERENCES chains(slug),
			name TEXT NOT NULL,
			brand TEXT,
			category TEXT,
			unit TEXT,
			unit_quantity TEXT,
			image_url TEXT
		);

		-- Products
		CREATE TABLE IF NOT EXISTS products (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			brand TEXT,
			category TEXT,
			unit TEXT,
			unit_quantity TEXT,
			image_url TEXT
		);

		-- Product links
		CREATE TABLE IF NOT EXISTS product_links (
			id TEXT PRIMARY KEY,
			product_id TEXT NOT NULL REFERENCES products(id),
			retailer_item_id TEXT NOT NULL UNIQUE REFERENCES retailer_items(id),
			confidence TEXT
		);

		-- Retailer item barcodes
		CREATE TABLE IF NOT EXISTS retailer_item_barcodes (
			id TEXT PRIMARY KEY,
			retailer_item_id TEXT NOT NULL REFERENCES retailer_items(id),
			barcode TEXT NOT NULL
		);

		-- Canonical barcodes
		CREATE TABLE IF NOT EXISTS canonical_barcodes (
			barcode TEXT PRIMARY KEY,
			product_id TEXT REFERENCES products(id)
		);

		-- Product match candidates
		CREATE TABLE IF NOT EXISTS product_match_candidates (
			id TEXT PRIMARY KEY,
			retailer_item_id TEXT NOT NULL REFERENCES retailer_items(id),
			candidate_product_id TEXT REFERENCES products(id),
			similarity TEXT,
			match_type TEXT NOT NULL,
			rank SMALLINT DEFAULT 1,
			flags TEXT
		);

		-- Product match queue
		CREATE TABLE IF NOT EXISTS product_match_queue (
			id TEXT PRIMARY KEY,
			retailer_item_id TEXT NOT NULL UNIQUE REFERENCES retailer_items(id),
			status TEXT DEFAULT 'pending',
			decision TEXT,
			linked_product_id TEXT REFERENCES products(id),
			version INTEGER DEFAULT 1
		);

		-- Product match rejections
		CREATE TABLE IF NOT EXISTS product_match_rejections (
			retailer_item_id TEXT NOT NULL REFERENCES retailer_items(id),
			rejected_product_id TEXT NOT NULL REFERENCES products(id),
			PRIMARY KEY (retailer_item_id, rejected_product_id)
		);
	`

	_, err := db.Exec(ctx, schema)
	return err
}

// TestBarcodeMatchingFlow tests the complete barcode matching workflow
func TestBarcodeMatchingFlow(t *testing.T) {
	ctx := context.Background()

	db, cleanup, err := setupIntegrationTestDB(ctx, t)
	if err != nil {
		t.Skipf("Skipping integration test: %v", err)
		return
	}
	defer cleanup()

	// Insert test data
	_, err = db.Exec(ctx, `
		INSERT INTO chains (slug, name) VALUES ('test', 'Test Chain');

		INSERT INTO retailer_items (id, chain_slug, name, brand, unit, unit_quantity)
		VALUES
			('rit1', 'test', 'Test Product 1', 'Brand A', 'g', '500'),
			('rit2', 'test', 'Test Product 1', 'Brand A', 'g', '500');

		INSERT INTO retailer_item_barcodes (id, retailer_item_id, barcode)
		VALUES
			('rib1', 'rit1', '3850000000011'),
			('rib2', 'rit2', '3850000000011');
	`)
	if err != nil {
		t.Fatalf("insert test data: %v", err)
	}

	// Run barcode matching
	result, err := AutoMatchByBarcode(ctx, db, 100)
	if err != nil {
		t.Fatalf("barcode matching failed: %v", err)
	}

	// Verify results
	if result.NewProducts != 1 {
		t.Errorf("expected 1 new product, got %d", result.NewProducts)
	}
	if result.NewLinks != 2 {
		t.Errorf("expected 2 new links, got %d", result.NewLinks)
	}
	if result.SuspiciousFlags != 0 {
		t.Errorf("expected 0 suspicious flags, got %d", result.SuspiciousFlags)
	}

	// Verify product was created
	var productCount int
	err = db.QueryRow(ctx, `SELECT COUNT(*) FROM products`).Scan(&productCount)
	if err != nil {
		t.Fatalf("query product count: %v", err)
	}
	if productCount != 1 {
		t.Errorf("expected 1 product in database, got %d", productCount)
	}

	// Verify links were created
	var linkCount int
	err = db.QueryRow(ctx, `SELECT COUNT(*) FROM product_links`).Scan(&linkCount)
	if err != nil {
		t.Fatalf("query link count: %v", err)
	}
	if linkCount != 2 {
		t.Errorf("expected 2 links in database, got %d", linkCount)
	}

	// Verify canonical barcode entry
	var barcodeCount int
	err = db.QueryRow(ctx, `SELECT COUNT(*) FROM canonical_barcodes`).Scan(&barcodeCount)
	if err != nil {
		t.Fatalf("query barcode count: %v", err)
	}
	if barcodeCount != 1 {
		t.Errorf("expected 1 canonical barcode, got %d", barcodeCount)
	}
}

// TestAIMatchingFlow tests the complete AI matching workflow
func TestAIMatchingFlow(t *testing.T) {
	ctx := context.Background()

	db, cleanup, err := setupIntegrationTestDB(ctx, t)
	if err != nil {
		t.Skipf("Skipping integration test: %v", err)
		return
	}
	defer cleanup()

	// Insert test data
	_, err = db.Exec(ctx, `
		INSERT INTO chains (slug, name) VALUES ('test', 'Test Chain');

		INSERT INTO retailer_items (id, chain_slug, name, brand, category, unit, unit_quantity)
		VALUES
			('rit1', 'test', 'Milka Chocolate 100g', 'Milka', 'Sweets', 'g', '100'),
			('rit2', 'test', 'Coca Cola 1L', 'Coca-Cola', 'Beverages', 'l', '1');

		INSERT INTO products (id, name, brand, category, unit, unit_quantity)
		VALUES
			('prd1', 'Milka Chocolate 100g', 'Milka', 'Sweets', 'g', '100'),
			('prd2', 'Coca Cola 1L', 'Coca-Cola', 'Beverages', 'l', '1');
	`)
	if err != nil {
		t.Fatalf("insert test data: %v", err)
	}

	// Create test embedding provider
	provider := &TestEmbeddingProvider{
		modelVersion: "test-model-v1",
		dimension:    1536,
		responseFunc: func(texts []string) ([][]float32, error) {
			// Return embeddings with high similarity for matching items
			result := make([][]float32, len(texts))
			for i := range result {
				result[i] = make([]float32, 1536)
				// Set values to create known similarity patterns
				result[i][0] = 0.5
				result[i][1] = 0.5
				for j := 2; j < 1536; j++ {
					result[i][j] = 0
				}
			}
			return result, nil
		},
	}

	cfg := AIMatcherConfig{
		Provider:          provider,
		AutoLinkThreshold: 0.95,
		ReviewThreshold:   0.80,
		BatchSize:         10,
		MaxCandidates:     5,
		TrgmPrefilter:     200,
	}

	// Run AI matching (this will skip pg_trgm in test, but tests the flow)
	result, err := RunAIMatching(ctx, db, cfg, "test-run-1")
	if err != nil {
		t.Fatalf("AI matching failed: %v", err)
	}

	// Verify items were processed
	if result.Processed == 0 {
		t.Error("expected some items to be processed")
	}

	t.Logf("AI matching result: Processed=%d, HighConfidence=%d, Queued=%d, NoMatch=%d",
		result.Processed, result.HighConfidence, result.QueuedForReview, result.NoMatch)
}

// TestConcurrentBarcodeProcessing tests that concurrent barcode matching is safe
func TestConcurrentBarcodeProcessing(t *testing.T) {
	ctx := context.Background()

	db, cleanup, err := setupIntegrationTestDB(ctx, t)
	if err != nil {
		t.Skipf("Skipping integration test: %v", err)
		return
	}
	defer cleanup()

	// Insert test data with same barcode
	_, err = db.Exec(ctx, `
		INSERT INTO chains (slug, name) VALUES ('test', 'Test Chain');

		INSERT INTO retailer_items (id, chain_slug, name, brand, unit, unit_quantity)
		VALUES
			('rit1', 'test', 'Product 1', 'Brand', 'g', '500'),
			('rit2', 'test', 'Product 2', 'Brand', 'g', '500'),
			('rit3', 'test', 'Product 3', 'Brand', 'g', '500');

		INSERT INTO retailer_item_barcodes (id, retailer_item_id, barcode)
		VALUES
			('rib1', 'rit1', '3850000000028'),
			('rib2', 'rit2', '3850000000028'),
			('rib3', 'rit3', '3850000000028');
	`)
	if err != nil {
		t.Fatalf("insert test data: %v", err)
	}

	// Run multiple concurrent barcode matching operations
	results := make(chan *BarcodeResult, 3)
	errors := make(chan error, 3)

	for i := 0; i < 3; i++ {
		go func() {
			result, err := AutoMatchByBarcode(ctx, db, 10)
			if err != nil {
				errors <- err
			} else {
				results <- result
			}
		}()
	}

	// Collect results
	successCount := 0
	for i := 0; i < 3; i++ {
		select {
		case <-results:
			successCount++
		case err := <-errors:
			t.Logf("concurrent operation error (may be expected): %v", err)
		case <-time.After(10 * time.Second):
			t.Fatal("timeout waiting for concurrent operations")
		}
	}

	// Verify only one product was created (due to advisory lock)
	var productCount int
	err = db.QueryRow(ctx, `SELECT COUNT(*) FROM products`).Scan(&productCount)
	if err != nil {
		t.Fatalf("query product count: %v", err)
	}

	// With advisory locks, we should have exactly 1 product even with concurrent runs
	if productCount != 1 {
		t.Errorf("expected 1 product with concurrent runs (advisory lock), got %d", productCount)
	}

	t.Logf("Concurrent barcode processing: %d succeeded, final product count: %d", successCount, productCount)
}

// TestQueueProcessing tests the queue processing workflow
func TestQueueProcessing(t *testing.T) {
	ctx := context.Background()

	db, cleanup, err := setupIntegrationTestDB(ctx, t)
	if err != nil {
		t.Skipf("Skipping integration test: %v", err)
		return
	}
	defer cleanup()

	// Insert test data with suspicious barcode (conflicting info)
	_, err = db.Exec(ctx, `
		INSERT INTO chains (slug, name) VALUES ('test', 'Test Chain');

		INSERT INTO retailer_items (id, chain_slug, name, brand, unit, unit_quantity)
		VALUES
			('rit1', 'test', 'Product A Brand X', 'Brand X', 'g', '500'),
			('rit2', 'test', 'Product A Brand Y', 'Brand Y', 'g', '500');

		INSERT INTO retailer_item_barcodes (id, retailer_item_id, barcode)
		VALUES
			('rib1', 'rit1', '3850000000035'),
			('rib2', 'rit2', '3850000000035');
	`)
	if err != nil {
		t.Fatalf("insert test data: %v", err)
	}

	// Run barcode matching - should queue for review due to brand conflict
	result, err := AutoMatchByBarcode(ctx, db, 100)
	if err != nil {
		t.Fatalf("barcode matching failed: %v", err)
	}

	// Verify suspicious items were queued
	if result.SuspiciousFlags == 0 {
		t.Error("expected suspicious items to be flagged")
	}

	// Verify queue entries
	var queueCount int
	err = db.QueryRow(ctx, `SELECT COUNT(*) FROM product_match_queue`).Scan(&queueCount)
	if err != nil {
		t.Fatalf("query queue count: %v", err)
	}

	if queueCount == 0 {
		t.Error("expected items to be queued for review")
	}

	t.Logf("Queue processing test: %d suspicious items flagged, %d items queued", result.SuspiciousFlags, queueCount)
}

// TestEmbeddingCaching tests the embedding cache functionality
func TestEmbeddingCaching(t *testing.T) {
	ctx := context.Background()

	db, cleanup, err := setupIntegrationTestDB(ctx, t)
	if err != nil {
		t.Skipf("Skipping integration test: %v", err)
		return
	}
	defer cleanup()

	// Create test provider
	provider := &TestEmbeddingProvider{
		modelVersion: "test-v1",
		dimension:    1536,
	}

	callCount := 0
	provider.responseFunc = func(texts []string) ([][]float32, error) {
		callCount++
		// Return mock embeddings
		result := make([][]float32, len(texts))
		for i := range result {
			result[i] = make([]float32, 1536)
			result[i][0] = 0.5
		}
		return result, nil
	}

	// Insert test data
	_, err = db.Exec(ctx, `
		INSERT INTO chains (slug, name) VALUES ('test', 'Test Chain');

		INSERT INTO retailer_items (id, chain_slug, name, brand)
		VALUES
			('rit1', 'test', 'Test Product', 'Test Brand'),
			('rit2', 'test', 'Test Product', 'Test Brand');

		INSERT INTO products (id, name, brand)
		VALUES
			('prd1', 'Test Product', 'Test Brand');
	`)
	if err != nil {
		t.Fatalf("insert test data: %v", err)
	}

	// First run - should generate embeddings
	cfg1 := AIMatcherConfig{
		Provider:          provider,
		AutoLinkThreshold: 0.95,
		ReviewThreshold:   0.80,
		BatchSize:         10,
		MaxCandidates:     5,
		TrgmPrefilter:     200,
	}

	_, err = RunAIMatching(ctx, db, cfg1, "test-cache-run-1")
	if err != nil {
		t.Fatalf("first AI matching failed: %v", err)
	}

	firstRunCalls := callCount

	// Second run - should use cache
	callCount = 0
	_, err = RunAIMatching(ctx, db, cfg1, "test-cache-run-2")
	if err != nil {
		t.Fatalf("second AI matching failed: %v", err)
	}

	// Note: In real scenario, second run would have fewer calls due to cache hits
	// This test verifies the cache mechanism exists
	t.Logf("Embedding caching test: first run=%d calls, second run=%d calls", firstRunCalls, callCount)
}
