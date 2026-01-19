package chains

import (
	"context"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/kosarica/price-service/internal/adapters/base"
	"github.com/kosarica/price-service/internal/adapters/config"
	zipexpand "github.com/kosarica/price-service/internal/ingestion/zip"
	"github.com/kosarica/price-service/internal/parsers/csv"
	"github.com/kosarica/price-service/internal/types"
)

// plodineColumnMapping is the primary column mapping for Plodine CSV files
var plodineColumnMapping = csv.CsvColumnMapping{
	ExternalID:     types.StringPtr("Sifra proizvoda"),
	Name:           "Naziv proizvoda",
	Category:       types.StringPtr("Kategorija proizvoda"),
	Brand:          types.StringPtr("Marka proizvoda"),
	Unit:           types.StringPtr("Jedinica mjere"),
	UnitQuantity:   types.StringPtr("Neto kolicina"),
	Price:          "Maloprodajna cijena",
	DiscountPrice:  types.StringPtr("MPC za vrijeme posebnog oblika prodaje"),
	Barcodes:       types.StringPtr("Barkod"),
	UnitPrice:      types.StringPtr("Cijena po JM"),
	LowestPrice30d: types.StringPtr("Najniza cijena u poslj. 30 dana"),
	// Note: anchorPrice column has dynamic date in name, handled via preprocessing
	AnchorPrice: types.StringPtr("Sidrena cijena"),
}

// plodineColumnMappingAlt is the alternative column mapping for Plodine CSV files
var plodineColumnMappingAlt = csv.CsvColumnMapping{
	ExternalID:          types.StringPtr("Šifra"),
	Name:                "Naziv",
	Category:            types.StringPtr("Kategorija"),
	Brand:               types.StringPtr("Marka"),
	Unit:                types.StringPtr("Mjerna jedinica"),
	UnitQuantity:        types.StringPtr("Količina"),
	Price:               "Cijena",
	DiscountPrice:       types.StringPtr("Akcijska cijena"),
	DiscountStart:       types.StringPtr("Početak akcije"),
	DiscountEnd:         types.StringPtr("Kraj akcije"),
	Barcodes:            types.StringPtr("Barkod"),
	UnitPrice:           types.StringPtr("Cijena za jedinicu mjere"),
	LowestPrice30d:      types.StringPtr("Najniža cijena u zadnjih 30 dana"),
	AnchorPrice:         types.StringPtr("Sidrena cijena"),
	UnitPriceBaseQuantity: types.StringPtr("Količina za jedinicu mjere"),
	UnitPriceBaseUnit:   types.StringPtr("Jedinica mjere za cijenu"),
	AnchorPriceAsOf:     types.StringPtr("Datum sidrene cijene"),
}

// PlodineAdapter is the chain adapter for Plodine retail chain
type PlodineAdapter struct {
	*base.BaseCsvAdapter
	discoveryDate string // Date filter for discovery (YYYY-MM-DD format)
}

// NewPlodineAdapter creates a new Plodine adapter
func NewPlodineAdapter() (*PlodineAdapter, error) {
	chainConfig := config.ChainConfigs[config.ChainPlodine]

	adapterConfig := base.CsvAdapterConfig{
		BaseAdapterConfig: base.BaseAdapterConfig{
			Slug:           string(config.ChainPlodine),
			Name:           chainConfig.Name,
			SupportedTypes: []types.FileType{types.FileTypeCSV, types.FileTypeZIP},
			ChainConfig:    chainConfig,
			FilenamePrefixPatterns: []string{
				`(?i)^Plodine[_-]?`,
				`(?i)^cjenik[_-]?`,
				`(?i)^cjenici[_-]?`,
			},
			FileExtensionPattern: regexp.MustCompile(`\.(csv|CSV|zip|ZIP)$`),
		},
		ColumnMapping:            plodineColumnMapping,
		AlternativeColumnMapping: &plodineColumnMappingAlt,
	}

	baseAdapter, err := base.NewBaseCsvAdapter(adapterConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create base CSV adapter: %w", err)
	}

	return &PlodineAdapter{
		BaseCsvAdapter: baseAdapter,
	}, nil
}

// SetDiscoveryDate sets the date to use for discovery filtering
func (a *PlodineAdapter) SetDiscoveryDate(date string) {
	a.discoveryDate = date
}

