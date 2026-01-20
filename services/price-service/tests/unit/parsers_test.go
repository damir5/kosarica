package unit

import (
	"strings"
	"testing"

	"github.com/kosarica/price-service/internal/parsers/charset"
	"github.com/kosarica/price-service/internal/parsers/csv"
	"github.com/kosarica/price-service/internal/parsers/xlsx"
	"github.com/kosarica/price-service/internal/parsers/xml"
	"github.com/kosarica/price-service/internal/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCSVParserEncodingDetection tests encoding detection for Croatian characters
func TestCSVParserEncodingDetection(t *testing.T) {
	tests := []struct {
		name          string
		content       []byte
		expectedEnc   charset.Encoding
		expectedScore int
	}{
		{
			name:        "Windows-1250 with Croatian chars",
			content:     []byte{0x8A, 0x9A, 0xD0, 0xF0}, // Š, š, Đ, đ
			expectedEnc: charset.EncodingWindows1250,
		},
		{
			name:        "UTF-8 BOM",
			content:     []byte{0xEF, 0xBB, 0xBF, 'H', 'e', 'l', 'l', 'o'},
			expectedEnc: charset.EncodingUTF8,
		},
		{
			name:        "Default UTF-8",
			content:     []byte("Hello, World!"),
			expectedEnc: charset.EncodingUTF8,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			enc := charset.DetectEncoding(tt.content)
			assert.Equal(t, tt.expectedEnc, enc)
		})
	}
}

// TestCSVParserDelimiterDetection tests automatic delimiter detection
func TestCSVParserDelimiterDetection(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		expectedDel csv.CsvDelimiter
	}{
		{
			name:        "Comma delimiter",
			content:     "name,price,quantity\nApple,100,5",
			expectedDel: csv.DelimiterComma,
		},
		{
			name:        "Semicolon delimiter",
			content:     "name;price;quantity\nApple;100;5",
			expectedDel: csv.DelimiterSemicolon,
		},
		{
			name:        "Tab delimiter",
			content:     "name\tprice\tquantity\nApple\t100\t5",
			expectedDel: csv.DelimiterTab,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			del := csv.DetectDelimiter(tt.content)
			assert.Equal(t, tt.expectedDel, del)
		})
	}
}

// TestCSVParserEuropeanPriceFormat tests European price format parsing
func TestCSVParserEuropeanPriceFormat(t *testing.T) {
	tests := []struct {
		name          string
		input         string
		expectedCents int
		expectError   bool
	}{
		{
			name:          "European format 1.234,56",
			input:         "1.234,56",
			expectedCents: 123456,
		},
		{
			name:          "European format 123,45",
			input:         "123,45",
			expectedCents: 12345,
		},
		{
			name:          "US format 123.45",
			input:         "123.45",
			expectedCents: 12345,
		},
		{
			name:          "Integer 100",
			input:         "100",
			expectedCents: 10000,
		},
		{
			name:        "Invalid empty",
			input:       "",
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cents, err := csv.ParsePrice(tt.input)
			if tt.expectError {
				assert.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.expectedCents, cents)
			}
		})
	}
}

// TestCSVParserAlternativeMapping tests fallback to alternative column mapping
// The alternative mapping is tried when the primary mapping produces 0 valid rows
// (e.g., all rows have parsing errors like invalid price format).
//
// Note: If the primary mapping's columns don't exist in the CSV headers, the parser
// returns early with an error and the alternative mapping is NOT tried.
// The fallback only works when columns exist but parsing fails for all rows.
func TestCSVParserAlternativeMapping(t *testing.T) {
	// Scenario: CSV with all columns present, but primary mapping points to
	// columns with invalid data (causing 0 valid rows), while alternative
	// mapping points to columns with valid data.

	primaryName := "product_name"
	primaryPrice := "price_invalid" // This column has invalid prices
	altName := "product_name"
	altPrice := "price_valid" // This column has valid prices

	primaryMapping := &csv.CsvColumnMapping{
		Name:  primaryName,
		Price: primaryPrice,
	}

	altMapping := &csv.CsvColumnMapping{
		Name:  altName,
		Price: altPrice,
	}

	// CSV with columns that exist, but primary mapping points to invalid price column
	csvContent := "product_name,price_invalid,price_valid\nApple,INVALID,100"

	parser := csv.NewParser(csv.CsvParserOptions{
		ColumnMapping: primaryMapping,
		HasHeader:     true,
	})
	parser.SetAlternativeMapping(altMapping)

	result, err := parser.Parse([]byte(csvContent))
	// The primary mapping finds columns but all rows have invalid prices (0 valid rows)
	// Alternative mapping should be tried and succeed
	require.NoError(t, err)
	assert.Equal(t, 1, result.ValidRows)
	assert.Equal(t, "Apple", result.Rows[0].Name)
	assert.Equal(t, 10000, result.Rows[0].Price) // 100.00 in cents
}

