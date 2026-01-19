package chains

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/kosarica/price-service/internal/adapters/base"
	"github.com/kosarica/price-service/internal/adapters/config"
	zipexpand "github.com/kosarica/price-service/internal/ingestion/zip"
	"github.com/kosarica/price-service/internal/parsers/csv"
	"github.com/kosarica/price-service/internal/types"
)

// eurospinColumnMapping is the primary column mapping for Eurospin CSV files
var eurospinColumnMapping = csv.CsvColumnMapping{
	ExternalID:          types.StringPtr("ŠIFRA_PROIZVODA"),
	Name:                "NAZIV_PROIZVODA",
	Category:            types.StringPtr("KATEGORIJA_PROIZVODA"),
	Brand:               types.StringPtr("MARKA_PROIZVODA"),
	Unit:                types.StringPtr("JEDINICA_MJERE"),
	UnitQuantity:        types.StringPtr("NETO_KOLIČINA"),
	Price:               "MALOPROD.CIJENA(EUR)",
	DiscountPrice:       types.StringPtr("MPC_POSEB.OBLIK_PROD"),
	DiscountStart:       types.StringPtr("POČETAK_AKCIJE"),
	DiscountEnd:         types.StringPtr("KRAJ_AKCIJE"),
	Barcodes:            types.StringPtr("BARKOD"),
	UnitPrice:           types.StringPtr("CIJENA_ZA_JEDINICU_MJERE"),
	LowestPrice30d:      types.StringPtr("NAJNIŽA_MPC_U_30DANA"),
	AnchorPrice:         types.StringPtr("SIDRENA_CIJENA"),
	UnitPriceBaseQuantity: types.StringPtr("KOLIČINA_ZA_JEDINICU_MJERE"),
	UnitPriceBaseUnit:   types.StringPtr("JEDINICA_MJERE_ZA_CIJENU"),
	AnchorPriceAsOf:     types.StringPtr("DATUM_SIDRENE_CIJENE"),
}

// eurospinColumnMappingAlt is the alternative column mapping for Eurospin CSV files
var eurospinColumnMappingAlt = csv.CsvColumnMapping{
	ExternalID:          types.StringPtr("SIFRA_PROIZVODA"),
	Name:                "NAZIV_PROIZVODA",
	Category:            types.StringPtr("KATEGORIJA"),
	Brand:               types.StringPtr("MARKA"),
	Unit:                types.StringPtr("JM"),
	UnitQuantity:        types.StringPtr("NETO_KOLICINA"),
	Price:               "MALOPROD_CIJENA",
	DiscountPrice:       types.StringPtr("MPC_POSEB_OBLIK_PROD"),
	DiscountStart:       types.StringPtr("Pocetak_akcije"),
	DiscountEnd:         types.StringPtr("Kraj_akcije"),
	Barcodes:            types.StringPtr("BARKOD"),
	UnitPrice:           types.StringPtr("CIJENA_ZA_JEDINICU_MJERE"),
	LowestPrice30d:      types.StringPtr("NAJNIZA_MPC_U_30DANA"),
	AnchorPrice:         types.StringPtr("SIDRENA_CIJENA"),
	UnitPriceBaseQuantity: types.StringPtr("KOLICINA_ZA_JM"),
	UnitPriceBaseUnit:   types.StringPtr("JM_ZA_CIJENU"),
	AnchorPriceAsOf:     types.StringPtr("DATUM_SIDRENE_CIJENE"),
}

// EurospinAdapter is the chain adapter for Eurospin retail chain
type EurospinAdapter struct {
	*base.BaseCsvAdapter
	discoveryDate string // Date filter for discovery (YYYY-MM-DD format)
}

// NewEurospinAdapter creates a new Eurospin adapter
func NewEurospinAdapter() (*EurospinAdapter, error) {
	chainConfig := config.ChainConfigs[config.ChainEurospin]

	adapterConfig := base.CsvAdapterConfig{
		BaseAdapterConfig: base.BaseAdapterConfig{
			Slug:           string(config.ChainEurospin),
			Name:           chainConfig.Name,
			SupportedTypes: []types.FileType{types.FileTypeCSV, types.FileTypeZIP},
			ChainConfig:    chainConfig,
			FilenamePrefixPatterns: []string{
				`(?i)^Eurospin[_-]?`,
				`(?i)^cjenik[_-]?`,
				`(?i)^diskontna[_-]?`,
			},
			FileExtensionPattern: regexp.MustCompile(`\.(csv|CSV|zip|ZIP)$`),
		},
		ColumnMapping:            eurospinColumnMapping,
		AlternativeColumnMapping: &eurospinColumnMappingAlt,
	}

	baseAdapter, err := base.NewBaseCsvAdapter(adapterConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create base CSV adapter: %w", err)
	}

	return &EurospinAdapter{
		BaseCsvAdapter: baseAdapter,
	}, nil
}

// SetDiscoveryDate sets the date to use for discovery filtering
func (a *EurospinAdapter) SetDiscoveryDate(date string) {
	a.discoveryDate = date
}

