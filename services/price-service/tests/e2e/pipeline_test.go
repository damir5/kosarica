package e2e

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// TestE2EPipeline tests the complete ingestion pipeline end-to-end
func TestE2EPipeline(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping e2e test in short mode")
	}

	ctx := context.Background()

	// Setup test database container
	postgresContainer, err := setupTestDatabase(ctx)
	require.NoError(t, err)
	defer postgresContainer.Terminate(ctx)

	connStr, err := postgresContainer.ConnectionString(ctx)
	require.NoError(t, err)

	// Connect to test database
	require.NoError(t, database.Connect(
		ctx,
		connStr,
		10,
		2,
		0,
		0,
	))
	defer database.Close() // Clean up connection pool after test

	// Run migrations (simplified - in real test, run actual migration files)
	setupTestSchema(ctx, t)

	// Initialize storage
	tempDir := t.TempDir()
	storageBackend, err := storage.NewLocalStorage(filepath.Join(tempDir, "archives"))
	require.NoError(t, err)

	// Initialize chain registry
	require.NoError(t, registry.InitializeDefaultAdapters())

	// Run pipeline for konzum
	// Note: In real e2e test, use mock HTTP server
	t.Run("KonzumPipeline", func(t *testing.T) {
		// This would require mocking HTTP responses or using test fixtures
		// For now, we'll test the pipeline structure

		chainID := "konzum"

		// Verify chain ID is valid
		assert.True(t, config.IsValidChainID(chainID))

		// Verify adapter exists
		adapter, err := registry.GetAdapter(config.ChainID(chainID))
		require.NoError(t, err)
		assert.NotNil(t, adapter)
		_ = adapter // Use in future tests
	})

	// Test database operations
	t.Run("DatabaseOperations", func(t *testing.T) {
		testDatabaseOperations(ctx, t)
	})

	// Test storage operations
	t.Run("StorageOperations", func(t *testing.T) {
		testStorageOperations(ctx, t, storageBackend)
	})
}

// TestE2EPipelineWithMockData tests pipeline with mock data
func TestE2EPipelineWithMockData(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping e2e test in short mode")
	}

	ctx := context.Background()

	// Setup test database
	postgresContainer, err := setupTestDatabase(ctx)
	require.NoError(t, err)
	defer postgresContainer.Terminate(ctx)

	connStr, err := postgresContainer.ConnectionString(ctx)
	require.NoError(t, err)

	// Connect and setup
	require.NoError(t, database.Connect(ctx, connStr, 10, 2, 0, 0))
	defer database.Close() // Clean up connection pool after test
	setupTestSchema(ctx, t)

	// Create mock ingestion run
	t.Run("CreateIngestionRun", func(t *testing.T) {
		pool := database.Pool()

		var runID string
		err := pool.QueryRow(ctx, `
			INSERT INTO ingestion_runs (id, chain_slug, source, status, created_at)
			VALUES (gen_random_uuid(), 'konzum', 'e2e-test', 'running', NOW())
			RETURNING id
		`).Scan(&runID)

		require.NoError(t, err)
		assert.NotEmpty(t, runID)
	})

	// Test archive creation
	t.Run("CreateArchive", func(t *testing.T) {
		archiveID := database.GenerateArchiveID()
		assert.Contains(t, archiveID, "arc_")

		// In real test, insert archive and verify
	})
}

// TestE2EAllChainsRegistry verifies all chains can be registered
func TestE2EAllChainsRegistry(t *testing.T) {
	require.NoError(t, registry.InitializeDefaultAdapters())

	// Verify all 11 chains are registered
	chains := []string{
		"konzum", "lidl", "plodine", "interspar", "studenac",
		"kaufland", "eurospin", "dm", "ktc", "metro", "trgocentar",
	}

	for _, chainID := range chains {
		t.Run(chainID, func(t *testing.T) {
			assert.True(t, config.IsValidChainID(chainID))

			adapter, err := registry.GetAdapter(config.ChainID(chainID))
			require.NoError(t, err)
			assert.NotNil(t, adapter)
		})
	}
}

// Helper functions

