package xml

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/kosarica/price-service/internal/parsers/charset"
	"github.com/kosarica/price-service/internal/types"
)

// Parser implements XML parsing with multiple item path detection and field mapping
type Parser struct {
	options            XmlParserOptions
	alternativeMapping *XmlFieldMapping
}

// NewParser creates a new XML parser with the given options
func NewParser(options XmlParserOptions) *Parser {
	if options.AttributePrefix == "" {
		options.AttributePrefix = "@_"
	}
	if options.Encoding == "" {
		options.Encoding = "utf-8"
	}
	return &Parser{
		options: options,
	}
}

// SetAlternativeMapping sets an alternative field mapping to try if the primary fails
func (p *Parser) SetAlternativeMapping(mapping *XmlFieldMapping) {
	p.alternativeMapping = mapping
}

// Parse parses XML content into normalized rows
func (p *Parser) Parse(content []byte) (*types.ParseResult, error) {
	return p.ParseWithStoreID(content, "")
}

// ParseWithStoreID parses XML content with a specific store identifier
func (p *Parser) ParseWithStoreID(content []byte, storeID string) (*types.ParseResult, error) {
	// Detect and handle encoding
	decoded, err := p.decodeContent(content)
	if err != nil {
		return nil, fmt.Errorf("failed to decode content: %w", err)
	}

	// Parse XML into generic map structure
	data, err := p.parseXMLToMap(decoded)
	if err != nil {
		return nil, fmt.Errorf("failed to parse XML: %w", err)
	}

	// Try to find items using configured path
	itemsPath := p.options.ItemsPath
	if itemsPath == "" {
		// Try to detect items path
		itemsPath = p.detectItemsPath(data)
		if itemsPath == "" {
			return nil, fmt.Errorf("could not detect items path in XML")
		}
	}

	// Get items from path
	items, err := p.getItemsAtPath(data, itemsPath)
	if err != nil {
		return nil, fmt.Errorf("failed to get items at path %s: %w", itemsPath, err)
	}

	// Parse each item using primary field mapping
	result := p.parseItems(items, p.options.FieldMapping, storeID)

	// If no valid rows, try alternative mapping
	if result.ValidRows == 0 && p.alternativeMapping != nil {
		result = p.parseItems(items, *p.alternativeMapping, storeID)
	}

	return result, nil
}

// ParseWithItemsPath parses XML content using a specific items path
func (p *Parser) ParseWithItemsPath(content []byte, itemsPath string, mapping XmlFieldMapping, storeID string) (*types.ParseResult, error) {
	decoded, err := p.decodeContent(content)
	if err != nil {
		return nil, fmt.Errorf("failed to decode content: %w", err)
	}

	data, err := p.parseXMLToMap(decoded)
	if err != nil {
		return nil, fmt.Errorf("failed to parse XML: %w", err)
	}

	items, err := p.getItemsAtPath(data, itemsPath)
	if err != nil {
		return nil, fmt.Errorf("failed to get items at path %s: %w", itemsPath, err)
	}

	return p.parseItems(items, mapping, storeID), nil
}

// decodeContent handles encoding detection and conversion to UTF-8
func (p *Parser) decodeContent(content []byte) (string, error) {
	// Check for BOM
	if len(content) >= 3 && content[0] == 0xEF && content[1] == 0xBB && content[2] == 0xBF {
		// UTF-8 BOM
		return string(content[3:]), nil
	}
	if len(content) >= 2 && content[0] == 0xFF && content[1] == 0xFE {
		// UTF-16 LE BOM - not commonly supported, just strip it
		return string(content[2:]), nil
	}
	if len(content) >= 2 && content[0] == 0xFE && content[1] == 0xFF {
		// UTF-16 BE BOM
		return string(content[2:]), nil
	}

	// Detect encoding from XML declaration
	enc := p.options.Encoding
	if enc == "" || enc == "auto" {
		enc = p.detectEncodingFromDeclaration(content)
		if enc == "" {
			enc = string(charset.DetectEncoding(content))
		}
	}

	// Decode to UTF-8
	decoded, err := charset.Decode(content, charset.Encoding(enc))
	if err != nil {
		// Fallback to treating as UTF-8
		return string(content), nil
	}

	return decoded, nil
}

