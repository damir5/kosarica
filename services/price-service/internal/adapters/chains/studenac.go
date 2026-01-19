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
	"github.com/kosarica/price-service/internal/parsers/xml"
	"github.com/kosarica/price-service/internal/types"
)

// studenacFieldMapping is the primary field mapping for Studenac XML files (lowercase/snake_case)
var studenacFieldMapping = xml.XmlFieldMapping{
	// StoreIdentifier uses an extractor function - we'll set it at runtime
	ExternalID:            types.StringPtr("code"),
	Name:                  "name",
	Description:           types.StringPtr("description"),
	Category:              types.StringPtr("category"),
	Subcategory:           types.StringPtr("subcategory"),
	Brand:                 types.StringPtr("brand"),
	Unit:                  types.StringPtr("unit"),
	UnitQuantity:          types.StringPtr("quantity"),
	Price:                 "price",
	DiscountPrice:         types.StringPtr("discount_price"),
	DiscountStart:         types.StringPtr("discount_start"),
	DiscountEnd:           types.StringPtr("discount_end"),
	Barcodes:              types.StringPtr("barcode"),
	ImageURL:              types.StringPtr("image_url"),
	UnitPrice:             types.StringPtr("unit_price"),
	UnitPriceBaseQuantity: types.StringPtr("unit_price_quantity"),
	UnitPriceBaseUnit:     types.StringPtr("unit_price_unit"),
	LowestPrice30d:        types.StringPtr("lowest_price_30d"),
	AnchorPrice:           types.StringPtr("anchor_price"),
	AnchorPriceAsOf:       types.StringPtr("anchor_price_date"),
}

// studenacFieldMappingAlt is the alternative field mapping (Croatian headers/uppercase)
var studenacFieldMappingAlt = xml.XmlFieldMapping{
	ExternalID:            types.StringPtr("Sifra"),
	Name:                  "Naziv",
	Description:           types.StringPtr("Opis"),
	Category:              types.StringPtr("Kategorija"),
	Subcategory:           types.StringPtr("Podkategorija"),
	Brand:                 types.StringPtr("Marka"),
	Unit:                  types.StringPtr("Jedinica"),
	UnitQuantity:          types.StringPtr("Kolicina"),
	Price:                 "Cijena",
	DiscountPrice:         types.StringPtr("AkcijskaCijena"),
	DiscountStart:         types.StringPtr("PocetakAkcije"),
	DiscountEnd:           types.StringPtr("KrajAkcije"),
	Barcodes:              types.StringPtr("Barkod"),
	ImageURL:              types.StringPtr("Slika"),
	UnitPrice:             types.StringPtr("CijenaZaJedinicuMjere"),
	UnitPriceBaseQuantity: types.StringPtr("JedinicaMjereKolicina"),
	UnitPriceBaseUnit:     types.StringPtr("JedinicaMjereOznaka"),
	LowestPrice30d:        types.StringPtr("NajnizaCijena30Dana"),
	AnchorPrice:           types.StringPtr("SidrenaCijena"),
	AnchorPriceAsOf:       types.StringPtr("SidrenaCijenaDatum"),
}

// studenacStoreExtractor extracts store ID from Studenac XML items
// Tries: store_id, storeId, Store.Id
func studenacStoreExtractor(item map[string]interface{}) string {
	// Try store_id
	if storeID, ok := item["store_id"]; ok {
		return toString(storeID)
	}
	// Try storeId
	if storeID, ok := item["storeId"]; ok {
		return toString(storeID)
	}
	// Try Store.Id (nested)
	if store, ok := item["Store"].(map[string]interface{}); ok {
		if id, ok := store["Id"]; ok {
			return toString(id)
		}
	}
	return ""
}

// studenacStoreExtractorAlt extracts store ID using alternative field names
// Tries: StoreId, STORE_ID, Poslovnica.Id
func studenacStoreExtractorAlt(item map[string]interface{}) string {
	// Try StoreId
	if storeID, ok := item["StoreId"]; ok {
		return toString(storeID)
	}
	// Try STORE_ID
	if storeID, ok := item["STORE_ID"]; ok {
		return toString(storeID)
	}
	// Try Poslovnica.Id (nested)
	if poslovnica, ok := item["Poslovnica"].(map[string]interface{}); ok {
		if id, ok := poslovnica["Id"]; ok {
			return toString(id)
		}
	}
	return ""
}

// toString converts interface to string
func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case string:
		return val
	case float64:
		return fmt.Sprintf("%.0f", val)
	case int:
		return fmt.Sprintf("%d", val)
	case int64:
		return fmt.Sprintf("%d", val)
	default:
		return fmt.Sprintf("%v", v)
	}
}

