package chains

import (
	"context"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/kosarica/price-service/internal/adapters/base"
	"github.com/kosarica/price-service/internal/adapters/config"
	zipexpand "github.com/kosarica/price-service/internal/ingestion/zip"
	"github.com/kosarica/price-service/internal/parsers/csv"
	"github.com/kosarica/price-service/internal/types"
)

// lidlColumnMapping is the primary column mapping for Lidl CSV files (2026 format)
// Maps Lidl's Croatian column names to NormalizedRow fields
var lidlColumnMapping = csv.CsvColumnMapping{
	ExternalID:     types.StringPtr("ŠIFRA"),
	Name:           "NAZIV",
	Category:       types.StringPtr("KATEGORIJA_PROIZVODA"),
	Brand:          types.StringPtr("MARKA"),
	Unit:           types.StringPtr("JEDINICA_MJERE"),
	UnitQuantity:   types.StringPtr("NETO_KOLIČINA"),
	Price:          "MALOPRODAJNA_CIJENA",
	DiscountPrice:  types.StringPtr("MPC_ZA_VRIJEME_POSEBNOG_OBLIKA_PRODAJE"),
	Barcodes:       types.StringPtr("BARKOD"),
	UnitPrice:      types.StringPtr("CIJENA_ZA_JEDINICU_MJERE"),
	LowestPrice30d: types.StringPtr("NAJNIZA_CIJENA_U_POSLJ._30_DANA"),
	AnchorPrice:    types.StringPtr("Sidrena_cijena_na_dan"),
}

// lidlColumnMappingAlt is the alternative column mapping for Lidl CSV files (legacy format)
var lidlColumnMappingAlt = csv.CsvColumnMapping{
	ExternalID:    types.StringPtr("Artikl"),
	Name:          "Naziv artikla",
	Category:      types.StringPtr("Kategorija"),
	Brand:         types.StringPtr("Robna marka"),
	Unit:          types.StringPtr("Jedinica mjere"),
	UnitQuantity:  types.StringPtr("Količina"),
	Price:         "Cijena",
	DiscountPrice: types.StringPtr("Akcijska cijena"),
	DiscountStart: types.StringPtr("Početak akcije"),
	DiscountEnd:   types.StringPtr("Završetak akcije"),
	Barcodes:      types.StringPtr("GTIN"),
}

// LidlAdapter is the chain adapter for Lidl retail chain
type LidlAdapter struct {
	*base.BaseCsvAdapter
	discoveryDate string // Optional date filter for discovery (YYYY-MM-DD)
}

// NewLidlAdapter creates a new Lidl adapter
func NewLidlAdapter() (*LidlAdapter, error) {
	chainConfig := config.ChainConfigs[config.ChainLidl]

	adapterConfig := base.CsvAdapterConfig{
		BaseAdapterConfig: base.BaseAdapterConfig{
			Slug:           string(config.ChainLidl),
			Name:           chainConfig.Name,
			SupportedTypes: []types.FileType{types.FileTypeCSV, types.FileTypeZIP},
			ChainConfig:    chainConfig,
			FilenamePrefixPatterns: []string{
				`(?i)^Lidl[_-]?`,
				`(?i)^Popis_cijena[_-]?`,
				`(?i)^cjenik[_-]?`,
				`^\d{4}[_-]\d{2}[_-]\d{2}[_-]?`, // Remove date prefix
			},
			FileExtensionPattern: regexp.MustCompile(`\.(csv|CSV|zip|ZIP)$`),
		},
		ColumnMapping:            lidlColumnMapping,
		AlternativeColumnMapping: &lidlColumnMappingAlt,
	}

	baseAdapter, err := base.NewBaseCsvAdapter(adapterConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create base CSV adapter: %w", err)
	}

	return &LidlAdapter{
		BaseCsvAdapter: baseAdapter,
	}, nil
}

// SetDiscoveryDate sets the date to use for discovery filtering
func (a *LidlAdapter) SetDiscoveryDate(date string) {
	a.discoveryDate = date
}

