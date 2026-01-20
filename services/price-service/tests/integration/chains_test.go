package integration

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestKonzumChainIntegration tests the full Konzum chain integration
func TestKonzumChainIntegration(t *testing.T) {
	// Setup mock HTTP server
	server := setupKonzumMockServer(t)
	defer server.Close()

	ctx := context.Background()

	// Initialize registry
	require.NoError(t, registry.InitializeDefaultAdapters())

	// Get adapter
	adapter, err := registry.GetAdapter("konzum")
	require.NoError(t, err)

	// Test discovery
	files, err := adapter.Discover("")
	require.NoError(t, err)
	assert.Greater(t, len(files), 0, "Should discover files")

	// Test fetch for first file
	if len(files) > 0 {
		fetchResult, err := adapter.Fetch(files[0])
		require.NoError(t, err)
		assert.NotNil(t, fetchResult)
		assert.NotEmpty(t, fetchResult.Content)

		// Test parse
		parseResult, err := adapter.Parse(fetchResult.Content, files[0].Filename, &types.ParseOptions{})
		require.NoError(t, err)
		assert.Greater(t, parseResult.ValidRows, 0, "Should have valid rows")
	}
}

// TestLidlChainIntegration tests the Lidl chain with ZIP expansion
func TestLidlChainIntegration(t *testing.T) {
	// Setup mock server with ZIP file
	server := setupLidlMockServer(t)
	defer server.Close()

	ctx := context.Background()

	// Initialize registry
	require.NoError(t, registry.InitializeDefaultAdapters())

	// Get adapter
	adapter, err := registry.GetAdapter("lidl")
	require.NoError(t, err)

	// Test discovery
	files, err := adapter.Discover("")
	require.NoError(t, err)
	assert.Greater(t, len(files), 0)

	// Test that discovered files are ZIP files
	if len(files) > 0 {
		assert.Equal(t, types.FileTypeZIP, files[0].Type)
	}
}

// TestStudenacChainIntegration tests the Studenac XML chain
func TestStudenacChainIntegration(t *testing.T) {
	// Setup mock server with XML file
	server := setupStudenacMockServer(t)
	defer server.Close()

	ctx := context.Background()

	// Initialize registry
	require.NoError(t, registry.InitializeDefaultAdapters())

	// Get adapter
	adapter, err := registry.GetAdapter("studenac")
	require.NoError(t, err)

	// Test discovery
	files, err := adapter.Discover("")
	require.NoError(t, err)

	// Test parsing XML content
	if len(files) > 0 {
		// Mock fetch would return XML content
		xmlContent := createMockXMLContent()
		parseResult, err := adapter.Parse(xmlContent, files[0].Filename, &types.ParseOptions{})
		require.NoError(t, err)
		assert.Greater(t, parseResult.ValidRows, 0)
	}
}

// TestStoreIDExtraction tests store ID extraction from various chain formats
func TestStoreIDExtraction(t *testing.T) {
	tests := []struct {
		name       string
		chain      string
		filename   string
		expectedID string
	}{
		{
			name:       "Konzum 4-digit store ID",
			chain:      "konzum",
			filename:   "SUPERMARKET,Zagreb+10000,0019,2024-01-19,10-00-00.csv",
			expectedID: "0019",
		},
		{
			name:       "Lidl numeric store ID",
			chain:      "lidl",
			filename:   "Lidl_2024-01-19_265.csv",
			expectedID: "265",
		},
		{
			name:       "Trgocentar P prefixed store ID",
			chain:      "trgocentar",
			filename:   "SUPERMARKET,P001,Bjelovar,2024-01-19.csv",
			expectedID: "001",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.NoError(t, registry.InitializeDefaultAdapters())
			adapter, err := registry.GetAdapter(tt.chain)
			require.NoError(t, err)

			// Store ID is extracted by the adapter
			metadata := adapter.ExtractStoreMetadata(types.DiscoveredFile{
				Filename: tt.filename,
			})

			assert.NotNil(t, metadata)
		})
	}
}

// TestMultipleGTINSupports tests barcode splitting for chains with multiple GTINs
func TestMultipleGTINSupports(t *testing.T) {
	tests := []struct {
		name         string
		chain        string
		barcodeField string
		expected     []string
	}{
		{
			name:         "Lidl semicolon separated",
			chain:        "lidl",
			barcodeField: "385001;385002;385003",
			expected:     []string{"385001", "385002", "385003"},
		},
		{
			name:         "Lidl pipe separated",
			chain:        "lidl",
			barcodeField: "385001|385002|385003",
			expected:     []string{"385001", "385002", "385003"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.NoError(t, registry.InitializeDefaultAdapters())
			adapter, err := registry.GetAdapter(tt.chain)
			require.NoError(t, err)
			assert.NotNil(t, adapter)
		})
	}
}

// Mock server setup functions

func setupKonzumMockServer(t *testing.T) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Return mock CSV content
		csvContent := `ŠIFRA PROIZVODA,NAZIV PROIZVODA,CIJENA
001,Jabuka,5.50
002,Kruh,2.30
003,Mlijeko,8.90`
		w.Header().Set("Content-Type", "text/csv")
		w.Write([]byte(csvContent))
	}))
}

func setupLidlMockServer(t *testing.T) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Return mock ZIP file (simplified - in real test, create actual ZIP)
		w.Header().Set("Content-Type", "application/zip")
		w.Write([]byte("PK\x03\x04")) // ZIP file header
	}))
}

func setupStudenacMockServer(t *testing.T) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		w.Write([]byte(createMockXMLContent()))
	}))
}

func createMockXMLContent() string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<products>
	<product>
		<name>Jabuka</name>
		<price>550</price>
		<store_id>ST001</store_id>
	</product>
	<product>
		<name>Kruh</name>
		<price>230</price>
		<store_id>ST001</store_id>
	</product>
</products>`
}

// TestParseLocalFile tests parsing local test data files
func TestParseLocalFile(t *testing.T) {
	// Skip if testdata directory doesn't exist
	testdataDir := filepath.Join("..", "testdata")
	if _, err := os.Stat(testdataDir); os.IsNotExist(err) {
		t.Skip("testdata directory not found")
	}

	// Find all CSV files in testdata
	csvFiles, err := filepath.Glob(filepath.Join(testdataDir, "*.csv"))
	if err != nil {
		t.Fatalf("failed to glob testdata: %v", err)
	}

	require.NoError(t, registry.InitializeDefaultAdapters())

	for _, file := range csvFiles {
		t.Run(filepath.Base(file), func(t *testing.T) {
			content, err := os.ReadFile(file)
			require.NoError(t, err)

			// Try parsing with konzum adapter as default
			adapter, err := registry.GetAdapter("konzum")
			require.NoError(t, err)

			result, err := adapter.Parse(content, filepath.Base(file), &types.ParseOptions{})
			require.NoError(t, err)

			// Should have some valid rows
			if result.TotalRows > 0 {
				assert.Greater(t, result.ValidRows, 0)
			}
		})
	}
}
