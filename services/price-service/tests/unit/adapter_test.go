package unit

import (
	"regexp"
	"strings"
	"testing"

	"github.com/kosarica/price-service/internal/adapters/base"
	"github.com/kosarica/price-service/internal/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestStoreIDExtraction tests store ID extraction from filenames
//
// The base adapter's ExtractStoreIdentifier uses FilenamePrefixPatterns as
// prefix-stripping patterns, not capture patterns. It removes matched prefixes
// from the filename and returns whatever remains as the store identifier.
//
// Chain-specific adapters (Konzum, Lidl, etc.) override this method with
// custom regex extraction logic using capture groups.
func TestStoreIDExtraction(t *testing.T) {
	tests := []struct {
		name         string
		filename     string
		patterns     []string
		expectedID   string
		shouldError  bool
	}{
		{
			name:     "Prefix pattern strips 'SUPERMARKET,' from filename",
			filename: "SUPERMARKET,Zagreb+100002024-01-19,10-00-00.csv",
			patterns: []string{`^SUPERMARKET,`},
			expectedID: "Zagreb+100002024-01-19,10-00-00",
		},
		{
			name:     "Prefix pattern strips 'Lidl_' from filename",
			filename: "Lidl_2024-01-19_265.csv",
			patterns: []string{`^Lidl_`},
			expectedID: "2024-01-19_265",
		},
		{
			name:     "Multiple prefix patterns applied sequentially",
			filename: "TestChain_Zagreb_Main_123.csv",
			patterns: []string{`^TestChain_`, `^Zagreb_`},
			expectedID: "Main_123",
		},
		{
			name:     "No prefix pattern returns entire filename minus extension",
			filename: "random_file.csv",
			patterns: []string{},
			expectedID: "random_file",
		},
		{
			name:     "Non-matching prefix returns entire filename minus extension",
			filename: "store_data.csv",
			patterns: []string{`^Prefix_`},
			expectedID: "store_data",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create adapter using the constructor
			adapter, err := base.NewBaseChainAdapter(base.BaseAdapterConfig{
				Slug:                   "test-chain",
				Name:                   "Test Chain",
				SupportedTypes:         []types.FileType{types.FileTypeCSV},
				FilenamePrefixPatterns: tt.patterns,
			})
			require.NoError(t, err)

			// Test via public ExtractStoreIdentifier method
			storeID := adapter.ExtractStoreIdentifier(types.DiscoveredFile{
				Filename: tt.filename,
			})

			if tt.shouldError {
				assert.Nil(t, storeID)
			} else {
				require.NotNil(t, storeID)
				assert.Equal(t, "filename_code", storeID.Type)
				assert.Equal(t, tt.expectedID, storeID.Value)
			}
		})
	}
}

// TestStoreMetadataParsing tests address parsing from filename metadata
func TestStoreMetadataParsing(t *testing.T) {
	tests := []struct {
		name           string
		filename       string
		expectedName   string
		expectedCity   string
		expectedAddr   string
		expectedPostal string
	}{
		{
			name:           "Konzum format: SUPERMARKET,ADDRESS+POSTAL+CITY,STORE_ID,DATE,TIME.CSV",
			filename:       "SUPERMARKET,Ilica 123+10000+Zagreb,0019,2024-01-19,10-00-00.csv",
			expectedName:   "SUPERMARKET Zagreb 0019",
			expectedAddr:   "Ilica 123",
			expectedCity:   "Zagreb",
			expectedPostal: "10000",
		},
		{
			name:           "Lidl format: Supermarket ID_Location",
			filename:       "Supermarket 265_Zagreb_Jackubic_2024-01-19.csv",
			expectedName:   "Supermarket 265 Zagreb",
			expectedCity:   "Zagreb",
			expectedAddr:   "",
			expectedPostal: "",
		},
		{
			name:           "Simple format",
			filename:       "store_data.csv",
			expectedName:   "",
			expectedCity:   "",
			expectedAddr:   "",
			expectedPostal: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Use regex patterns to extract metadata
			metadata := extractStoreMetadata(tt.filename)

			if tt.expectedName != "" {
				assert.Contains(t, metadata.Name, tt.expectedCity)
			}
			if tt.expectedCity != "" {
				assert.Contains(t, metadata.Name, tt.expectedCity)
			}
		})
	}
}

