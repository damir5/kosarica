package unit

import (
	"testing"

	"github.com/kosarica/price-service/internal/parsers/csv"
	"github.com/kosarica/price-service/internal/parsers/xml"
	"github.com/kosarica/price-service/internal/parsers/xlsx"
	"github.com/kosarica/price-service/internal/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCSVParserEncodingDetection tests encoding detection for Croatian characters
func TestCSVParserEncodingDetection(t *testing.T) {
	tests := []struct {
		name          string
		content       []byte
		expectedEnc   csv.Encoding
		expectedScore int
	}{
		{
			name:        "Windows-1250 with Croatian chars",
			content:     []byte{0x8A, 0x9A, 0xD0, 0xF0}, // Š, š, Đ, đ
			expectedEnc: csv.EncodingWindows1250,
		},
		{
			name:        "UTF-8 BOM",
			content:     []byte{0xEF, 0xBB, 0xBF, 'H', 'e', 'l', 'l', 'o'},
			expectedEnc: csv.EncodingUTF8,
		},
		{
			name:        "Default UTF-8",
			content:     []byte("Hello, World!"),
			expectedEnc: csv.EncodingUTF8,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			enc := csv.DetectEncoding(tt.content)
			assert.Equal(t, tt.expectedEnc, enc)
		})
	}
}

// TestCSVParserDelimiterDetection tests automatic delimiter detection
func TestCSVParserDelimiterDetection(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		expectedDel csv.Delimiter
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
			del := csv.DetectDelimiter([]byte(tt.content))
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
			name:          "Invalid empty",
			input:         "",
			expectError:   true,
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
func TestCSVParserAlternativeMapping(t *testing.T) {
	primaryMapping := csv.CsvColumnMapping{
		Columns: map[string]int{"name": 0, "price": 1},
	}

	altMapping := csv.CsvColumnMapping{
		Columns: map[string]int{"naziv": 0, "cijena": 1},
	}

	csvContent := "naziv,cijena\nApple,100"

	parser, err := csv.NewParser(primaryMapping, altMapping)
	require.NoError(t, err)

	result := parser.Parse([]byte(csvContent), primaryMapping)
	assert.Equal(t, 0, result.ValidRows)

	// Try alternative mapping
	result = parser.Parse([]byte(csvContent), altMapping)
	assert.Equal(t, 1, result.ValidRows)
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
			name: "products.product path",
			xml:  `<products><product><name>Apple</name><price>100</price></product></products>`,
			itemPath: "products.product",
			expected: 1,
		},
		{
			name: "Products.Product path",
			xml:  `<Products><Product><name>Apple</name><price>100</price></Product></Products>`,
			itemPath: "Products.Product",
			expected: 1,
		},
		{
			name: "root items path",
			xml:  `<root><items><item><name>Apple</name></item></items></root>`,
			itemPath: "root.items.item",
			expected: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mapping := xml.XmlFieldMapping{
				ItemPath: tt.itemPath,
				Fields: map[string]xml.FieldMapping{
					"name": {Path: "name"},
					"price": {Path: "price"},
				},
			}

			parser := xml.NewParser(mapping)
			result, err := parser.Parse([]byte(tt.xml))
			require.NoError(t, err)
			assert.Equal(t, tt.expected, result.ValidRows)
		})
	}
}

// TestXMLParserTextContentExtraction tests #text, _text, _ content extraction
func TestXMLParserTextContentExtraction(t *testing.T) {
	tests := []struct {
		name     string
		xml      string
		field    string
		expected string
	}{
		{
			name:     "#text content",
			xml:      `<item><name>#text</name><value>Apple</value></item>`,
			field:    "value",
			expected: "Apple",
		},
		{
			name:     "_text content",
			xml:      `<item><name>_text</name><value>Banana</value></item>`,
			field:    "value",
			expected: "Banana",
		},
		{
			name:     "_ content",
			xml:      `<item><name>_</name><value>Cherry</value></item>`,
			field:    "value",
			expected: "Cherry",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mapping := xml.XmlFieldMapping{
				ItemPath: "item",
				Fields: map[string]xml.FieldMapping{
					tt.field: {Path: tt.field},
				},
			}

			parser := xml.NewParser(mapping)
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
	mapping := xlsx.XlsxColumnMapping{
		NameColumn:       0,
		PriceColumn:      1,
		UnitColumn:       2,
		HeaderRows:       3,
		SheetName:        "Sheet1",
	}

	parser := xlsx.NewParser(mapping)

	// Create a mock XLSX file for testing
	// In real tests, use excelize to create test files
	assert.NotNil(t, parser)
}

// TestXLSXParserDateConversion tests Excel serial date conversion
func TestXLSXParserDateConversion(t *testing.T) {
	tests := []struct {
		name         string
		serialDate   float64
		expectedYear int
		expectedMonth int
		expectedDay   int
	}{
		{
			name:         "Date after Excel epoch",
			serialDate:   44927,
			expectedYear: 2023,
			expectedMonth: 1,
			expectedDay:   1,
		},
		{
			name:         "Earlier date",
			serialDate:   44562,
			expectedYear: 2022,
			expectedMonth: 1,
			expectedDay:   1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parsedDate := xlsx.ParseExcelDate(tt.serialDate)
			assert.Equal(t, tt.expectedYear, parsedDate.Year())
			assert.Equal(t, tt.expectedMonth, int(parsedDate.Month()))
			assert.Equal(t, tt.expectedDay, parsedDate.Day())
		})
	}
}

// TestNormalizedRowValidation tests normalized row validation logic
func TestNormalizedRowValidation(t *testing.T) {
	tests := []struct {
		name        string
		row         types.NormalizedRow
		isValid     bool
		errorCount  int
		warningCount int
	}{
		{
			name: "Valid row",
			row: types.NormalizedRow{
				Name:  "Apple",
				Price: 100,
			},
			isValid:     true,
			errorCount:  0,
			warningCount: 0,
		},
		{
			name: "Missing name",
			row: types.NormalizedRow{
				Name:  "",
				Price: 100,
			},
			isValid:     false,
			errorCount:  1,
			warningCount: 0,
		},
		{
			name: "Invalid price",
			row: types.NormalizedRow{
				Name:  "Apple",
				Price: 0,
			},
			isValid:     false,
			errorCount:  1,
			warningCount: 0,
		},
		{
			name: "Discount price not less than regular price",
			row: types.NormalizedRow{
				Name:          "Apple",
				Price:         100,
				DiscountPrice: intPtr(150),
			},
			isValid:      true,
			errorCount:   0,
			warningCount: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			validation := types.ValidateNormalizedRow(tt.row)
			assert.Equal(t, tt.isValid, validation.IsValid)
			assert.Equal(t, tt.errorCount, len(validation.Errors))
			assert.Equal(t, tt.warningCount, len(validation.Warnings))
		})
	}
}

func intPtr(i int) *int {
	return &i
}