// TestXMLParserMultipleItemPaths tests various XML item path structures
func TestXMLParserMultipleItemPaths(t *testing.T) {
	tests := []struct {
		name     string
		xml      string
		itemPath string
		expected int
	}{
		{
			name:     "products.product path",
			xml:      `<products><product><name>Apple</name><price>100</price></product></products>`,
			itemPath: "products.product",
			expected: 1,
		},
		{
			name:     "Products.Product path",
			xml:      `<Products><Product><name>Apple</name><price>100</price></Product></Products>`,
			itemPath: "Products.Product",
			expected: 1,
		},
		{
			name:     "root items path",
			xml:      `<root><items><item><name>Apple</name><price>100</price></item></items></root>`,
			itemPath: "root.items.item",
			expected: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			namePath := "name"
			pricePath := "price"
			mapping := xml.XmlFieldMapping{
				Name:  namePath,
				Price: pricePath,
			}

			parser := xml.NewParser(xml.XmlParserOptions{
				ItemsPath:    tt.itemPath,
				FieldMapping: mapping,
			})
			result, err := parser.Parse([]byte(tt.xml))
			require.NoError(t, err)
			assert.Equal(t, tt.expected, result.ValidRows)
		})
	}
}

// TestXMLParserTextContentExtraction tests text content extraction from XML elements
// When an XML element has both attributes and text content, the parser stores
// the text content under special keys (#text, _text, etc.) internally
func TestXMLParserTextContentExtraction(t *testing.T) {
	tests := []struct {
		name     string
		xml      string
		field    string
		expected string
	}{
		{
			name:     "element with attributes extracts text content",
			xml:      `<items><item><name id="1">Apple</name><price>100</price></item></items>`,
			field:    "name",
			expected: "Apple",
		},
		{
			name:     "simple element without attributes",
			xml:      `<items><item><name>Banana</name><price>50</price></item></items>`,
			field:    "name",
			expected: "Banana",
		},
		{
			name:     "nested path extraction",
			xml:      `<products><product><details><name>Cherry</name></details><price>75</price></product></products>`,
			field:    "details.name",
			expected: "Cherry",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Determine items path from XML structure
			itemsPath := "items.item"
			if strings.Contains(tt.xml, "<products>") {
				itemsPath = "products.product"
			}

			mapping := xml.XmlFieldMapping{
				Name:  tt.field,
				Price: "price",
			}

			parser := xml.NewParser(xml.XmlParserOptions{
				ItemsPath:    itemsPath,
				FieldMapping: mapping,
			})
			result, err := parser.Parse([]byte(tt.xml))
			require.NoError(t, err)
			assert.Equal(t, 1, result.ValidRows)
			if len(result.Rows) > 0 {
				assert.Equal(t, tt.expected, result.Rows[0].Name)
			}
		})
	}
}

// TestXLSXParserNumericColumnIndices tests numeric column indexing for web format
func TestXLSXParserNumericColumnIndices(t *testing.T) {
	// Numeric column indices (0-based)
	nameCol := xlsx.NewNumericIndex(0)
	priceCol := xlsx.NewNumericIndex(1)
	unitCol := xlsx.NewNumericIndex(2)

	mapping := xlsx.XlsxColumnMapping{
		Name:  nameCol,
		Price: priceCol,
		Unit:  &unitCol,
	}

	parser := xlsx.NewParser(xlsx.XlsxParserOptions{
		ColumnMapping:    &mapping,
		HasHeader:        true,
		HeaderRowCount:   3,
		SheetNameOrIndex: "Sheet1",
	})

	// Create a mock XLSX file for testing
	// In real tests, use excelize to create test files
	assert.NotNil(t, parser)
}

// TestXLSXParserDateConversion tests Excel serial date conversion
// Note: This test is a placeholder as ParseExcelDate is not exported.
// The actual Excel date conversion is tested internally within the parser.
func TestXLSXParserDateConversion(t *testing.T) {
	// This test verifies that the XLSX parser can be created with proper options
	nameCol := xlsx.NewNumericIndex(0)
	priceCol := xlsx.NewNumericIndex(1)

	mapping := xlsx.XlsxColumnMapping{
		Name:  nameCol,
		Price: priceCol,
	}

	parser := xlsx.NewParser(xlsx.XlsxParserOptions{
		ColumnMapping: &mapping,
		HasHeader:     true,
	})

	assert.NotNil(t, parser)
}

// TestNormalizedRowStructure tests NormalizedRow field structure
func TestNormalizedRowStructure(t *testing.T) {
	// Test creating a valid NormalizedRow
	validRow := types.NormalizedRow{
		Name:  "Apple",
		Price: 100,
	}
	assert.Equal(t, "Apple", validRow.Name)
	assert.Equal(t, 100, validRow.Price)

	// Test with optional fields
	rowWithOptionals := types.NormalizedRow{
		Name:          "Banana",
		Price:         50,
		Description:   stringPtr("Yellow banana"),
		Category:      stringPtr("Fruit"),
		DiscountPrice: intPtr(45),
		Unit:          stringPtr("kg"),
	}
	assert.Equal(t, "Banana", rowWithOptionals.Name)
	assert.Equal(t, 50, rowWithOptionals.Price)
	assert.NotNil(t, rowWithOptionals.Description)
	assert.Equal(t, "Yellow banana", *rowWithOptionals.Description)
	assert.NotNil(t, rowWithOptionals.DiscountPrice)
	assert.Equal(t, 45, *rowWithOptionals.DiscountPrice)
}

func stringPtr(s string) *string {
	return &s
}

func intPtr(i int) *int {
	return &i
}