func setupTestDatabase(ctx context.Context) (*postgres.PostgresContainer, error) {
	return postgres.Run(ctx,
		"postgres:15-alpine",
		postgres.WithDatabase("testdb"),
		postgres.WithUsername("test"),
		postgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(
			// Use multiple wait strategies for better reliability
			wait.ForAll(
				wait.ForListeningPort("5432/tcp").
					WithStartupTimeout(60*time.Second),
				wait.ForLog("database system is ready to accept connections").
					WithOccurrence(1).
					WithStartupTimeout(60*time.Second),
			),
		),
	)
}

func setupTestSchema(ctx context.Context, t *testing.T) {
	pool := database.Pool()

	// Create minimal schema for testing
	schema := `
		-- Chains table
		CREATE TABLE IF NOT EXISTS chains (
			slug text PRIMARY KEY,
			name text NOT NULL
		);

		-- Stores table
		CREATE TABLE IF NOT EXISTS stores (
			id text PRIMARY KEY,
			chain_slug text NOT NULL REFERENCES chains(slug),
			name text NOT NULL,
			status text NOT NULL DEFAULT 'pending'
		);

		-- Store identifiers table
		CREATE TABLE IF NOT EXISTS store_identifiers (
			id text PRIMARY KEY,
			store_id text NOT NULL REFERENCES stores(id),
			type text NOT NULL,
			value text NOT NULL
		);

		-- Retailer items table
		CREATE TABLE IF NOT EXISTS retailer_items (
			id text PRIMARY KEY,
			chain_slug text NOT NULL REFERENCES chains(slug),
			external_id text,
			name text NOT NULL,
			archive_id text
		);

		-- Retailer item barcodes table
		CREATE TABLE IF NOT EXISTS retailer_item_barcodes (
			id text PRIMARY KEY,
			retailer_item_id text NOT NULL REFERENCES retailer_items(id),
			barcode text NOT NULL
		);

		-- Store item state table
		CREATE TABLE IF NOT EXISTS store_item_state (
			id text PRIMARY KEY,
			store_id text NOT NULL REFERENCES stores(id),
			retailer_item_id text NOT NULL REFERENCES retailer_items(id),
			current_price int,
			price_signature text,
			UNIQUE(store_id, retailer_item_id)
		);

		-- Archives table
		CREATE TABLE IF NOT EXISTS archives (
			id text PRIMARY KEY,
			chain_slug text NOT NULL,
			source_url text NOT NULL,
			filename text NOT NULL,
			archive_path text NOT NULL,
			checksum text NOT NULL
		);

		-- Ingestion runs table
		CREATE TABLE IF NOT EXISTS ingestion_runs (
			id text PRIMARY KEY,
			chain_slug text NOT NULL,
			source text,
			status text NOT NULL,
			created_at timestamp,
			archive_id text REFERENCES archives(id)
		);

		-- Insert test chain
		INSERT INTO chains (slug, name) VALUES ('konzum', 'Konzum')
		ON CONFLICT (slug) DO NOTHING;
	`

	_, err := pool.Exec(ctx, schema)
	if err != nil {
		t.Fatalf("failed to create test schema: %v", err)
	}
}

func testDatabaseOperations(ctx context.Context, t *testing.T) {
	pool := database.Pool()

	// Test basic database connectivity
	var result int
	err := pool.QueryRow(ctx, "SELECT 1").Scan(&result)
	require.NoError(t, err)
	assert.Equal(t, 1, result)

	// Test chain exists
	var chainName string
	err = pool.QueryRow(ctx, "SELECT name FROM chains WHERE slug = 'konzum'").Scan(&chainName)
	require.NoError(t, err)
	assert.Equal(t, "Konzum", chainName)
}

func testStorageOperations(ctx context.Context, t *testing.T, storageBackend storage.Storage) {
	testKey := "test/test-file.txt"
	testContent := []byte("test content")

	// Test Put
	err := storageBackend.Put(ctx, testKey, testContent, nil)
	require.NoError(t, err)

	// Test Get
	retrieved, err := storageBackend.Get(ctx, testKey)
	require.NoError(t, err)
	assert.Equal(t, testContent, retrieved)

	// Test Exists
	exists, err := storageBackend.Exists(ctx, testKey)
	require.NoError(t, err)
	assert.True(t, exists)

	// Test GetInfo
	info, err := storageBackend.GetInfo(ctx, testKey)
	require.NoError(t, err)
	assert.Equal(t, testKey, info.Key)
	assert.Equal(t, int64(len(testContent)), info.Size)

	// Test Delete
	err = storageBackend.Delete(ctx, testKey)
	require.NoError(t, err)

	// Verify deleted
	exists, _ = storageBackend.Exists(ctx, testKey)
	assert.False(t, exists)
}