// detectEncodingFromDeclaration extracts encoding from XML declaration
func (p *Parser) detectEncodingFromDeclaration(content []byte) string {
	// Look for <?xml ... encoding="..." ?>
	re := regexp.MustCompile(`<\?xml[^?]*encoding=["']([^"']+)["'][^?]*\?>`)
	if match := re.FindSubmatch(content[:min(200, len(content))]); len(match) > 1 {
		enc := strings.ToLower(string(match[1]))
		// Normalize encoding names
		switch enc {
		case "windows-1250", "cp1250":
			return "windows-1250"
		case "iso-8859-2", "latin2":
			return "iso-8859-2"
		default:
			return enc
		}
	}
	return ""
}

// parseXMLToMap parses XML content into a nested map structure
func (p *Parser) parseXMLToMap(content string) (map[string]interface{}, error) {
	decoder := xml.NewDecoder(strings.NewReader(content))
	decoder.CharsetReader = func(charset string, input io.Reader) (io.Reader, error) {
		return input, nil // Already handled encoding
	}

	return p.decodeElement(decoder, nil)
}

// decodeElement recursively decodes XML elements into maps
func (p *Parser) decodeElement(decoder *xml.Decoder, start *xml.StartElement) (map[string]interface{}, error) {
	result := make(map[string]interface{})

	// Add attributes if present
	if start != nil {
		for _, attr := range start.Attr {
			key := p.options.AttributePrefix + attr.Name.Local
			result[key] = attr.Value
		}
	}

	var textContent strings.Builder
	var childName string
	var childStart *xml.StartElement

	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}

		switch t := token.(type) {
		case xml.StartElement:
			childName = t.Name.Local
			childStart = &t

			// Recursively decode child element
			childValue, err := p.decodeElement(decoder, childStart)
			if err != nil {
				return nil, err
			}

			// Handle repeated elements (arrays)
			if existing, exists := result[childName]; exists {
				switch v := existing.(type) {
				case []interface{}:
					result[childName] = append(v, childValue)
				default:
					result[childName] = []interface{}{v, childValue}
				}
			} else {
				result[childName] = childValue
			}

		case xml.CharData:
			text := strings.TrimSpace(string(t))
			if text != "" {
				textContent.WriteString(text)
			}

		case xml.EndElement:
			// Store text content if present
			if text := textContent.String(); text != "" {
				if len(result) == 0 {
					// Return just the text as a map with special key
					result["#text"] = text
				} else {
					// Add text content to existing map
					result["#text"] = text
				}
			}
			return result, nil
		}
	}

	// Handle text content
	if text := textContent.String(); text != "" {
		result["#text"] = text
	}

	return result, nil
}

// detectItemsPath tries to find the path to items array in the XML data
func (p *Parser) detectItemsPath(data map[string]interface{}) string {
	// Common item paths to try
	commonPaths := []string{
		"products.product",
		"Products.Product",
		"items.item",
		"Items.Item",
		"data.product",
		"Data.Product",
		"Cjenik.Proizvod",
		"cjenik.proizvod",
		"catalog.product",
		"Catalog.Product",
	}

	for _, path := range commonPaths {
		if items, err := p.getItemsAtPath(data, path); err == nil && len(items) > 0 {
			return path
		}
	}

	// Try to find arrays in the data (depth-first search)
	return p.findArrayPath(data, "", 2)
}

// findArrayPath recursively searches for array paths
func (p *Parser) findArrayPath(data map[string]interface{}, prefix string, maxDepth int) string {
	if maxDepth <= 0 {
		return ""
	}

	for key, value := range data {
		currentPath := key
		if prefix != "" {
			currentPath = prefix + "." + key
		}

		switch v := value.(type) {
		case []interface{}:
			if len(v) > 0 {
				// Found an array with items
				return currentPath
			}
		case map[string]interface{}:
			// Recurse into nested map
			if found := p.findArrayPath(v, currentPath, maxDepth-1); found != "" {
				return found
			}
		}
	}

	return ""
}