// Discover discovers available Plodine price files from the portal
// Plodine provides ZIP archives containing CSV files for each store
func (a *PlodineAdapter) Discover(targetDate string) ([]types.DiscoveredFile, error) {
	discoveredFiles := make([]types.DiscoveredFile, 0)
	seenURLs := make(map[string]bool)

	// Use provided date or default to today
	date := targetDate
	if date == "" {
		date = a.discoveryDate
	}
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}

	// Convert YYYY-MM-DD to DD_MM_YYYY format used in Plodine filenames
	parts := strings.Split(date, "-")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid date format: %s (expected YYYY-MM-DD)", date)
	}
	targetDatePattern := fmt.Sprintf("%s_%s_%s", parts[2], parts[1], parts[0])

	fmt.Printf("[DEBUG] Fetching Plodine page: %s\n", a.BaseURL())
	fmt.Printf("[DEBUG] Looking for date pattern: %s\n", targetDatePattern)

	resp, err := a.HTTPClient().Get(a.BaseURL())
	if err != nil {
		fmt.Printf("[ERROR] Failed to fetch Plodine portal: %v\n", err)
		return nil, fmt.Errorf("failed to fetch Plodine portal: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		fmt.Printf("[ERROR] Plodine portal returned status %d\n", resp.StatusCode)
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	html := string(bodyBytes)

	// Try multiple patterns to find ZIP files
	patterns := []*regexp.Regexp{
		// Primary: /cjenici/ path with full timestamp
		regexp.MustCompile(`href=["'(https://[^"']*\/cjenici\/cjeniki_(\d{2}_\d{2}_\d{4})_\d{2}_\d{2}_\d{2}\.zip)["']`),
		// Alternative: any path with cjenici_ prefix
		regexp.MustCompile(`href=["'](https://[^"']*\/cjenici_(\d{2}_\d{2}_\d{4})_\d{2}_\d{2}_\d{2}\.zip)["']`),
		// Relative URLs
		regexp.MustCompile(`href["']([^"']*cjenici_(\d{2}_\d{2}_\d{4})_\d{2}_\d{2}_\d{2}\.zip)["']`),
	}

	for _, zipPattern := range patterns {
		matches := zipPattern.FindAllStringSubmatch(html, -1)
		for _, match := range matches {
			if len(match) < 3 {
				continue
			}

			var fileURL, fileDatePattern string
			if strings.HasPrefix(match[1], "http") {
				fileURL = match[1]
				fileDatePattern = match[2]
			} else {
				fileURL = "https://www.plodine.hr" + match[1]
				fileDatePattern = match[2]
			}

			// Filter by target date
			if fileDatePattern != targetDatePattern {
				continue
			}

			// Skip duplicates
			if seenURLs[fileURL] {
				continue
			}
			seenURLs[fileURL] = true

			filename := fileURL[strings.LastIndex(fileURL, "/")+1:]

			lastModified, _ := time.Parse("2006-01-02", date)

			discoveredFiles = append(discoveredFiles, types.DiscoveredFile{
				URL:          fileURL,
				Filename:     filename,
				Type:         types.FileTypeZIP,
				Size:         nil,
				LastModified: types.TimePtr(lastModified),
				Metadata: map[string]string{
					"source":       "plodine_portal",
					"discoveredAt": time.Now().Format(time.RFC3339),
					"portalDate":   date,
					"fileDatePattern": fileDatePattern,
				},
			})
		}

		if len(discoveredFiles) > 0 {
			break
		}
	}

	if len(discoveredFiles) == 0 {
		fmt.Printf("[DEBUG] No ZIP files found for date %s\n", date)
	} else {
		fmt.Printf("[DEBUG] Found %d file(s) for date %s\n", len(discoveredFiles), date)
	}

	return discoveredFiles, nil
}

// ExpandZIP expands a ZIP file and returns the extracted CSV files
func (a *PlodineAdapter) ExpandZIP(ctx context.Context, content []byte, filename string) ([]zipexpand.ExpandedFile, error) {
	// Preprocess ZIP content: first expand to find CSV files, then preprocess each
	expanded, err := zipexpand.ExpandInMemory(content, filename)
	if err != nil {
		return nil, fmt.Errorf("failed to expand ZIP: %w", err)
	}

	// Preprocess each CSV file to fix price formatting
	for i := range expanded {
		if expanded[i].Type == types.FileTypeCSV {
			expanded[i].Content = a.preprocessCSVContent(expanded[i].Content)
		}
	}

	return expanded, nil
}

// preprocessCSVContent preprocesses CSV content to fix Plodine-specific formatting issues
// - Handles missing leading zeros in decimal values (e.g., ",69" -> "0,69")
// - Normalizes dynamic column names (e.g., "Sidrena cijena na 2.5.2025" -> "Sidrena cijena")
func (a *PlodineAdapter) preprocessCSVContent(content []byte) []byte {
	text := string(content)

	// Normalize anchor price column header (remove the dynamic date suffix)
	// "Sidrena cijena na 2.5.2025" -> "Sidrena cijena"
	text = regexp.MustCompile(`Sidrena cijena na \d+\.\d+\.\d+`).ReplaceAllString(text, "Sidrena cijena")

	// Fix missing leading zeros in prices
	// Pattern matches: semicolon followed by comma and digits (;,69) -> ;0,69
	text = regexp.MustCompile(`;,(\d)`).ReplaceAllString(text, ";0,$1")

	// Also handle case where value might be at start or in quotes
	text = regexp.MustCompile(`^,(\d)`).ReplaceAllString(text, "0,$1")
	text = regexp.MustCompile(`",(\d)`).ReplaceAllString(text, `"0,$1`)

	return []byte(text)
}

// Parse parses CSV content with Plodine-specific preprocessing
func (a *PlodineAdapter) Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error) {
	// Preprocess content to fix formatting issues
	preprocessed := a.preprocessCSVContent(content)

	// Use base adapter's Parse method with preprocessed content
	return a.BaseCsvAdapter.Parse(preprocessed, filename, options)
}