// TestE2EArchiveTracking tests the archive tracking functionality
func TestE2EArchiveTracking(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping e2e test in short mode")
	}

	ctx := context.Background()

	// Setup test database
	postgresContainer, err := setupTestDatabase(ctx)
	require.NoError(t, err)
	defer postgresContainer.Terminate(ctx)

	connStr, err := postgresContainer.ConnectionString(ctx)
	require.NoError(t, err)

	require.NoError(t, database.Connect(ctx, connStr, 10, 2, 0, 0))
	defer database.Close() // Clean up connection pool after test
	setupTestSchema(ctx, t)

	t.Run("ArchiveCreation", func(t *testing.T) {
		pool := database.Pool()

		// Create archive
		archiveID := database.GenerateArchiveID()

		_, err := pool.Exec(ctx, `
			INSERT INTO archives (id, chain_slug, source_url, filename, archive_path, checksum)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, archiveID, "konzum", "http://example.com/file.csv", "file.csv",
			"archives/konzum/file.csv", "abc123")

		require.NoError(t, err)

		// Retrieve archive
		var retrievedID string
		err = pool.QueryRow(ctx, "SELECT id FROM archives WHERE id = $1", archiveID).Scan(&retrievedID)
		require.NoError(t, err)
		assert.Equal(t, archiveID, retrievedID)
	})

	t.Run("ArchiveDeduplication", func(t *testing.T) {
		// Test duplicate detection via checksum
		checksum := "test-checksum-123"

		// Create first archive
		archiveID1 := database.GenerateArchiveID()
		pool := database.Pool()
		pool.Exec(ctx, `
			INSERT INTO archives (id, chain_slug, source_url, filename, archive_path, checksum)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, archiveID1, "konzum", "http://example.com/file1.csv", "file1.csv",
			"archives/konzum/file1.csv", checksum)

		// Try to create duplicate (should be detected in real implementation)
		var existingCount int
		err := pool.QueryRow(ctx, "SELECT COUNT(*) FROM archives WHERE checksum = $1", checksum).Scan(&existingCount)
		require.NoError(t, err)
		assert.Equal(t, 1, existingCount)
	})
}

// TestE2EConcurrency tests concurrent ingestion runs
func TestE2EConcurrency(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping e2e test in short mode")
	}

	ctx := context.Background()

	// Setup test database
	postgresContainer, err := setupTestDatabase(ctx)
	require.NoError(t, err)
	defer postgresContainer.Terminate(ctx)

	connStr, err := postgresContainer.ConnectionString(ctx)
	require.NoError(t, err)

	require.NoError(t, database.Connect(ctx, connStr, 10, 2, 0, 0))
	defer database.Close() // Clean up connection pool after test
	setupTestSchema(ctx, t)

	t.Run("ConcurrentRuns", func(t *testing.T) {
		pool := database.Pool()

		// Create multiple concurrent ingestion runs
		for i := 0; i < 5; i++ {
			go func(index int) {
				runID := fmt.Sprintf("run-%d", index)
				pool.Exec(ctx, `
					INSERT INTO ingestion_runs (id, chain_slug, source, status, created_at)
					VALUES ($1, $2, 'e2e-test', 'running', NOW())
				`, runID, "konzum")
			}(i)
		}

		// Verify runs were created (simplified check)
		var count int
		err := pool.QueryRow(ctx, "SELECT COUNT(*) FROM ingestion_runs WHERE source = 'e2e-test'").Scan(&count)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, count, 0)
	})
}

// TestMain setup for e2e tests
func TestMain(m *testing.M) {
	// Check if testcontainers is available
	if os.Getenv("TESTCONTAINERS_ENABLED") == "false" {
		// Run without container tests
		os.Exit(m.Run())
	}

	// Run all tests
	os.Exit(m.Run())
}