// getItemsAtPath navigates to the specified path and returns items as a slice
func (p *Parser) getItemsAtPath(data map[string]interface{}, path string) ([]map[string]interface{}, error) {
	parts := strings.Split(path, ".")

	current := data
	for i, part := range parts {
		value, ok := current[part]
		if !ok {
			// Try case-insensitive match
			for k, v := range current {
				if strings.EqualFold(k, part) {
					value = v
					ok = true
					break
				}
			}
		}
		if !ok {
			return nil, fmt.Errorf("path segment '%s' not found", part)
		}

		// Last segment should be an array or single item
		if i == len(parts)-1 {
			return p.toItemSlice(value)
		}

		// Navigate deeper
		switch v := value.(type) {
		case map[string]interface{}:
			current = v
		default:
			return nil, fmt.Errorf("cannot navigate through %T at '%s'", value, part)
		}
	}

	return nil, fmt.Errorf("path not found: %s", path)
}

// toItemSlice converts a value to a slice of maps
func (p *Parser) toItemSlice(value interface{}) ([]map[string]interface{}, error) {
	switch v := value.(type) {
	case []interface{}:
		result := make([]map[string]interface{}, 0, len(v))
		for _, item := range v {
			if m, ok := item.(map[string]interface{}); ok {
				result = append(result, m)
			}
		}
		return result, nil
	case map[string]interface{}:
		// Single item - wrap in slice
		return []map[string]interface{}{v}, nil
	default:
		return nil, fmt.Errorf("expected array or map, got %T", value)
	}
}

// parseItems parses a slice of items into normalized rows
func (p *Parser) parseItems(items []map[string]interface{}, mapping XmlFieldMapping, defaultStoreID string) *types.ParseResult {
	result := &types.ParseResult{
		TotalRows: len(items),
		Rows:      make([]types.NormalizedRow, 0, len(items)),
		Errors:    make([]types.ParseError, 0),
		Warnings:  make([]types.ParseWarning, 0),
	}

	for i, item := range items {
		rowNumber := i + 1
		row, errors := p.mapItemToRow(item, rowNumber, mapping, defaultStoreID)

		if len(errors) > 0 {
			for _, e := range errors {
				result.Errors = append(result.Errors, types.ParseError{
					RowNumber:     &rowNumber,
					Field:         e.Field,
					Message:       e.Message,
					OriginalValue: e.OriginalValue,
				})
			}
			continue
		}

		result.Rows = append(result.Rows, *row)
		result.ValidRows++
	}

	return result
}