// Discover discovers available Eurospin price files from the portal
// Eurospin provides ZIP files in a dropdown: cjenik_DD.MM.YYYY-7.30.zip
func (a *EurospinAdapter) Discover(targetDate string) ([]types.DiscoveredFile, error) {
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

	fmt.Printf("[DEBUG] Fetching Eurospin portal for date: %s\n", date)
	fmt.Printf("[DEBUG] URL: %s\n", a.BaseURL())

	resp, err := a.HTTPClient().Get(a.BaseURL())
	if err != nil {
		fmt.Printf("[ERROR] Failed to fetch Eurospin portal: %v\n", err)
		return nil, fmt.Errorf("failed to fetch Eurospin portal: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		fmt.Printf("[ERROR] Eurospin portal returned status %d\n", resp.StatusCode)
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	html := string(bodyBytes)

	// Extract download links from dropdown: <option value="URL">filename</option>
	optionPattern := regexp.MustCompile(`(?i)<option[^>]*value=["']([^"']*cjenik_[^"']*\.zip)["'][^>]*>([^<]*)</option>`)

	matches := optionPattern.FindAllStringSubmatch(html, -1)
	for _, match := range matches {
		if len(match) < 3 {
			continue
		}

		rawURL := match[1]
		filename := strings.TrimSpace(match[2])

		// Resolve URL (may be relative)
		fileURL := a.resolveURL(rawURL)

		// Skip duplicates
		if seenURLs[fileURL] {
			continue
		}
		seenURLs[fileURL] = true

		// If filename from option is empty, extract from URL
		if filename == "" {
			filename = a.extractFilenameFromURL(fileURL)
		}

		// Extract date from filename (format: cjenik_DD.MM.YYYY-7.30.zip)
		fileDate := a.extractDateFromFilename(filename)

		// Filter by discovery date if set
		if date != "" && fileDate != "" && fileDate != date {
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
				"source":       "eurospin_portal",
				"discoveredAt": time.Now().Format(time.RFC3339),
				"portalDate":   fileDate,
			},
		})
	}

	fmt.Printf("[DEBUG] Found %d file(s) for date %s\n", len(discoveredFiles), date)
	return discoveredFiles, nil
}

// resolveURL resolves a potentially relative URL against the base URL
func (a *EurospinAdapter) resolveURL(href string) string {
	if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
		return href
	}

	baseURL := a.BaseURL()
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return href
	}

	if strings.HasPrefix(href, "/") {
		return parsed.Scheme + "://" + parsed.Host + href
	}

	return baseURL + "/" + href
}

// extractFilenameFromURL extracts filename from URL
func (a *EurospinAdapter) extractFilenameFromURL(fileURL string) string {
	parsed, err := url.Parse(fileURL)
	if err != nil {
		return fileURL
	}

	path := parsed.Path
	parts := strings.Split(path, "/")
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}

	return fileURL
}

// extractDateFromFilename extracts date from Eurospin filename
// Format: cjenik_DD.MM.YYYY-7.30.zip -> YYYY-MM-DD
func (a *EurospinAdapter) extractDateFromFilename(filename string) string {
	match := regexp.MustCompile(`cjenik_(\d{2})\.(\d{2})\.(\d{4})`).FindStringSubmatch(filename)
	if len(match) >= 4 {
		day := match[1]
		month := match[2]
		year := match[3]
		return fmt.Sprintf("%s-%s-%s", year, month, day)
	}
	return ""
}

// ExpandZIP expands a ZIP file and returns the extracted CSV files
func (a *EurospinAdapter) ExpandZIP(ctx context.Context, content []byte, filename string) ([]zipexpand.ExpandedFile, error) {
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

	fmt.Printf("[DEBUG] Expanded %d CSV files from ZIP %s\n", len(csvFiles), filename)
	return csvFiles, nil
}

// ExtractStoreMetadata extracts store metadata from Eurospin filename
// Pattern: {type}-{storeId}-{address}-{city}-{postal}-{code}-{date}-{time}.csv
func (a *EurospinAdapter) ExtractStoreMetadata(file types.DiscoveredFile) *types.StoreMetadata {
	baseName := regexp.MustCompile(`\.(csv|CSV)$`).ReplaceAllString(file.Filename, "")
	parts := strings.Split(baseName, "-")
	if len(parts) < 5 {
		storeID := a.ExtractStoreIdentifierFromFilename(file.Filename)
		return &types.StoreMetadata{
			Name: fmt.Sprintf("%s %s", a.Name(), storeID),
		}
	}

	storeType := strings.ReplaceAll(parts[0], "_", " ")
	address := ""
	if len(parts) > 2 {
		address = strings.ReplaceAll(parts[2], "_", " ")
	}

	city := ""
	if len(parts) > 3 {
		city = parts[3]
	}

	postalCode := ""
	if len(parts) > 4 {
		postalCode = parts[4]
	}

	return &types.StoreMetadata{
		Name:       fmt.Sprintf("Eurospin %s", titleCase(city)),
		Address:    titleCase(address),
		City:       titleCase(city),
		PostalCode: postalCode,
		StoreType:  titleCase(storeType),
	}
}

// ExtractStoreIdentifierFromFilename extracts store identifier from Eurospin filename
func (a *EurospinAdapter) ExtractStoreIdentifierFromFilename(filename string) string {
	baseName := regexp.MustCompile(`\.(csv|CSV)$`).ReplaceAllString(filename, "")
	parts := strings.Split(baseName, "-")
	if len(parts) >= 2 {
		return parts[1]
	}

	dummyFile := types.DiscoveredFile{Filename: filename}
	if id := a.ExtractStoreIdentifier(dummyFile); id != nil {
		return id.Value
	}
	return ""
}

// UsesZIP returns true as Eurospin uses ZIP files
func (a *EurospinAdapter) UsesZIP() bool {
	return true
}