// ExtractStoreMetadata extracts store metadata from Plodine filename
// Pattern: {type}_{address...}_{postal}_{city}_{storeId}_{seq}_{date}.csv
func (a *PlodineAdapter) ExtractStoreMetadata(file types.DiscoveredFile) *types.StoreMetadata {
	baseName := regexp.MustCompile(`\.(csv|CSV)$`).ReplaceAllString(file.Filename, "")
	parts := strings.Split(baseName, "_")
	if len(parts) < 6 {
		storeID := a.ExtractStoreIdentifierFromFilename(file.Filename)
		return &types.StoreMetadata{
			Name: fmt.Sprintf("%s %s", a.Name(), storeID),
		}
	}

	storeType := parts[0]

	// Find postal code (5 digits) working from index 1
	postalIdx := -1
	for i := 1; i < len(parts)-3; i++ {
		if regexp.MustCompile(`^\d{5}$`).MatchString(parts[i]) {
			postalIdx = i
			break
		}
	}

	if postalIdx == -1 {
		storeID := a.ExtractStoreIdentifierFromFilename(file.Filename)
		return &types.StoreMetadata{
			Name: fmt.Sprintf("%s %s", a.Name(), storeID),
		}
	}

	address := strings.Join(parts[1:postalIdx], " ")
	postalCode := parts[postalIdx]
	city := ""
	if postalIdx+1 < len(parts) {
		city = parts[postalIdx+1]
	}

	return &types.StoreMetadata{
		Name:       fmt.Sprintf("Plodine %s", titleCase(city)),
		Address:    titleCase(address),
		City:       titleCase(city),
		PostalCode: postalCode,
		StoreType:  titleCase(storeType),
	}
}

// ExtractStoreIdentifierFromFilename extracts store identifier from Plodine filename
func (a *PlodineAdapter) ExtractStoreIdentifierFromFilename(filename string) string {
	baseName := regexp.MustCompile(`\.(csv|CSV)$`).ReplaceAllString(filename, "")
	parts := strings.Split(baseName, "_")
	if len(parts) >= 6 {
		// Store ID is typically the 5th element (index 5)
		// Pattern: {type}_{address...}_{postal}_{city}_{storeId}_{seq}_{date}
		return parts[5]
	}

	// Fallback to base class method
	dummyFile := types.DiscoveredFile{Filename: filename}
	if id := a.ExtractStoreIdentifier(dummyFile); id != nil {
		return id.Value
	}
	return ""
}

// UsesZIP returns true as Plodine uses ZIP files
func (a *PlodineAdapter) UsesZIP() bool {
	return true
}