// mapItemToRow maps a single XML item to a NormalizedRow
func (p *Parser) mapItemToRow(item map[string]interface{}, rowNumber int, mapping XmlFieldMapping, defaultStoreID string) (*types.NormalizedRow, []types.ParseError) {
	var errors []types.ParseError

	// Helper to extract string value
	extractString := func(path *string, extractor FieldExtractor) *string {
		if extractor != nil {
			val := extractor(item)
			if val != "" {
				return &val
			}
			return nil
		}
		if path == nil {
			return nil
		}
		return p.extractStringValue(item, *path)
	}

	// Extract name (required)
	var name string
	if mapping.NameExtractor != nil {
		name = mapping.NameExtractor(item)
	} else {
		if nameVal := p.extractStringValue(item, mapping.Name); nameVal != nil {
			name = *nameVal
		}
	}
	if name == "" {
		errors = append(errors, types.ParseError{
			RowNumber: &rowNumber,
			Field:     types.StringPtr("name"),
			Message:   "Name is required",
		})
	}

	// Extract price (required)
	var price int
	var priceStr string
	if mapping.PriceExtractor != nil {
		priceStr = mapping.PriceExtractor(item)
	} else {
		if priceVal := p.extractStringValue(item, mapping.Price); priceVal != nil {
			priceStr = *priceVal
		}
	}
	if priceStr == "" {
		errors = append(errors, types.ParseError{
			RowNumber: &rowNumber,
			Field:     types.StringPtr("price"),
			Message:   "Price is required",
		})
	} else {
		var err error
		price, err = parsePrice(priceStr)
		if err != nil {
			errors = append(errors, types.ParseError{
				RowNumber:     &rowNumber,
				Field:         types.StringPtr("price"),
				Message:       "Invalid price value",
				OriginalValue: &priceStr,
			})
		}
	}

	if len(errors) > 0 {
		return nil, errors
	}

	// Extract optional fields
	storeIdentifier := defaultStoreID
	if storeVal := extractString(mapping.StoreIdentifier, nil); storeVal != nil {
		storeIdentifier = *storeVal
	}

	// Extract barcodes
	var barcodes []string
	if mapping.BarcodesExtractor != nil {
		barcodes = mapping.BarcodesExtractor(item)
	} else if mapping.Barcodes != nil {
		barcodes = p.extractBarcodes(item, *mapping.Barcodes)
	}
	if barcodes == nil {
		barcodes = []string{}
	}

	// Parse optional prices
	var discountPrice *int
	if discountStr := extractString(mapping.DiscountPrice, nil); discountStr != nil {
		if parsed, err := parsePrice(*discountStr); err == nil {
			discountPrice = &parsed
		}
	}

	var unitPrice *int
	if unitPriceStr := extractString(mapping.UnitPrice, nil); unitPriceStr != nil {
		if parsed, err := parsePrice(*unitPriceStr); err == nil {
			unitPrice = &parsed
		}
	}

	var lowestPrice30d *int
	if lowestStr := extractString(mapping.LowestPrice30d, nil); lowestStr != nil {
		if parsed, err := parsePrice(*lowestStr); err == nil {
			lowestPrice30d = &parsed
		}
	}

	var anchorPrice *int
	if anchorStr := extractString(mapping.AnchorPrice, nil); anchorStr != nil {
		if parsed, err := parsePrice(*anchorStr); err == nil {
			anchorPrice = &parsed
		}
	}

	// Parse dates
	discountStart := parseDate(extractString(mapping.DiscountStart, nil))
	discountEnd := parseDate(extractString(mapping.DiscountEnd, nil))
	anchorPriceAsOf := parseDate(extractString(mapping.AnchorPriceAsOf, nil))

	// Build raw data JSON
	rawDataJSON, _ := json.Marshal(item)

	row := &types.NormalizedRow{
		StoreIdentifier:       storeIdentifier,
		ExternalID:            extractString(mapping.ExternalID, nil),
		Name:                  name,
		Description:           extractString(mapping.Description, nil),
		Category:              extractString(mapping.Category, nil),
		Subcategory:           extractString(mapping.Subcategory, nil),
		Brand:                 extractString(mapping.Brand, nil),
		Unit:                  extractString(mapping.Unit, nil),
		UnitQuantity:          extractString(mapping.UnitQuantity, nil),
		Price:                 price,
		DiscountPrice:         discountPrice,
		DiscountStart:         discountStart,
		DiscountEnd:           discountEnd,
		Barcodes:              barcodes,
		ImageURL:              extractString(mapping.ImageURL, nil),
		RowNumber:             rowNumber,
		RawData:               string(rawDataJSON),
		UnitPrice:             unitPrice,
		UnitPriceBaseQuantity: extractString(mapping.UnitPriceBaseQuantity, nil),
		UnitPriceBaseUnit:     extractString(mapping.UnitPriceBaseUnit, nil),
		LowestPrice30d:        lowestPrice30d,
		AnchorPrice:           anchorPrice,
		AnchorPriceAsOf:       anchorPriceAsOf,
	}

	return row, nil
}

// extractStringValue extracts a string value from an item using a path
func (p *Parser) extractStringValue(item map[string]interface{}, path string) *string {
	parts := strings.Split(path, ".")

	var current interface{} = item
	for _, part := range parts {
		switch v := current.(type) {
		case map[string]interface{}:
			var found bool
			current, found = v[part]
			if !found {
				// Try case-insensitive match
				for k, val := range v {
					if strings.EqualFold(k, part) {
						current = val
						found = true
						break
					}
				}
			}
			if !found {
				return nil
			}
		default:
			return nil
		}
	}

	// Convert value to string
	return p.valueToString(current)
}

// valueToString converts various types to string
func (p *Parser) valueToString(value interface{}) *string {
	if value == nil {
		return nil
	}

	switch v := value.(type) {
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return nil
		}
		return &trimmed
	case float64:
		str := fmt.Sprintf("%g", v)
		return &str
	case int:
		str := fmt.Sprintf("%d", v)
		return &str
	case int64:
		str := fmt.Sprintf("%d", v)
		return &str
	case bool:
		str := fmt.Sprintf("%t", v)
		return &str
	case map[string]interface{}:
		// Handle objects with text content
		for _, textKey := range []string{"#text", "_text", ".", ""} {
			if textVal, ok := v[textKey]; ok {
				return p.valueToString(textVal)
			}
		}
		// Try to get first string value
		for _, val := range v {
			if result := p.valueToString(val); result != nil {
				return result
			}
		}
		return nil
	default:
		str := fmt.Sprintf("%v", v)
		trimmed := strings.TrimSpace(str)
		if trimmed == "" {
			return nil
		}
		return &trimmed
	}
}

