package xlsx

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog/log"
	"github.com/xuri/excelize/v2"
)

// Parser is an XLSX parser implementation
type Parser struct {
	options XlsxParserOptions
	altMapping *XlsxColumnMapping
}

// NewParser creates a new XLSX parser
func NewParser(options XlsxParserOptions) *Parser {
	// Start with defaults and merge user options
	opts := DefaultOptions()

	if options.ColumnMapping != nil {
		opts.ColumnMapping = options.ColumnMapping
	}
	// Only override if explicitly set (check for non-zero values or use explicit logic)
	// HasHeader defaults to true from DefaultOptions
	opts.HasHeader = options.HasHeader
	opts.HeaderRowCount = options.HeaderRowCount
	if options.DefaultStoreIdentifier != "" {
		opts.DefaultStoreIdentifier = options.DefaultStoreIdentifier
	}
	// SkipEmptyRows defaults to true from DefaultOptions, only set if explicitly false
	if !options.SkipEmptyRows && options.ColumnMapping != nil {
		// If ColumnMapping is set, user is configuring options, respect SkipEmptyRows value
		opts.SkipEmptyRows = options.SkipEmptyRows
	}
	if options.SheetNameOrIndex != nil {
		opts.SheetNameOrIndex = options.SheetNameOrIndex
	}

	return &Parser{
		options: opts,
	}
}

// SetOptions updates parser options
func (p *Parser) SetOptions(options XlsxParserOptions) {
	if options.ColumnMapping != nil {
		p.options.ColumnMapping = options.ColumnMapping
	}
	p.options.HasHeader = options.HasHeader
	p.options.HeaderRowCount = options.HeaderRowCount
	p.options.DefaultStoreIdentifier = options.DefaultStoreIdentifier
	p.options.SkipEmptyRows = options.SkipEmptyRows
	if options.SheetNameOrIndex != nil {
		p.options.SheetNameOrIndex = options.SheetNameOrIndex
	}
}

// SetAlternativeMapping sets an alternative column mapping to try if primary fails
func (p *Parser) SetAlternativeMapping(mapping *XlsxColumnMapping) {
	p.altMapping = mapping
}

// Parse parses XLSX content into normalized rows
func (p *Parser) Parse(content []byte, filename string) (*types.ParseResult, error) {
	return p.ParseWithStoreID(content, p.options.DefaultStoreIdentifier)
}

// ParseWithStoreID parses XLSX content with a specific default store identifier
func (p *Parser) ParseWithStoreID(content []byte, defaultStoreID string) (*types.ParseResult, error) {
	result, err := p.parseWithMapping(content, p.options.ColumnMapping, defaultStoreID)
	if err != nil {
		return nil, err
	}

	// If no valid rows and we have an alternative mapping, try it
	if result.ValidRows == 0 && p.altMapping != nil {
		altResult, altErr := p.parseWithMapping(content, p.altMapping, defaultStoreID)
		if altErr == nil && altResult.ValidRows > 0 {
			return altResult, nil
		}
	}

	return result, nil
}

