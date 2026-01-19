package chains

import (
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/kosarica/price-service/internal/adapters/base"
	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/parsers/csv"
	"github.com/kosarica/price-service/internal/types"
)

// konzumColumnMapping is the primary column mapping for Konzum CSV files (Croatian headers)
var konzumColumnMapping = csv.CsvColumnMapping{
	ExternalID:          types.StringPtr("ŠIFRA PROIZVODA"),
	Name:                "NAZIV PROIZVODA",
	Category:            types.StringPtr("KATEGORIJA PROIZVODA"),
	Brand:               types.StringPtr("MARKA PROIZVODA"),
	Unit:                types.StringPtr("JEDINICA MJERE"),
	UnitQuantity:        types.StringPtr("NETO KOLIČINA"),
	Price:               "MALOPRODAJNA CIJENA",
	DiscountPrice:       types.StringPtr("MPC ZA VRIJEME POSEBNOG OBLIKA PRODAJE"),
	Barcodes:            types.StringPtr("BARKOD"),
	UnitPrice:           types.StringPtr("CIJENA ZA JEDINICU MJERE"),
	LowestPrice30d:      types.StringPtr("NAJNIŽA CIJENA U ZADNJIH 30 DANA"),
	AnchorPrice:         types.StringPtr("SIDRENA CIJENA"),
}

// konzumColumnMappingEN is the alternative column mapping for Konzum CSV files (English headers)
var konzumColumnMappingEN = csv.CsvColumnMapping{
	ExternalID:    types.StringPtr("Code"),
	Name:          "Name",
	Category:      types.StringPtr("Category"),
	Brand:         types.StringPtr("Brand"),
	Unit:          types.StringPtr("Unit"),
	UnitQuantity:  types.StringPtr("Quantity"),
	Price:         "Price",
	DiscountPrice: types.StringPtr("Discount Price"),
	DiscountStart: types.StringPtr("Discount Start"),
	DiscountEnd:   types.StringPtr("Discount End"),
	Barcodes:      types.StringPtr("Barcode"),
}

// KonzumAdapter is the chain adapter for Konzum retail chain
type KonzumAdapter struct {
	*base.BaseCsvAdapter
}

// NewKonzumAdapter creates a new Konzum adapter
func NewKonzumAdapter() (*KonzumAdapter, error) {
	chainConfig := config.ChainConfigs[config.ChainKonzum]

	adapterConfig := base.CsvAdapterConfig{
		BaseAdapterConfig: base.BaseAdapterConfig{
			Slug:           string(config.ChainKonzum),
			Name:           chainConfig.Name,
			SupportedTypes: []types.FileType{types.FileTypeCSV},
			ChainConfig:    chainConfig,
			FilenamePrefixPatterns: []string{
				`(?i)^Konzum[_-]?`,
				`(?i)^cjenik[_-]?`,
			},
		},
		ColumnMapping:           konzumColumnMapping,
		AlternativeColumnMapping: &konzumColumnMappingEN,
	}

	baseAdapter, err := base.NewBaseCsvAdapter(adapterConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create base CSV adapter: %w", err)
	}

	return &KonzumAdapter{
		BaseCsvAdapter: baseAdapter,
	}, nil
}

// Discover discovers available price files from Konzum portal
// Konzum uses pagination with date query parameter: /cjenici?date=YYYY-MM-DD&page=N
// targetDate should be in YYYY-MM-DD format; if empty, defaults to today
func (a *KonzumAdapter) Discover(targetDate string) ([]types.DiscoveredFile, error) {
	discoveredFiles := make([]types.DiscoveredFile, 0)
	seenURLs := make(map[string]bool)

	// Use provided date or default to today
	date := targetDate
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}

	// Maximum pages to crawl (safety limit)
	maxPages := 50

	for page := 1; page <= maxPages; page++ {
		pageURL := fmt.Sprintf("%s?date=%s&page=%d", a.BaseURL(), date, page)
		fmt.Printf("[DEBUG] Fetching Konzum page %d: %s\n", page, pageURL)

		files, err := a.discoverPage(pageURL, seenURLs, date, page)
		if err != nil {
			fmt.Printf("[ERROR] Failed to fetch page %d: %v\n", page, err)
			break
		}

		if len(files) == 0 {
			// No new files found - end of pagination
			break
		}

		discoveredFiles = append(discoveredFiles, files...)
	}

	return discoveredFiles, nil
}