// extractBarcodes extracts barcodes from an item
func (p *Parser) extractBarcodes(item map[string]interface{}, path string) []string {
	value := p.getValueAtPath(item, path)
	if value == nil {
		return nil
	}

	switch v := value.(type) {
	case []interface{}:
		// Array of barcodes
		barcodes := make([]string, 0, len(v))
		for _, bc := range v {
			if str := p.valueToString(bc); str != nil && *str != "" {
				barcodes = append(barcodes, *str)
			}
		}
		return barcodes
	case string:
		// Possibly comma/semicolon separated
		return splitBarcodes(v)
	case map[string]interface{}:
		// Single barcode object
		if str := p.valueToString(v); str != nil && *str != "" {
			return []string{*str}
		}
		return nil
	default:
		if str := p.valueToString(v); str != nil && *str != "" {
			return splitBarcodes(*str)
		}
		return nil
	}
}

// getValueAtPath retrieves a value at a dot-notation path
func (p *Parser) getValueAtPath(item map[string]interface{}, path string) interface{} {
	parts := strings.Split(path, ".")

	var current interface{} = item
	for _, part := range parts {
		switch v := current.(type) {
		case map[string]interface{}:
			var found bool
			current, found = v[part]
			if !found {
				// Try case-insensitive match
				for k, val := range v {
					if strings.EqualFold(k, part) {
						current = val
						found = true
						break
					}
				}
			}
			if !found {
				return nil
			}
		default:
			return nil
		}
	}

	return current
}

// splitBarcodes splits a string into individual barcodes
func splitBarcodes(s string) []string {
	// Split on common separators
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

// parsePrice parses a price string to cents
func parsePrice(value string) (int, error) {
	if value == "" {
		return 0, fmt.Errorf("empty price value")
	}

	// Remove currency symbols and whitespace
	cleaned := strings.TrimSpace(value)
	cleaned = strings.Map(func(r rune) rune {
		if r == '€' || r == '$' || r == '£' || r == '₹' ||
			r == '¥' || r == '¢' || r == '\u00A0' {
			return -1
		}
		return r
	}, cleaned)

	// Remove common currency text
	cleaned = strings.ToUpper(cleaned)
	cleaned = regexp.MustCompile(`\s*(KN|KUNA|HRK|EUR|USD)\s*$`).ReplaceAllString(cleaned, "")
	cleaned = strings.TrimSpace(cleaned)

	if cleaned == "" {
		return 0, fmt.Errorf("no numeric value found")
	}

	// Determine decimal separator
	lastDot := strings.LastIndex(cleaned, ".")
	lastComma := strings.LastIndex(cleaned, ",")

	if lastComma > lastDot {
		// European format: 1.234,56 -> comma is decimal
		cleaned = strings.ReplaceAll(cleaned, ".", "")
		cleaned = strings.ReplaceAll(cleaned, ",", ".")
	} else if lastDot > lastComma {
		// US format: 1,234.56 -> just remove commas
		cleaned = strings.ReplaceAll(cleaned, ",", "")
	}

	// Parse the float
	var result float64
	hasDigit := false
	for _, r := range cleaned {
		if unicode.IsDigit(r) {
			hasDigit = true
			break
		}
	}
	if !hasDigit {
		return 0, fmt.Errorf("no digits found")
	}

	_, err := fmt.Sscanf(cleaned, "%f", &result)
	if err != nil {
		return 0, fmt.Errorf("invalid price format: %w", err)
	}

	// Convert to cents
	cents := math.Round(result * 100)
	return int(cents), nil
}

// parseDate parses a date string into time.Time
func parseDate(value *string) *time.Time {
	if value == nil || *value == "" {
		return nil
	}

	s := strings.TrimSpace(*value)

	layouts := []string{
		"2006-01-02",
		"2006/01/02",
		"02.01.2006",
		"02/01/2006",
		"02-01-2006",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05-07:00",
	}

	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return &t
		}
	}

	return nil
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// GetBuffer returns a bytes.Buffer - helper for XML generation if needed
func GetBuffer() *bytes.Buffer {
	return new(bytes.Buffer)
}