// parseWithMapping parses content using the specified column mapping
func (p *Parser) parseWithMapping(content []byte, mapping *XlsxColumnMapping, defaultStoreID string) (*types.ParseResult, error) {
	result := &types.ParseResult{
		Rows:     make([]types.NormalizedRow, 0),
		Errors:   make([]types.ParseError, 0),
		Warnings: make([]types.ParseWarning, 0),
	}

	// Open workbook from bytes
	f, err := excelize.OpenReader(bytes.NewReader(content))
	if err != nil {
		result.Errors = append(result.Errors, types.ParseError{
			Message: fmt.Sprintf("Failed to parse Excel file: %v", err),
		})
		return result, nil
	}
	defer f.Close()

	// Select sheet
	sheetName, err := p.selectSheet(f)
	if err != nil {
		result.Errors = append(result.Errors, types.ParseError{
			Message: err.Error(),
		})
		return result, nil
	}

	// Get all rows
	rows, err := f.GetRows(sheetName)
	if err != nil {
		result.Errors = append(result.Errors, types.ParseError{
			Message: fmt.Sprintf("Failed to read worksheet: %v", err),
		})
		return result, nil
	}

	if len(rows) == 0 {
		result.Warnings = append(result.Warnings, types.ParseWarning{
			Message: "Excel file is empty",
		})
		return result, nil
	}

	// Extract headers if present
	var headers []string
	dataStartRow := p.options.HeaderRowCount

	if p.options.HasHeader {
		if len(rows) > 0 {
			headers = make([]string, len(rows[0]))
			for i, cell := range rows[0] {
				headers[i] = strings.TrimSpace(cell)
			}
		}
		if dataStartRow == 0 {
			dataStartRow = 1
		}
	}

	// Calculate total rows before data processing
	totalDataRows := 0
	if len(rows) > dataStartRow {
		totalDataRows = len(rows) - dataStartRow
	}
	result.TotalRows = totalDataRows

	// Build column indices
	if mapping == nil {
		result.Errors = append(result.Errors, types.ParseError{
			Message: "No column mapping provided. Cannot map Excel columns to normalized fields.",
		})
		return result, nil
	}

	indices, err := p.buildColumnIndices(headers, mapping)
	if err != nil {
		result.Errors = append(result.Errors, types.ParseError{
			Message: err.Error(),
		})
		return result, nil
	}

	// Parse data rows
	for i := dataStartRow; i < len(rows); i++ {
		rawRow := rows[i]
		rowNumber := i + 1 // 1-based for user-facing

		// Skip empty rows
		if p.options.SkipEmptyRows && isEmptyRow(rawRow) {
			continue
		}

		normalizedRow, rowErrors, rowWarnings := p.mapRowToNormalized(rawRow, rowNumber, indices, defaultStoreID)

		// Add errors and warnings
		for _, err := range rowErrors {
			result.Errors = append(result.Errors, err)
		}
		for _, warn := range rowWarnings {
			result.Warnings = append(result.Warnings, warn)
		}

		if normalizedRow != nil {
			// Validate required fields
			validationErrors := p.validateRequiredFields(normalizedRow)
			if len(validationErrors) > 0 {
				for _, errMsg := range validationErrors {
					rawData, _ := json.Marshal(rawRow)
					result.Errors = append(result.Errors, types.ParseError{
						RowNumber:     types.IntPtr(rowNumber),
						Message:       errMsg,
						OriginalValue: types.StringPtr(string(rawData)),
					})
				}
				continue
			}
			result.Rows = append(result.Rows, *normalizedRow)
		}
	}

	result.ValidRows = len(result.Rows)
	return result, nil
}

// selectSheet selects the appropriate sheet from the workbook
func (p *Parser) selectSheet(f *excelize.File) (string, error) {
	sheetList := f.GetSheetList()
	if len(sheetList) == 0 {
		return "", fmt.Errorf("workbook has no sheets")
	}

	if p.options.SheetNameOrIndex == nil {
		return sheetList[0], nil
	}

	switch v := p.options.SheetNameOrIndex.(type) {
	case int:
		if v >= len(sheetList) {
			return "", fmt.Errorf("sheet index %d not found. Workbook has %d sheets", v, len(sheetList))
		}
		return sheetList[v], nil
	case string:
		for _, name := range sheetList {
			if name == v {
				return name, nil
			}
		}
		return "", fmt.Errorf("sheet %q not found. Available sheets: %s", v, strings.Join(sheetList, ", "))
	default:
		return sheetList[0], nil
	}
}