// StudenacAdapter is the chain adapter for Studenac retail chain
type StudenacAdapter struct {
	*base.BaseXmlAdapter
	discoveryDate string // Date to filter discovery (YYYY-MM-DD format)
}

// NewStudenacAdapter creates a new Studenac adapter
func NewStudenacAdapter() (*StudenacAdapter, error) {
	chainConfig := config.ChainConfigs[config.ChainStudenac]

	// Set up primary mapping with store extractor
	primaryMapping := studenacFieldMapping
	primaryMapping.NameExtractor = nil // Use path-based extraction for name
	primaryMapping.PriceExtractor = nil

	// Set up alternative mapping with store extractor
	altMapping := studenacFieldMappingAlt
	altMapping.NameExtractor = nil
	altMapping.PriceExtractor = nil

	adapterConfig := base.XmlAdapterConfig{
		BaseAdapterConfig: base.BaseAdapterConfig{
			Slug:           string(config.ChainStudenac),
			Name:           chainConfig.Name,
			SupportedTypes: []types.FileType{types.FileTypeXML},
			ChainConfig:    chainConfig,
			FilenamePrefixPatterns: []string{
				`(?i)^Studenac[_-]?`,
				`(?i)^cjenik[_-]?`,
				`(?i)^SUPERMARKET[_-]?`,
			},
		},
		FieldMapping:            primaryMapping,
		AlternativeFieldMapping: &altMapping,
		DefaultItemsPath:        "products.product",
		ItemPaths: []string{
			"products.product",
			"Products.Product",
			"Proizvodi.Proizvod",
			"proizvodi.proizvod",
			"items.item",
			"Items.Item",
		},
	}

	baseAdapter, err := base.NewBaseXmlAdapter(adapterConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create base XML adapter: %w", err)
	}

	return &StudenacAdapter{
		BaseXmlAdapter: baseAdapter,
	}, nil
}

// SetDiscoveryDate sets the date to filter discovery results
// Date should be in YYYY-MM-DD format
func (a *StudenacAdapter) SetDiscoveryDate(date string) {
	a.discoveryDate = date
}

// Discover discovers available XML price files from Studenac portal
// If SetDiscoveryDate was called, filters results by that date
func (a *StudenacAdapter) Discover(targetDate string) ([]types.DiscoveredFile, error) {
	discoveredFiles := make([]types.DiscoveredFile, 0)
	seenURLs := make(map[string]bool)

	// Use SetDiscoveryDate value if targetDate not provided
	filterDate := targetDate
	if filterDate == "" && a.discoveryDate != "" {
		filterDate = a.discoveryDate
	}

	fmt.Printf("[DEBUG] Fetching Studenac portal: %s\n", a.BaseURL())

	resp, err := a.HTTPClient().Get(a.BaseURL())
	if err != nil {
		return nil, fmt.Errorf("failed to fetch portal: %w", err)
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

	// Extract XML file links
	xmlPattern := regexp.MustCompile(`href=["']([^"']*\.xml(?:\?[^"']*)?)["']`)
	matches := xmlPattern.FindAllStringSubmatch(body, -1)

	for _, match := range matches {
		if len(match) < 2 {
			continue
		}

		href := match[1]
		fileURL := a.resolveURL(href)

		// Skip duplicates
		if seenURLs[fileURL] {
			continue
		}
		seenURLs[fileURL] = true

		// Extract filename from URL
		filename := a.extractFilenameFromURL(fileURL)
		fileDate := a.extractDateFromFilename(filename)

		// Filter by date if filterDate is set
		if filterDate != "" && fileDate != "" && fileDate != filterDate {
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
			Type:         types.FileTypeXML,
			Size:         nil,
			LastModified: lastModified,
			Metadata: map[string]string{
				"source":       "studenac_portal",
				"discoveredAt": time.Now().Format(time.RFC3339),
				"portalDate":   fileDate,
			},
		})
	}

	return discoveredFiles, nil
}

// resolveURL resolves a potentially relative URL against the base URL
func (a *StudenacAdapter) resolveURL(href string) string {
	if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
		return href
	}

	baseURL := a.BaseURL()
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return baseURL + "/" + href
	}

	if strings.HasPrefix(href, "/") {
		// Absolute path
		return parsed.Scheme + "://" + parsed.Host + href
	}

	// Relative URL
	return baseURL + "/" + href
}