// Discover discovers available price files from Lidl portal
// Lidl uses dynamic download IDs that must be parsed from HTML:
// URL pattern: https://tvrtka.lidl.hr/content/download/[ID]/fileupload/Popis_cijena_po_trgovinama_na_dan_DD_MM_YYYY.zip
func (a *LidlAdapter) Discover(targetDate string) ([]types.DiscoveredFile, error) {
	discoveredFiles := make([]types.DiscoveredFile, 0)
	seenURLs := make(map[string]bool)

	// Use provided targetDate or the pre-set discoveryDate
	filterDate := targetDate
	if filterDate == "" {
		filterDate = a.discoveryDate
	}

	log.Debug().Str("url", a.BaseURL()).Msg("Fetching Lidl portal")

	resp, err := a.HTTPClient().Get(a.BaseURL())
	if err != nil {
		log.Error().Err(err).Msg("Failed to fetch Lidl portal")
		return nil, fmt.Errorf("failed to fetch Lidl portal: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		log.Error().Int("status_code", resp.StatusCode).Msg("Lidl portal returned error status")
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	html := string(bodyBytes)

	// Extract download links matching Lidl's URL pattern
	// Pattern: href="(https://tvrtka.lidl.hr/content/download/\d+/fileupload/[^"]+\.zip)"
	downloadPattern := regexp.MustCompile(`href=["'](https://tvrtka\.lidl\.hr/content/download/\d+/fileupload/([^"']+\.zip))["']`)

	matches := downloadPattern.FindAllStringSubmatch(html, -1)
	for _, match := range matches {
		if len(match) < 3 {
			continue
		}

		fileURL := match[1]
		filename := match[2]

		// Skip duplicates
		if seenURLs[fileURL] {
			continue
		}
		seenURLs[fileURL] = true

		// Extract date from filename
		fileDate := a.extractDateFromFilename(filename)

		// Filter by date if specified
		if filterDate != "" && fileDate != filterDate {
			continue
		}

		var lastModified *time.Time
		if fileDate != "" {
			if t, err := time.Parse("2006-01-02", fileDate); err == nil {
				lastModified = &t
			}
		}

		discoveredFiles = append(discoveredFiles, types.DiscoveredFile{
			URL:          fileURL,
			Filename:     filename,
			Type:         types.FileTypeZIP,
			Size:         nil,
			LastModified: lastModified,
			Metadata: map[string]string{
				"source":       "lidl_portal",
				"discoveredAt": time.Now().Format(time.RFC3339),
				"portalDate":   fileDate,
			},
		})
	}

	// If no files found with absolute URLs, try relative URL pattern
	if len(discoveredFiles) == 0 {
		relativePattern := regexp.MustCompile(`href=["'](/content/download/\d+/fileupload/([^"']+\.zip))["']`)

		matches = relativePattern.FindAllStringSubmatch(html, -1)
		for _, match := range matches {
			if len(match) < 3 {
				continue
			}

			href := match[1]
			filename := match[2]

			// Build full URL
			fileURL := "https://tvrtka.lidl.hr" + href

			if seenURLs[fileURL] {
				continue
			}
			seenURLs[fileURL] = true

			fileDate := a.extractDateFromFilename(filename)

			if filterDate != "" && fileDate != filterDate {
				continue
			}

			var lastModified *time.Time
			if fileDate != "" {
				if t, err := time.Parse("2006-01-02", fileDate); err == nil {
					lastModified = &t
				}
			}

			discoveredFiles = append(discoveredFiles, types.DiscoveredFile{
				URL:          fileURL,
				Filename:     filename,
				Type:         types.FileTypeZIP,
				Size:         nil,
				LastModified: lastModified,
				Metadata: map[string]string{
					"source":       "lidl_portal",
					"discoveredAt": time.Now().Format(time.RFC3339),
					"portalDate":   fileDate,
				},
			})
		}
	}

	log.Debug().Int("file_count", len(discoveredFiles)).Msg("Discovered files from Lidl portal")
	return discoveredFiles, nil
}

// extractDateFromFilename extracts date from Lidl filename (DD_MM_YYYY) to YYYY-MM-DD format
func (a *LidlAdapter) extractDateFromFilename(filename string) string {
	// Pattern: Popis_cijena_po_trgovinama_na_dan_DD_MM_YYYY.zip
	match := regexp.MustCompile(`(\d{2})_(\d{2})_(\d{4})\.zip$`).FindStringSubmatch(filename)
	if len(match) >= 4 {
		day := match[1]
		month := match[2]
		year := match[3]
		return fmt.Sprintf("%s-%s-%s", year, month, day)
	}
	return ""
}

// ExpandZIP expands a ZIP file and returns the extracted CSV files
func (a *LidlAdapter) ExpandZIP(ctx context.Context, content []byte, filename string) ([]zipexpand.ExpandedFile, error) {
	expanded, err := zipexpand.ExpandInMemory(content, filename)
	if err != nil {
		return nil, fmt.Errorf("failed to expand ZIP: %w", err)
	}

	// Filter to only CSV files
	csvFiles := make([]zipexpand.ExpandedFile, 0, len(expanded))
	for _, file := range expanded {
		if file.Type == types.FileTypeCSV {
			csvFiles = append(csvFiles, file)
		}
	}

	log.Debug().Int("csv_count", len(csvFiles)).Str("filename", filename).Msg("Expanded CSV files from ZIP")
	return csvFiles, nil
}

// Parse parses CSV content with multiple GTIN handling
func (a *LidlAdapter) Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error) {
	// Use base adapter's Parse method
	result, err := a.BaseCsvAdapter.Parse(content, filename, options)
	if err != nil {
		return nil, err
	}

	// Post-process to handle multiple GTINs
	result = a.postprocessMultipleGTINs(result)

	return result, nil
}

// postprocessMultipleGTINs handles Lidl's multiple GTINs in barcode field
// Lidl may list multiple GTINs separated by semicolon or pipe
func (a *LidlAdapter) postprocessMultipleGTINs(result *types.ParseResult) *types.ParseResult {
	for i := range result.Rows {
		row := &result.Rows[i]
		if len(row.Barcodes) == 1 {
			barcode := row.Barcodes[0]
			// Check if single barcode contains multiple GTINs
			if strings.Contains(barcode, ";") || strings.Contains(barcode, "|") {
				gtins := splitGTINs(barcode)
				row.Barcodes = gtins
			}
		}
	}
	return result
}

// splitGTINs splits a barcode string containing multiple GTINs
func splitGTINs(barcode string) []string {
	// Split on semicolon or pipe
	parts := regexp.MustCompile(`[;|]`).Split(barcode, -1)

	gtins := make([]string, 0, len(parts))
	for _, part := range parts {
		gtin := strings.TrimSpace(part)
		if gtin != "" {
			gtins = append(gtins, gtin)
		}
	}

	return gtins
}

// ExtractStoreIdentifierFromFilename extracts store identifier from Lidl filename
// Lidl has special patterns for store identification
func (a *LidlAdapter) ExtractStoreIdentifierFromFilename(filename string) string {
	// Remove file extension
	baseName := regexp.MustCompile(`\.(csv|CSV)$`).ReplaceAllString(filename, "")

	// Pattern 1: Lidl_DATE_STOREID (e.g., "Lidl_2024-01-15_42")
	dateStoreMatch := regexp.MustCompile(`(?i)^Lidl[_-]?\d{4}[_-]\d{2}[_-]\d{2}[_-](.+)$`).FindStringSubmatch(baseName)
	if len(dateStoreMatch) >= 2 {
		return dateStoreMatch[1]
	}

	// Pattern 2: Lidl_Poslovnica_LOCATION (e.g., "Lidl_Poslovnica_Zagreb_Ilica_123")
	locationMatch := regexp.MustCompile(`(?i)^Lidl[_-]?Poslovnica[_-]?(.+)$`).FindStringSubmatch(baseName)
	if len(locationMatch) >= 2 {
		return locationMatch[1]
	}

	// Pattern 3: Just Lidl_STOREID (e.g., "Lidl_42")
	simpleMatch := regexp.MustCompile(`(?i)^Lidl[_-]?(\d+)$`).FindStringSubmatch(baseName)
	if len(simpleMatch) >= 2 {
		return simpleMatch[1]
	}

	// Pattern 4: Supermarket 265_Address_... format
	// Example: "Supermarket 265_Ulica Franje Glada_13_40323_Prelog_1_16.12.2025_7.15h.csv"
	parts := strings.Split(baseName, "_")
	if len(parts) > 0 {
		firstPart := strings.Split(parts[0], " ")
		if len(firstPart) >= 2 {
			// Return store type + ID (e.g., "Supermarket 265")
			return parts[0]
		}
	}

	// Fall back: use base adapter method via creating a dummy file
	dummyFile := types.DiscoveredFile{Filename: filename}
	if id := a.ExtractStoreIdentifier(dummyFile); id != nil {
		return id.Value
	}

	return ""
}

// ValidateRow validates a normalized row with Lidl-specific GTIN validation
func (a *LidlAdapter) ValidateRow(row types.NormalizedRow) types.NormalizedRowValidation {
	// Get base validation
	baseValidation := a.BaseCsvAdapter.ValidateRow(row)

	// Build warnings list without generic barcode warnings
	warnings := make([]string, 0)
	for _, w := range baseValidation.Warnings {
		if !strings.Contains(w, "Invalid barcode format") {
			warnings = append(warnings, w)
		}
	}

	// Add Lidl-specific GTIN validation
	for _, barcode := range row.Barcodes {
		if !isValidGTIN(barcode) {
			warnings = append(warnings, fmt.Sprintf("Invalid GTIN format: %s (expected EAN-8, EAN-13, or GTIN-14)", barcode))
		}
	}

	// Lidl products should typically have at least one GTIN
	if len(row.Barcodes) == 0 {
		warnings = append(warnings, "No GTIN/barcode found for product")
	}

	return types.NormalizedRowValidation{
		IsValid:  baseValidation.IsValid,
		Errors:   baseValidation.Errors,
		Warnings: warnings,
	}
}

// isValidGTIN checks if a barcode is a valid GTIN (EAN-8, EAN-13, or GTIN-14)
func isValidGTIN(barcode string) bool {
	// Must be 8, 13, or 14 digits
	if len(barcode) != 8 && len(barcode) != 13 && len(barcode) != 14 {
		return false
	}

	// Must be all digits
	for _, c := range barcode {
		if c < '0' || c > '9' {
			return false
		}
	}

	return true
}

// ExtractStoreMetadata extracts store metadata from Lidl filename for auto-registration
// Parses filename pattern: {type} {storeId}_{address}_{number}_{postal}_{city}_{ver}_{date}_{time}.csv
// Example: Supermarket 265_Ulica Franje Glada_13_40323_Prelog_1_16.12.2025_7.15h.csv
func (a *LidlAdapter) ExtractStoreMetadata(file types.DiscoveredFile) *types.StoreMetadata {
	// Remove extension
	baseName := regexp.MustCompile(`\.(csv|CSV)$`).ReplaceAllString(file.Filename, "")

	// Split by underscore
	parts := strings.Split(baseName, "_")
	if len(parts) < 6 {
		// Fall back to base implementation
		storeID := a.ExtractStoreIdentifierFromFilename(file.Filename)
		return &types.StoreMetadata{
			Name: fmt.Sprintf("Lidl %s", storeID),
		}
	}

	// First part has space: "Supermarket 265"
	firstPart := strings.Split(parts[0], " ")
	storeType := ""
	if len(firstPart) >= 1 {
		storeType = firstPart[0]
	}

	// Find postal code (5 digits) to anchor the structure
	postalIdx := -1
	for i := 1; i < len(parts)-2; i++ {
		if regexp.MustCompile(`^\d{5}$`).MatchString(parts[i]) {
			postalIdx = i
			break
		}
	}

	if postalIdx == -1 {
		storeID := a.ExtractStoreIdentifierFromFilename(file.Filename)
		return &types.StoreMetadata{
			Name: fmt.Sprintf("Lidl %s", storeID),
		}
	}

	// Address is from index 1 to postalIdx-1
	addressParts := parts[1:postalIdx]
	address := strings.Join(addressParts, " ")
	postalCode := parts[postalIdx]
	city := ""
	if postalIdx+1 < len(parts) {
		city = parts[postalIdx+1]
	}

	return &types.StoreMetadata{
		Name:       fmt.Sprintf("Lidl %s", titleCase(city)),
		Address:    titleCase(address),
		City:       titleCase(city),
		PostalCode: postalCode,
		StoreType:  titleCase(storeType),
	}
}

// titleCase converts string to title case
func titleCase(s string) string {
	words := strings.Fields(strings.ToLower(s))
	for i, word := range words {
		if len(word) > 0 {
			words[i] = strings.ToUpper(string(word[0])) + word[1:]
		}
	}
	return strings.Join(words, " ")
}

// UsesZIP returns true as Lidl uses ZIP files
func (a *LidlAdapter) UsesZIP() bool {
	return true
}