// buildColumnIndices builds resolved column indices from the mapping
func (p *Parser) buildColumnIndices(headers []string, mapping *XlsxColumnMapping) (*ResolvedColumnIndices, error) {
	indices := NewResolvedColumnIndices()

	resolveIndex := func(fieldName string, col *XlsxColumnIndex) (int, error) {
		if col == nil {
			return InvalidIndex, nil
		}

		if col.IsNumeric() {
			return *col.Index, nil
		}

		if col.IsHeader() {
			headerLower := strings.ToLower(strings.TrimSpace(*col.Header))
			for i, h := range headers {
				if strings.ToLower(strings.TrimSpace(h)) == headerLower {
					return i, nil
				}
			}
			// Header not found - not an error, just return invalid
			return InvalidIndex, nil
		}

		return InvalidIndex, nil
	}

	var err error

	// Required fields
	indices.Name, err = resolveIndex("name", &mapping.Name)
	if err != nil || indices.Name == InvalidIndex {
		return nil, fmt.Errorf("column mapping missing required field: name")
	}

	indices.Price, err = resolveIndex("price", &mapping.Price)
	if err != nil || indices.Price == InvalidIndex {
		return nil, fmt.Errorf("column mapping missing required field: price")
	}

	// Optional fields
	indices.StoreIdentifier, _ = resolveIndex("storeIdentifier", mapping.StoreIdentifier)
	indices.ExternalID, _ = resolveIndex("externalId", mapping.ExternalID)
	indices.Description, _ = resolveIndex("description", mapping.Description)
	indices.Category, _ = resolveIndex("category", mapping.Category)
	indices.Subcategory, _ = resolveIndex("subcategory", mapping.Subcategory)
	indices.Brand, _ = resolveIndex("brand", mapping.Brand)
	indices.Unit, _ = resolveIndex("unit", mapping.Unit)
	indices.UnitQuantity, _ = resolveIndex("unitQuantity", mapping.UnitQuantity)
	indices.DiscountPrice, _ = resolveIndex("discountPrice", mapping.DiscountPrice)
	indices.DiscountStart, _ = resolveIndex("discountStart", mapping.DiscountStart)
	indices.DiscountEnd, _ = resolveIndex("discountEnd", mapping.DiscountEnd)
	indices.Barcodes, _ = resolveIndex("barcodes", mapping.Barcodes)
	indices.ImageURL, _ = resolveIndex("imageUrl", mapping.ImageURL)
	indices.UnitPrice, _ = resolveIndex("unitPrice", mapping.UnitPrice)
	indices.UnitPriceBaseQuantity, _ = resolveIndex("unitPriceBaseQuantity", mapping.UnitPriceBaseQuantity)
	indices.UnitPriceBaseUnit, _ = resolveIndex("unitPriceBaseUnit", mapping.UnitPriceBaseUnit)
	indices.LowestPrice30d, _ = resolveIndex("lowestPrice30d", mapping.LowestPrice30d)
	indices.AnchorPrice, _ = resolveIndex("anchorPrice", mapping.AnchorPrice)
	indices.AnchorPriceAsOf, _ = resolveIndex("anchorPriceAsOf", mapping.AnchorPriceAsOf)

	return &indices, nil
}

