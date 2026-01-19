package chains

import (
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/kosarica/price-service/internal/adapters/base"
	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/parsers/csv"
	"github.com/kosarica/price-service/internal/types"
)

// intersparJsonFile represents a file entry from Interspar's JSON API
type intersparJsonFile struct {
	Name string `json:"name"`
	URL  string `json:"URL"`
	SHA  string `json:"SHA"`
}

// intersparJsonResponse represents the JSON API response structure
type intersparJsonResponse struct {
	Files []intersparJsonFile `json:"files"`
}

// intersparColumnMapping is the primary column mapping for Interspar CSV files
var intersparColumnMapping = csv.CsvColumnMapping{
	ExternalID:     types.StringPtr("šifra"),
	Name:           "naziv",
	Category:       types.StringPtr("kategorija proizvoda"),
	Brand:          types.StringPtr("marka"),
	Unit:           types.StringPtr("jedinica mjere"),
	UnitQuantity:   types.StringPtr("neto količina"),
	Price:          "MPC (EUR)",
	DiscountPrice:  types.StringPtr("MPC za vrijeme posebnog oblika prodaje (EUR)"),
	Barcodes:       types.StringPtr("barkod"),
	UnitPrice:      types.StringPtr("cijena za jedinicu mjere (EUR)"),
	LowestPrice30d: types.StringPtr("Najniža cijena u posljednjih 30 dana (EUR)"),
	AnchorPrice:    types.StringPtr("sidrena cijena na 2.5.2025. (EUR)"),
}