// extractFilenameFromURL extracts filename from URL
func (a *StudenacAdapter) extractFilenameFromURL(fileURL string) string {
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

// extractDateFromFilename extracts date from Studenac filename
// Tries YYYY-MM-DD and DD-MM-YYYY patterns
// Example: SUPERMARKET-Bijela_uvala_5_FUNTANA-T598-229-2026-12-29-07-00-14-559375.xml
func (a *StudenacAdapter) extractDateFromFilename(filename string) string {
	// Try YYYY-MM-DD pattern
	isoPattern := regexp.MustCompile(`(\d{4})-(\d{2})-(\d{2})`)
	if match := isoPattern.FindStringSubmatch(filename); len(match) == 4 {
		return fmt.Sprintf("%s-%s-%s", match[1], match[2], match[3])
	}

	// Try DD-MM-YYYY pattern
	euPattern := regexp.MustCompile(`(\d{2})-(\d{2})-(\d{4})`)
	if match := euPattern.FindStringSubmatch(filename); len(match) == 4 {
		return fmt.Sprintf("%s-%s-%s", match[3], match[2], match[1])
	}

	return ""
}

// ExtractStoreIdentifierFromFilename extracts store identifier from Studenac filename
// Pattern: {TYPE}-{LOCATION}-T{CODE}-{DATE...}.xml
func (a *StudenacAdapter) ExtractStoreIdentifierFromFilename(filename string) string {
	// Try to extract T-code (e.g., T598)
	tCodePattern := regexp.MustCompile(`-T(\d+)-`)
	if match := tCodePattern.FindStringSubmatch(filename); len(match) >= 2 {
		return match[1]
	}

	// Fallback to base class method
	dummyFile := types.DiscoveredFile{Filename: filename}
	if id := a.ExtractStoreIdentifier(dummyFile); id != nil {
		return id.Value
	}

	return ""
}

// ExtractStoreMetadata extracts store metadata from Studenac filename for auto-registration
// Pattern: {TYPE}-{LOCATION}-T{CODE}-{DATE...}.xml
// Example: SUPERMARKET-Bijela_uvala_5_FUNTANA-T598-229-2026-12-29-07-00-14-559375.xml
func (a *StudenacAdapter) ExtractStoreMetadata(file types.DiscoveredFile) *types.StoreMetadata {
	// Extract type and location from pattern: {TYPE}-{LOCATION}-T{CODE}-
	pattern := regexp.MustCompile(`^([A-Z]+)-(.+?)-T\d+-`)
	match := pattern.FindStringSubmatch(file.Filename)

	if len(match) < 3 {
		// Fall back to default behavior
		storeID := a.ExtractStoreIdentifierFromFilename(file.Filename)
		return &types.StoreMetadata{
			Name: fmt.Sprintf("%s %s", a.Name(), storeID),
		}
	}

	storeType := match[1]                           // "SUPERMARKET"
	locationRaw := match[2]                         // "Bijela_uvala_5_FUNTANA"
	location := strings.ReplaceAll(locationRaw, "_", " ") // "Bijela uvala 5 FUNTANA"

	// Try to separate address and city (city is often last word in ALL CAPS)
	words := strings.Split(location, " ")
	lastWord := words[len(words)-1]

	if isAllUpper(lastWord) && len(words) > 1 {
		// Last word is city (all caps like FUNTANA)
		city := lastWord
		address := strings.Join(words[:len(words)-1], " ")
		return &types.StoreMetadata{
			Name:      fmt.Sprintf("Studenac %s", titleCase(city)),
			Address:   titleCase(address),
			City:      titleCase(city),
			StoreType: storeType,
		}
	}

	return &types.StoreMetadata{
		Name:      fmt.Sprintf("Studenac %s", titleCase(location)),
		Address:   titleCase(location),
		StoreType: storeType,
	}
}

// Parse overrides the base Parse to inject store ID extractor
func (a *StudenacAdapter) Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error) {
	// First try with primary mapping
	result, err := a.BaseXmlAdapter.Parse(content, filename, options)
	if err != nil {
		return nil, err
	}

	// Post-process to extract store IDs from items if not already set
	storeID := a.ExtractStoreIdentifierFromFilename(filename)
	for i := range result.Rows {
		if result.Rows[i].StoreIdentifier == "" {
			result.Rows[i].StoreIdentifier = storeID
		}
	}

	return result, nil
}

// isAllUpper checks if a string is all uppercase
func isAllUpper(s string) bool {
	for _, r := range s {
		if r >= 'a' && r <= 'z' {
			return false
		}
	}
	return true
}

// titleCase converts string to title case
func titleCase(s string) string {
	words := strings.Split(strings.ToLower(s), " ")
	for i, word := range words {
		if len(word) > 0 {
			words[i] = strings.ToUpper(string(word[0])) + word[1:]
		}
	}
	return strings.Join(words, " ")
}