// mapRowToNormalized maps a raw Excel row to NormalizedRow
func (p *Parser) mapRowToNormalized(rawRow []string, rowNumber int, indices *ResolvedColumnIndices, defaultStoreID string) (*types.NormalizedRow, []types.ParseError, []types.ParseWarning) {
	var errors []types.ParseError
	var warnings []types.ParseWarning

	getValue := func(idx int) string {
		if idx == InvalidIndex || idx >= len(rawRow) {
			return ""
		}
		return strings.TrimSpace(rawRow[idx])
	}

	getStringPtr := func(idx int) *string {
		val := getValue(idx)
		if val == "" {
			return nil
		}
		return &val
	}

	// Parse price
	priceStr := getValue(indices.Price)
	price, err := parsePrice(priceStr)
	if err != nil {
		errors = append(errors, types.ParseError{
			RowNumber:     types.IntPtr(rowNumber),
			Field:         types.StringPtr("price"),
			Message:       "Invalid price value",
			OriginalValue: types.StringPtr(priceStr),
		})
		price = 0
	}

	// Parse discount price
	var discountPrice *int
	discountPriceStr := getValue(indices.DiscountPrice)
	if discountPriceStr != "" {
		dp, err := parsePrice(discountPriceStr)
		if err != nil {
			warnings = append(warnings, types.ParseWarning{
				RowNumber: types.IntPtr(rowNumber),
				Field:     types.StringPtr("discountPrice"),
				Message:   "Invalid discount price value, ignoring",
			})
		} else {
			discountPrice = &dp
		}
	}

	// Parse dates
	discountStart := parseDate(getValue(indices.DiscountStart))
	discountEnd := parseDate(getValue(indices.DiscountEnd))

	// Parse barcodes
	barcodesStr := getValue(indices.Barcodes)
	var barcodes []string
	if barcodesStr != "" {
		// Split on comma, semicolon, or pipe
		parts := regexp.MustCompile(`[,;|]`).Split(barcodesStr, -1)
		for _, b := range parts {
			b = strings.TrimSpace(b)
			if b != "" {
				barcodes = append(barcodes, b)
			}
		}
	}
	if barcodes == nil {
		barcodes = []string{}
	}

	// Get store identifier
	storeIdentifier := getValue(indices.StoreIdentifier)
	if storeIdentifier == "" {
		storeIdentifier = defaultStoreID
	}

	// Parse Croatian transparency fields
	var unitPrice *int
	unitPriceStr := getValue(indices.UnitPrice)
	if unitPriceStr != "" {
		up, err := parsePrice(unitPriceStr)
		if err != nil {
			warnings = append(warnings, types.ParseWarning{
				RowNumber: types.IntPtr(rowNumber),
				Field:     types.StringPtr("unitPrice"),
				Message:   "Invalid unit price value, ignoring",
			})
		} else {
			unitPrice = &up
		}
	}

	var lowestPrice30d *int
	lowestPrice30dStr := getValue(indices.LowestPrice30d)
	if lowestPrice30dStr != "" {
		lp, err := parsePrice(lowestPrice30dStr)
		if err != nil {
			warnings = append(warnings, types.ParseWarning{
				RowNumber: types.IntPtr(rowNumber),
				Field:     types.StringPtr("lowestPrice30d"),
				Message:   "Invalid lowest price in 30 days value, ignoring",
			})
		} else {
			lowestPrice30d = &lp
		}
	}

	var anchorPrice *int
	anchorPriceStr := getValue(indices.AnchorPrice)
	if anchorPriceStr != "" {
		ap, err := parsePrice(anchorPriceStr)
		if err != nil {
			warnings = append(warnings, types.ParseWarning{
				RowNumber: types.IntPtr(rowNumber),
				Field:     types.StringPtr("anchorPrice"),
				Message:   "Invalid anchor price value, ignoring",
			})
		} else {
			anchorPrice = &ap
		}
	}

	anchorPriceAsOf := parseDate(getValue(indices.AnchorPriceAsOf))

	rawData, _ := json.Marshal(rawRow)

	row := &types.NormalizedRow{
		StoreIdentifier:       storeIdentifier,
		ExternalID:            getStringPtr(indices.ExternalID),
		Name:                  getValue(indices.Name),
		Description:           getStringPtr(indices.Description),
		Category:              getStringPtr(indices.Category),
		Subcategory:           getStringPtr(indices.Subcategory),
		Brand:                 getStringPtr(indices.Brand),
		Unit:                  getStringPtr(indices.Unit),
		UnitQuantity:          getStringPtr(indices.UnitQuantity),
		Price:                 price,
		DiscountPrice:         discountPrice,
		DiscountStart:         discountStart,
		DiscountEnd:           discountEnd,
		Barcodes:              barcodes,
		ImageURL:              getStringPtr(indices.ImageURL),
		RowNumber:             rowNumber,
		RawData:               string(rawData),
		UnitPrice:             unitPrice,
		UnitPriceBaseQuantity: getStringPtr(indices.UnitPriceBaseQuantity),
		UnitPriceBaseUnit:     getStringPtr(indices.UnitPriceBaseUnit),
		LowestPrice30d:        lowestPrice30d,
		AnchorPrice:           anchorPrice,
		AnchorPriceAsOf:       anchorPriceAsOf,
	}

	return row, errors, warnings
}