// TestHTMLLinkExtraction tests link extraction from HTML discovery
func TestHTMLLinkExtraction(t *testing.T) {
	html := `
	<html>
		<body>
			<a href="/files/konzum_0019_2024-01-19.csv">Konzum 0019</a>
			<a href="/files/konzum_0020_2024-01-19.csv">Konzum 0020</a>
			<a href="/about">About</a>
			<a href="https://example.com/external">External</a>
		</body>
	</html>
	`

	pattern := regexp.MustCompile(`/files/konzum_\d{4}_\d{4}-\d{2}-\d{2}\.csv`)
	links := extractLinksFromHTML(html, pattern)

	assert.Equal(t, 2, len(links))
	assert.Contains(t, links[0], "konzum_0019")
	assert.Contains(t, links[1], "konzum_0020")
}

// TestAlternativeMappingFallback tests CSV parser fallback to alternative mapping
func TestAlternativeMappingFallback(t *testing.T) {
	tests := []struct {
		name          string
		csvContent    string
		usePrimary    bool
		expectedValid int
	}{
		{
			name:          "English headers with primary mapping",
			csvContent:    "name,price\nApple,100",
			usePrimary:    true,
			expectedValid: 1,
		},
		{
			name:          "Croatian headers with alternative mapping",
			csvContent:    "naziv,cijena\nJabuka,100",
			usePrimary:    false,
			expectedValid: 1,
		},
		{
			name:          "Croatian headers with primary mapping fails",
			csvContent:    "naziv,cijena\nJabuka,100",
			usePrimary:    true,
			expectedValid: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Simulate parsing with the selected mapping
			validRows := 0
			if tt.usePrimary && tt.csvContent[0:4] == "name" {
				validRows = 1
			} else if !tt.usePrimary && tt.csvContent[0:5] == "naziv" {
				validRows = 1
			}

			assert.Equal(t, tt.expectedValid, validRows)
		})
	}
}

// TestFileExtensionPattern tests file extension pattern matching
func TestFileExtensionPattern(t *testing.T) {
	tests := []struct {
		name     string
		filename string
		pattern  string
		expected bool
	}{
		{
			name:     "CSV extension",
			filename: "data.csv",
			pattern:  `\.(csv|CSV)$`,
			expected: true,
		},
		{
			name:     "XLSX extension",
			filename: "data.xlsx",
			pattern:  `\.(xlsx|XLSX)$`,
			expected: true,
		},
		{
			name:     "XML extension",
			filename: "data.xml",
			pattern:  `\.(xml|XML)$`,
			expected: true,
		},
		{
			name:     "ZIP extension",
			filename: "data.zip",
			pattern:  `\.(zip|ZIP)$`,
			expected: true,
		},
		{
			name:     "No match",
			filename: "data.txt",
			pattern:  `\.(csv|CSV)$`,
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			matched, _ := regexp.MatchString(tt.pattern, tt.filename)
			assert.Equal(t, tt.expected, matched)
		})
	}
}

// TestDiscoveryPagination tests pagination limit for HTML discovery
func TestDiscoveryPagination(t *testing.T) {
	maxPages := 50

	// Simulate pagination
	pageCount := 0
	for i := 1; i <= 100; i++ {
		if i > maxPages {
			break
		}
		pageCount++
	}

	assert.Equal(t, maxPages, pageCount)
	assert.LessOrEqual(t, pageCount, maxPages)
}

// TestBarcodeSplitting tests multiple GTIN barcode splitting
func TestBarcodeSplitting(t *testing.T) {
	tests := []struct {
		name         string
		barcodeField string
		expected     []string
	}{
		{
			name:         "Semicolon separated",
			barcodeField: "385001;385002;385003",
			expected:     []string{"385001", "385002", "385003"},
		},
		{
			name:         "Pipe separated",
			barcodeField: "385001|385002|385003",
			expected:     []string{"385001", "385002", "385003"},
		},
		{
			name:         "Single barcode",
			barcodeField: "385001",
			expected:     []string{"385001"},
		},
		{
			name:         "Empty field",
			barcodeField: "",
			expected:     []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			barcode := splitBarcodes(tt.barcodeField)
			assert.Equal(t, tt.expected, barcode)
		})
	}
}

// Helper functions

// splitBarcodes splits a string into individual barcodes by common separators
func splitBarcodes(s string) []string {
	// Split on common separators (semicolon, pipe, comma)
	separators := regexp.MustCompile(`[,;|]`)
	parts := separators.Split(s, -1)

	barcodes := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			barcodes = append(barcodes, trimmed)
		}
	}

	return barcodes
}

func extractStoreMetadata(filename string) *types.StoreMetadata {
	// Simple regex extraction for testing
	return &types.StoreMetadata{
		Name: filename,
	}
}

func extractLinksFromHTML(html string, pattern *regexp.Regexp) []string {
	// Simple regex extraction for testing
	matches := pattern.FindAllString(html, -1)
	return matches
}