// intersparColumnMappingAlt is the alternative column mapping for Interspar CSV files
var intersparColumnMappingAlt = csv.CsvColumnMapping{
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

// IntersparAdapter is the chain adapter for Interspar retail chain
type IntersparAdapter struct {
	*base.BaseCsvAdapter
	discoveryDate string // Date filter for discovery (YYYY-MM-DD format)
}

// NewIntersparAdapter creates a new Interspar adapter
func NewIntersparAdapter() (*IntersparAdapter, error) {
	chainConfig := config.ChainConfigs[config.ChainInterspar]

	adapterConfig := base.CsvAdapterConfig{
		BaseAdapterConfig: base.BaseAdapterConfig{
			Slug:           string(config.ChainInterspar),
			Name:           chainConfig.Name,
			SupportedTypes: []types.FileType{types.FileTypeCSV},
			ChainConfig:    chainConfig,
			FilenamePrefixPatterns: []string{
				`(?i)^Interspar[_-]?`,
				`(?i)^Spar[_-]?`,
				`(?i)^cjenik[_-]?`,
			},
		},
		ColumnMapping:            intersparColumnMapping,
		AlternativeColumnMapping: &intersparColumnMappingAlt,
	}

	baseAdapter, err := base.NewBaseCsvAdapter(adapterConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create base CSV adapter: %w", err)
	}

	return &IntersparAdapter{
		BaseCsvAdapter: baseAdapter,
	}, nil
}

// SetDiscoveryDate sets the date to use for discovery filtering
func (a *IntersparAdapter) SetDiscoveryDate(date string) {
	a.discoveryDate = date
}

// Discover discovers available Interspar price files via JSON API
// Interspar provides a JSON API endpoint: /datoteke_cjenici/Cjenik{YYYYMMDD}.json
func (a *IntersparAdapter) Discover(targetDate string) ([]types.DiscoveredFile, error) {
	discoveredFiles := make([]types.DiscoveredFile, 0)

	// Use provided date or default to today
	date := targetDate
	if date == "" {
		date = a.discoveryDate
	}
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}

	// Convert date from YYYY-MM-DD to YYYYMMDD format for the API
	dateForApi := strings.ReplaceAll(date, "-", "")

	// Construct the JSON API URL
	apiUrl := fmt.Sprintf("https://www.spar.hr/datoteke_cjenici/Cjenik%s.json", dateForApi)
	fmt.Printf("[DEBUG] Fetching Interspar JSON API: %s\n", apiUrl)

	resp, err := a.HTTPClient().Get(apiUrl)
	if err != nil {
		fmt.Printf("[ERROR] Failed to fetch Interspar JSON API: %v\n", err)
		return nil, fmt.Errorf("failed to fetch Interspar JSON API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		fmt.Printf("[ERROR] Interspar JSON API returned status %d\n", resp.StatusCode)
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	var data intersparJsonResponse
	if err := json.Unmarshal(bodyBytes, &data); err != nil {
		return nil, fmt.Errorf("failed to parse JSON response: %w", err)
	}

	if len(data.Files) == 0 {
		fmt.Printf("[DEBUG] No files found in JSON response for date %s\n", date)
		return discoveredFiles, nil
	}

	fmt.Printf("[DEBUG] Found %d file(s) in JSON response\n", len(data.Files))

	lastModified, _ := time.Parse("2006-01-02", date)
	for _, file := range data.Files {
		discoveredFiles = append(discoveredFiles, types.DiscoveredFile{
			URL:          file.URL,
			Filename:     file.Name,
			Type:         types.FileTypeCSV,
			Size:         nil,
			LastModified: types.TimePtr(lastModified),
			Metadata: map[string]string{
				"source":       "interspar_json_api",
				"discoveredAt": time.Now().Format(time.RFC3339),
				"portalDate":   date,
				"sha":          file.SHA,
			},
		})
	}

	return discoveredFiles, nil
}

// ExtractStoreIdentifierFromFilename extracts store identifier from Interspar filename
func (a *IntersparAdapter) ExtractStoreIdentifierFromFilename(filename string) string {
	baseName := regexp.MustCompile(`\.(csv|CSV)$`).ReplaceAllString(filename, "")

	// Try to extract 4-digit store code
	match := regexp.MustCompile(`[_-](\d{4})[_-]`).FindStringSubmatch(baseName)
	if len(match) >= 2 {
		return match[1]
	}

	// Try to extract location name after Interspar prefix
	locationMatch := regexp.MustCompile(`(?i)^(?:Interspar|Spar)[_-]?(.+?)(?:[_-]\d{4}[_-]\d{2}[_-]\d{2})?$`).FindStringSubmatch(baseName)
	if len(locationMatch) >= 2 {
		return locationMatch[1]
	}

	// Fallback to base class method
	dummyFile := types.DiscoveredFile{Filename: filename}
	if id := a.ExtractStoreIdentifier(dummyFile); id != nil {
		return id.Value
	}
	return ""
}

// ExtractStoreMetadata extracts store metadata from Interspar filename
// Pattern: {type}_{city}_{address...}_{storeId}_interspar_{city}_{code}_{date}_{time}.csv
func (a *IntersparAdapter) ExtractStoreMetadata(file types.DiscoveredFile) *types.StoreMetadata {
	baseName := regexp.MustCompile(`\.(csv|CSV)$`).ReplaceAllString(file.Filename, "")
	parts := strings.Split(baseName, "_")
	if len(parts) < 8 {
		storeID := a.ExtractStoreIdentifierFromFilename(file.Filename)
		return &types.StoreMetadata{
			Name: fmt.Sprintf("%s %s", a.Name(), storeID),
		}
	}

	storeType := parts[0]
	city := parts[1]

	// Find "interspar" marker
	intersparIdx := -1
	for i, p := range parts {
		if strings.ToLower(p) == "interspar" {
			intersparIdx = i
			break
		}
	}

	if intersparIdx == -1 || intersparIdx < 3 {
		storeID := a.ExtractStoreIdentifierFromFilename(file.Filename)
		return &types.StoreMetadata{
			Name: fmt.Sprintf("%s %s", a.Name(), storeID),
		}
	}

	address := strings.Join(parts[2:intersparIdx-1], " ")

	return &types.StoreMetadata{
		Name:      fmt.Sprintf("Interspar %s", titleCase(city)),
		Address:   titleCase(address),
		City:      titleCase(city),
		StoreType: titleCase(storeType),
	}
}