// validateRequiredFields validates that required fields are present
func (p *Parser) validateRequiredFields(row *types.NormalizedRow) []string {
	var errors []string

	if strings.TrimSpace(row.Name) == "" {
		errors = append(errors, "Missing product name")
	}

	if row.Price <= 0 {
		errors = append(errors, "Price must be positive")
	}

	return errors
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

// parsePrice parses a price string to cents (integer)
// Handles various formats: "12.99", "12,99", "1.299,00"
func parsePrice(value string) (int, error) {
	if value == "" {
		return 0, fmt.Errorf("empty price value")
	}

	// Remove currency symbols and whitespace
	cleaned := regexp.MustCompile(`[€$£\s]`).ReplaceAllString(value, "")

	// Determine decimal separator
	lastDot := strings.LastIndex(cleaned, ".")
	lastComma := strings.LastIndex(cleaned, ",")

	if lastComma > lastDot {
		// European format: 1.234,56 -> comma is decimal
		cleaned = strings.ReplaceAll(cleaned, ".", "")
		cleaned = strings.Replace(cleaned, ",", ".", 1)
	} else if lastDot > lastComma {
		// US format: 1,234.56 -> just remove commas
		cleaned = strings.ReplaceAll(cleaned, ",", "")
	}

	parsed, err := strconv.ParseFloat(cleaned, 64)
	if err != nil {
		return 0, err
	}

	// Debug logging
	if parsed <= 0 {
		log.Debug().
			Str("raw", value).
			Str("cleaned", cleaned).
			Float64("parsed", parsed).
			Msg("parsePrice")
	}

	// Convert to cents
	return int(math.Round(parsed * 100)), nil
}

// parseDate parses a date string to time.Time
// Supports: YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY, Excel serial date
func parseDate(value string) *time.Time {
	if value == "" {
		return nil
	}

	// Try parsing as float (Excel serial date)
	if serial, err := strconv.ParseFloat(value, 64); err == nil && serial > 0 {
		date := excelDateToGo(serial)
		if date != nil {
			return date
		}
	}

	// Try ISO format (YYYY-MM-DD)
	isoPattern := regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})`)
	if match := isoPattern.FindStringSubmatch(value); len(match) == 4 {
		year, _ := strconv.Atoi(match[1])
		month, _ := strconv.Atoi(match[2])
		day, _ := strconv.Atoi(match[3])
		date := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
		return &date
	}

	// Try European format (DD.MM.YYYY or DD/MM/YYYY)
	euPattern := regexp.MustCompile(`^(\d{1,2})[./](\d{1,2})[./](\d{4})`)
	if match := euPattern.FindStringSubmatch(value); len(match) == 4 {
		day, _ := strconv.Atoi(match[1])
		month, _ := strconv.Atoi(match[2])
		year, _ := strconv.Atoi(match[3])
		date := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
		return &date
	}

	return nil
}

// excelDateToGo converts Excel serial date to Go time.Time
// Excel dates are stored as days since 1900-01-01 (with a bug for 1900 leap year)
func excelDateToGo(serial float64) *time.Time {
	if serial < 1 {
		return nil
	}

	// Excel incorrectly treats 1900 as a leap year
	// Dates after Feb 28, 1900 (serial > 59) need adjustment
	adjustedSerial := serial
	if serial > 59 {
		adjustedSerial = serial - 1
	}

	// Excel epoch is Jan 1, 1900 (but it's actually Dec 31, 1899 due to the bug)
	excelEpoch := time.Date(1899, 12, 31, 0, 0, 0, 0, time.UTC)
	duration := time.Duration(adjustedSerial * 24 * float64(time.Hour))
	date := excelEpoch.Add(duration)

	return &date
}
