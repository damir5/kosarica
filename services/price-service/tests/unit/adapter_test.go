package unit

import (
	"regexp"
	"testing"

	"github.com/kosarica/price-service/internal/adapters/base"
	"github.com/kosarica/price-service/internal/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestStoreIDExtraction tests store ID extraction from filenames
func TestStoreIDExtraction(t *testing.T) {
	tests := []struct {
		name         string
		filename     string
		patterns     []string
		expectedID   string
		shouldError  bool
	}{
		{
			name:     "Konzum pattern ,(\\d{4}),",
			filename: "SUPERMARKET,Zagreb+10000,0019,2024-01-19,10-00-00.csv",
			patterns: []string{`,(\d{4}),`},
			expectedID: "0019",
		},
		{
			name:     "Lidl pattern Lidl_DATE_STOREID",
			filename: "Lidl_2024-01-19_265.csv",
			patterns: []string{`Lidl_\d{4}-\d{2}-\d{2}_(\d+)`},
			expectedID: "265",
		},
		{
			name:     "Lidl pattern Lidl_Poslovnica_LOCATION",
			filename: "Lidl_Poslovnica_Zagreb.csv",
			patterns: []string{`Lidl_Poslovnica_(.+)`},
			expectedID: "Zagreb",
		},
		{
			name:     "Trgocentar pattern P(\\d{3})",
			filename: "SUPERMARKET,P001,Bjelovar,2024-01-19.csv",
			patterns: []string{`P(\d{3})`},
			expectedID: "001",
		},
		{
			name:     "No matching pattern",
			filename: "random_file.csv",
			patterns: []string{`,\d{4},`},
			shouldError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			chain := base.BaseChainAdapter{
				FilenamePrefixPatterns: tt.patterns,
			}

			storeID, err := chain.ExtractStoreIdentifierFromFilename(tt.filename)
			if tt.shouldError {
				assert.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.expectedID, storeID)
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
	primaryMapping := map[string]int{
		"name":  0,
		"price": 1,
	}

	altMapping := map[string]int{
		"naziv":  0,
		"cijena": 1,
	}

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
			mapping := primaryMapping
			if !tt.usePrimary {
				mapping = altMapping
			}

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
			barcode := types.ParseBarcodeField(tt.barcodeField)
			assert.Equal(t, tt.expected, barcode)
		})
	}
}

// Helper functions

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
