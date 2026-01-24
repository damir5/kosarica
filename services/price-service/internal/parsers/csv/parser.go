package csv

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/kosarica/price-service/internal/parsers/charset"
	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog/log"
)

// Parser implements CSV parsing with encoding detection and column mapping
type Parser struct {
	options CsvParserOptions

	// Alternative mapping for fallback
	alternativeMapping *CsvColumnMapping
}

// NewParser creates a new CSV parser with the given options
func NewParser(options CsvParserOptions) *Parser {
	if options.QuoteChar == 0 {
		options.QuoteChar = '"'
	}
	return &Parser{
		options: options,
	}
}

// SetAlternativeMapping sets an alternative column mapping to try if the primary fails
func (p *Parser) SetAlternativeMapping(mapping *CsvColumnMapping) {
	p.alternativeMapping = mapping
}

// Parse parses CSV content into normalized rows
func (p *Parser) Parse(content []byte) (*types.ParseResult, error) {
	return p.ParseWithStoreID(content, "")
}

// ParseWithStoreID parses CSV content with a specific store identifier
func (p *Parser) ParseWithStoreID(content []byte, storeID string) (*types.ParseResult, error) {
	opts := p.resolveOptions()

	// Detect encoding if not set
	if opts.Encoding == "" {
		detected := charset.DetectEncoding(content)
		opts.Encoding = CsvEncoding(detected)
	}

	// Decode content to UTF-8
	decoded, err := charset.Decode(content, charset.Encoding(opts.Encoding))
	if err != nil {
		return nil, fmt.Errorf("failed to decode content: %w", err)
	}

	// Detect delimiter if not set
	if opts.Delimiter == "" {
		opts.Delimiter = DetectDelimiter(decoded)
	}

	// Parse CSV into raw rows
	rawRows, err := p.parseCSV(decoded, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to parse CSV: %w", err)
	}

	if len(rawRows) == 0 {
		return &types.ParseResult{
			TotalRows: 0,
			ValidRows: 0,
		}, nil
	}

	// Extract headers if present
	headers := make([]string, 0)
	dataStartRow := 0
	if opts.HasHeader {
		if len(rawRows) > 0 {
			headers = rawRows[0]
			dataStartRow = 1
		}
	}

	// Build column indices
	columnIndices, err := p.buildColumnIndices(headers, opts.ColumnMapping)
	if err != nil {
		return &types.ParseResult{
			Errors: []types.ParseError{
				{
					Field:   nil,
					Message: err.Error(),
				},
			},
			TotalRows: len(rawRows) - dataStartRow,
		}, nil
	}

	// Parse rows
	result := &types.ParseResult{
		TotalRows: 0,
		ValidRows: 0,
		Rows:      make([]types.NormalizedRow, 0),
		Errors:    make([]types.ParseError, 0),
		Warnings:  make([]types.ParseWarning, 0),
	}

	for i := dataStartRow; i < len(rawRows); i++ {
		rawRow := rawRows[i]
		rowNumber := i + 1

		// Skip empty rows
		if opts.SkipEmptyRows && isEmptyRow(rawRow) {
			continue
		}

		result.TotalRows++

		row, errs := p.mapRowToNormalized(rawRow, rowNumber, columnIndices, storeID)
		if len(errs) > 0 {
			for _, e := range errs {
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

	// If no valid rows and we have an alternative mapping, try it
	if result.ValidRows == 0 && p.alternativeMapping != nil {
		altOpts := p.options
		altOpts.ColumnMapping = p.alternativeMapping
		altParser := NewParser(altOpts)
		return altParser.ParseWithStoreID(content, storeID)
	}

	return result, nil
}

// parseCSV parses CSV content into raw rows
func (p *Parser) parseCSV(content string, opts CsvParserOptions) ([][]string, error) {
	lines := splitLines(content)
	rows := make([][]string, 0, len(lines))

	delimRune := rune(opts.Delimiter[0])

	for _, line := range lines {
		if line == "" {
			rows = append(rows, []string{})
			continue
		}

		fields := SplitCSVLine(line, delimRune, opts.QuoteChar)

		// Trim whitespace from each field
		trimmed := make([]string, len(fields))
		for i, f := range fields {
			trimmed[i] = strings.TrimSpace(f)
		}

		rows = append(rows, trimmed)
	}

	return rows, nil
}

// buildColumnIndices builds a map of field names to column indices
func (p *Parser) buildColumnIndices(headers []string, mapping *CsvColumnMapping) (map[string]int, error) {
	if mapping == nil {
		return nil, fmt.Errorf("no column mapping provided")
	}

	indices := make(map[string]int)

	// Fuzzy header matching: remove diacritics for comparison
	normalizeHeader := func(h string) string {
		return strings.ToLower(
			strings.Map(func(r rune) rune {
				switch r {
				case 'š':
					return 's'
				case 'č':
					return 'c'
				case 'ć':
					return 'c'
				case 'ž':
					return 'z'
				case 'đ':
					return 'd'
				case 'Đ':
					return 'd'
				default:
					return r
				}
			}, strings.TrimSpace(h)))
	}

	resolveIndex := func(field string, value *string, required bool) error {
		if value == nil {
			if required {
				return fmt.Errorf("required field %s not in mapping", field)
			}
			return nil
		}

		// Check if it's a numeric index (column position)
		var idx int
		var err error
		idx, err = parseColumnIndex(*value)
		if err == nil {
			// It's a numeric index
			if idx < 0 {
				return fmt.Errorf("invalid column index for %s: %s", field, *value)
			}
			indices[field] = idx
			return nil
		}

		// Try exact case-insensitive match first
		idx = -1
		for i, h := range headers {
			if strings.EqualFold(strings.TrimSpace(h), strings.TrimSpace(*value)) {
				idx = i
				break
			}
		}

		// Fallback: fuzzy match (diacritic-insensitive)
		if idx == -1 {
			normalizedMapping := normalizeHeader(*value)
			for i, h := range headers {
				normalizedHeader := normalizeHeader(h)
				if normalizedHeader == normalizedMapping {
					log.Warn().Str("mapping", *value).Str("header", h).Msg("Fuzzy header match")
					idx = i
					break
				}
			}
		}

		if idx == -1 {
			if required {
				return fmt.Errorf("column '%s' for field '%s' not found in headers", *value, field)
			}
			// Optional field not found - that's ok
			return nil
		}

		indices[field] = idx
		return nil
	}

	// Resolve all fields
	mustResolve := resolveIndex
	if err := mustResolve("name", &mapping.Name, true); err != nil {
		return nil, err
	}
	if err := mustResolve("price", &mapping.Price, true); err != nil {
		return nil, err
	}

	// Optional fields
	resolveIndex("storeIdentifier", mapping.StoreIdentifier, false)
	resolveIndex("externalId", mapping.ExternalID, false)
	resolveIndex("description", mapping.Description, false)
	resolveIndex("category", mapping.Category, false)
	resolveIndex("subcategory", mapping.Subcategory, false)
	resolveIndex("brand", mapping.Brand, false)
	resolveIndex("unit", mapping.Unit, false)
	resolveIndex("unitQuantity", mapping.UnitQuantity, false)
	resolveIndex("discountPrice", mapping.DiscountPrice, false)
	resolveIndex("discountStart", mapping.DiscountStart, false)
	resolveIndex("discountEnd", mapping.DiscountEnd, false)
	resolveIndex("barcodes", mapping.Barcodes, false)
	resolveIndex("imageUrl", mapping.ImageURL, false)
	resolveIndex("unitPrice", mapping.UnitPrice, false)
	resolveIndex("unitPriceBaseQuantity", mapping.UnitPriceBaseQuantity, false)
	resolveIndex("unitPriceBaseUnit", mapping.UnitPriceBaseUnit, false)
	resolveIndex("lowestPrice30d", mapping.LowestPrice30d, false)
	resolveIndex("anchorPrice", mapping.AnchorPrice, false)
	resolveIndex("anchorPriceAsOf", mapping.AnchorPriceAsOf, false)

	return indices, nil
}

// mapRowToNormalized maps a raw CSV row to NormalizedRow
func (p *Parser) mapRowToNormalized(rawRow []string, rowNumber int, indices map[string]int, defaultStoreID string) (*types.NormalizedRow, []types.ParseError) {
	var errors []types.ParseError

	getValue := func(field string) *string {
		idx, ok := indices[field]
		if !ok || idx >= len(rawRow) {
			return nil
		}
		val := strings.TrimSpace(rawRow[idx])
		if val == "" {
			return nil
		}
		return &val
	}

	// Parse price
	price := 0
	if priceStr := getValue("price"); priceStr != nil {
		log.Debug().Int("row", rowNumber).Str("value", *priceStr).Interface("indices", indices).Msg("Price column FOUND")
		parsed, err := ParsePrice(*priceStr)
		if err != nil {
			log.Debug().Int("row", rowNumber).Str("value", *priceStr).Err(err).Msg("Price parse ERROR")
			errors = append(errors, types.ParseError{
				RowNumber:     &rowNumber,
				Field:         types.StringPtr("price"),
				Message:       "Invalid price value",
				OriginalValue: priceStr,
			})
		} else {
			log.Debug().Int("row", rowNumber).Str("value", *priceStr).Int("cents", parsed).Msg("Price parse OK")
			price = parsed
		}
	} else {
		log.Debug().Int("row", rowNumber).Interface("indices", indices).Msg("Price column NOT FOUND")
	}

	// Parse discount price
	var discountPrice *int
	if discountPriceStr := getValue("discountPrice"); discountPriceStr != nil {
		parsed, err := ParsePrice(*discountPriceStr)
		if err == nil {
			discountPrice = &parsed
		}
	}

	// Parse dates
	discountStart := parseDate(getValue("discountStart"))
	discountEnd := parseDate(getValue("discountEnd"))

	// Parse barcodes
	barcodes := make([]string, 0)
	if barcodesStr := getValue("barcodes"); barcodesStr != nil {
		parts := strings.Split(*barcodesStr, ",;")
		for _, b := range parts {
			trimmed := strings.TrimSpace(b)
			if trimmed != "" {
				barcodes = append(barcodes, trimmed)
			}
		}
	}

	// Parse price transparency fields
	var unitPrice *int
	if unitPriceStr := getValue("unitPrice"); unitPriceStr != nil {
		parsed, err := ParsePrice(*unitPriceStr)
		if err == nil {
			unitPrice = &parsed
		}
	}

	var lowestPrice30d *int
	if lowestPriceStr := getValue("lowestPrice30d"); lowestPriceStr != nil {
		parsed, err := ParsePrice(*lowestPriceStr)
		if err == nil {
			lowestPrice30d = &parsed
		}
	}

	var anchorPrice *int
	if anchorPriceStr := getValue("anchorPrice"); anchorPriceStr != nil {
		parsed, err := ParsePrice(*anchorPriceStr)
		if err == nil {
			anchorPrice = &parsed
		}
	}

	anchorPriceAsOf := parseDate(getValue("anchorPriceAsOf"))

	// Store identifier
	storeIdentifier := defaultStoreID
	if storeID := getValue("storeIdentifier"); storeID != nil {
		storeIdentifier = *storeID
	}

	// Name is required
	name := ""
	if nameVal := getValue("name"); nameVal != nil {
		name = *nameVal
	}
	if name == "" {
		errors = append(errors, types.ParseError{
			RowNumber: &rowNumber,
			Field:     types.StringPtr("name"),
			Message:   "Name is required",
		})
	}

	if len(errors) > 0 {
		return nil, errors
	}

	// Build raw data JSON
	rawDataJSON, _ := json.Marshal(rawRow)

	row := &types.NormalizedRow{
		StoreIdentifier:       storeIdentifier,
		ExternalID:            getValue("externalId"),
		Name:                  name,
		Description:           getValue("description"),
		Category:              getValue("category"),
		Subcategory:           getValue("subcategory"),
		Brand:                 getValue("brand"),
		Unit:                  getValue("unit"),
		UnitQuantity:          getValue("unitQuantity"),
		Price:                 price,
		DiscountPrice:         discountPrice,
		DiscountStart:         discountStart,
		DiscountEnd:           discountEnd,
		Barcodes:              barcodes,
		ImageURL:              getValue("imageUrl"),
		RowNumber:             rowNumber,
		RawData:               string(rawDataJSON),
		UnitPrice:             unitPrice,
		UnitPriceBaseQuantity: getValue("unitPriceBaseQuantity"),
		UnitPriceBaseUnit:     getValue("unitPriceBaseUnit"),
		LowestPrice30d:        lowestPrice30d,
		AnchorPrice:           anchorPrice,
		AnchorPriceAsOf:       anchorPriceAsOf,
	}

	return row, nil
}

// resolveOptions returns options with defaults filled in
func (p *Parser) resolveOptions() CsvParserOptions {
	opts := p.options
	if opts.Delimiter == "" {
		opts.Delimiter = DelimiterComma
	}
	if opts.Encoding == "" {
		opts.Encoding = EncodingUTF8
	}
	if opts.QuoteChar == 0 {
		opts.QuoteChar = '"'
	}
	return opts
}

// splitLines splits content into lines handling different line endings
func splitLines(content string) []string {
	// Normalize line endings
	content = strings.ReplaceAll(content, "\r\n", "\n")
	content = strings.ReplaceAll(content, "\r", "\n")
	return strings.Split(content, "\n")
}

// isEmptyRow checks if a row is empty
func isEmptyRow(row []string) bool {
	for _, cell := range row {
		if strings.TrimSpace(cell) != "" {
			return false
		}
	}
	return true
}

// parseColumnIndex attempts to parse a column index from a string
func parseColumnIndex(s string) (int, error) {
	s = strings.TrimSpace(s)
	var result int
	n, err := fmt.Sscanf(s, "%d", &result)
	if err != nil || n != 1 {
		// Not a simple number
		return -1, fmt.Errorf("not a numeric index")
	}
	return result, nil
}

// parseDate parses a date string into time.Time
func parseDate(value *string) *time.Time {
	if value == nil || *value == "" {
		return nil
	}

	s := strings.TrimSpace(*value)

	// Try ISO format (YYYY-MM-DD)
	layouts := []string{
		"2006-01-02",
		"2006/01/02",
		"02.01.2006",
		"02/01/2006",
		"02-01-2006",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
	}

	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return &t
		}
	}

	return nil
}