// discoverPage discovers files from a single page
func (a *KonzumAdapter) discoverPage(pageURL string, seenURLs map[string]bool, date string, page int) ([]types.DiscoveredFile, error) {
	resp, err := a.HTTPClient().Get(pageURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch page: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	body := string(bodyBytes)

	// Extract download links: href="/cjenici/download?title=..."
	downloadPattern := regexp.MustCompile(`href=["'](\/cjenici\/download\?title=([^"'&]+)[^"']*)["']`)

	matches := downloadPattern.FindAllStringSubmatch(body, -1)
	files := make([]types.DiscoveredFile, 0)

	for _, match := range matches {
		if len(match) < 3 {
			continue
		}

		href := match[1]
		encodedFilename := match[2]

		// Build full download URL
		fileURL := a.resolveURL(href)

		// Skip duplicates
		if seenURLs[fileURL] {
			continue
		}
		seenURLs[fileURL] = true

		// Decode filename from URL encoding
		filename := a.decodeFilename(encodedFilename)

		// Ensure .csv extension
		if !strings.HasSuffix(strings.ToLower(filename), ".csv") {
			filename = filename + ".csv"
		}

		files = append(files, types.DiscoveredFile{
			URL:      fileURL,
			Filename: filename,
			Type:     types.FileTypeCSV,
			Size:     nil,
			LastModified: types.TimePtr(time.Now()), // Use current time as approximation
			Metadata: map[string]string{
				"source":       "konzum_portal",
				"discoveredAt": time.Now().Format(time.RFC3339),
				"portalDate":   date,
				"page":         fmt.Sprintf("%d", page),
			},
		})
	}

	return files, nil
}

// resolveURL resolves a potentially relative URL against the base URL
func (a *KonzumAdapter) resolveURL(href string) string {
	if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
		return href
	}

	baseURL := a.BaseURL()
	if strings.HasPrefix(href, "/") {
		// Absolute path - need to rebuild from scheme+host
		parts := strings.Split(baseURL, "/")
		if len(parts) >= 3 {
			return parts[0] + "//" + parts[2] + href
		}
	}

	// Relative URL
	return baseURL + "/" + href
}

// decodeFilename decodes a URL-encoded filename
func (a *KonzumAdapter) decodeFilename(encoded string) string {
	// URL decode using standard library
	decoded, err := url.QueryUnescape(encoded)
	if err != nil {
		// Fallback: just replace + with space
		return strings.ReplaceAll(encoded, "+", " ")
	}
	return decoded
}

// ExtractStoreIdentifierFromFilename extracts store identifier from Konzum filename
// Pattern: SUPERMARKET,ADDRESS,POSTAL CITY,STORE_ID,DATE,TIME.CSV
// Store ID is a 4-digit code (e.g., 0204)
func (a *KonzumAdapter) ExtractStoreIdentifierFromFilename(filename string) string {
	// Match 4-digit store code pattern: ,NNNN,
	match := regexp.MustCompile(`,(\d{4}),`).FindStringSubmatch(filename)
	if len(match) >= 2 {
		return match[1]
	}

	// Fallback: try to find any 4-digit sequence
	match = regexp.MustCompile(`\b(\d{4})\b`).FindStringSubmatch(filename)
	if len(match) >= 2 {
		return match[1]
	}

	// Last resort: use base class method
	// Create a dummy DiscoveredFile to extract identifier
	dummyFile := types.DiscoveredFile{Filename: filename}
	if id := a.ExtractStoreIdentifier(dummyFile); id != nil {
		return id.Value
	}
	return ""
}

// ExtractStoreMetadata extracts store metadata from Konzum filename for auto-registration
// Parses: STORETYPE,ADDRESS+POSTAL+CITY,STORE_ID,DATE,TIME.CSV
func (a *KonzumAdapter) ExtractStoreMetadata(file types.DiscoveredFile) *types.StoreMetadata {
	parts := strings.Split(file.Filename, ",")
	if len(parts) < 3 {
		// Fall back to default behavior
		storeID := a.ExtractStoreIdentifierFromFilename(file.Filename)
		return &types.StoreMetadata{
			Name: fmt.Sprintf("%s %s", a.Name(), storeID),
		}
	}

	storeType := parts[0]      // SUPERMARKET, HIPERMARKET, etc.
	addressPart := parts[1]    // e.g., ŽITNA+1A+10310+IVANIĆ+GRAD

	// Decode URL-encoded parts
	decodedAddress := strings.ReplaceAll(addressPart, "+", " ")

	// Try to extract postal code (5-digit number)
	postalMatch := regexp.MustCompile(`(\d{5})`).FindStringSubmatch(decodedAddress)
	var address, city, postalCode string

	if len(postalMatch) >= 2 {
		postalCode = postalMatch[1]
		postalIndex := strings.Index(decodedAddress, postalCode)

		// Everything before postal code is address
		address = strings.TrimSpace(decodedAddress[:postalIndex])

		// Everything after postal code is city
		if postalIndex+5 < len(decodedAddress) {
			city = strings.TrimSpace(decodedAddress[postalIndex+5:])
		}
	} else {
		// No postal code found, use whole address part as address
		address = strings.TrimSpace(decodedAddress)
	}

	// Build store name
	nameParts := []string{storeType}
	if address != "" {
		nameParts = append(nameParts, address)
	}
	if city != "" {
		nameParts = append(nameParts, city)
	}

	return &types.StoreMetadata{
		Name:      strings.Join(nameParts, " "),
		Address:   address,
		City:      city,
		PostalCode: postalCode,
		StoreType: storeType,
	}
}
