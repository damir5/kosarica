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

// kauflandAsset represents a single asset from Kaufland's JSON API
type kauflandAsset struct {
	Label   string      `json:"label"`
	Path    string      `json:"path"`
	Filters interface{} `json:"filters"`
}

// kauflandColumnMapping is the primary column mapping for Kaufland CSV files
var kauflandColumnMapping = csv.CsvColumnMapping{
	ExternalID:          types.StringPtr("šifra proizvoda"),
	Name:                "naziv proizvoda",
	Category:            types.StringPtr("kategorija proizvoda"),
	Brand:               types.StringPtr("marka proizvoda"),
	Unit:                types.StringPtr("jedinica mjere"),
	UnitQuantity:        types.StringPtr("neto količina(KG)"),
	Price:               "maloprod.cijena(EUR)",
	DiscountPrice:       types.StringPtr("akc.cijena, A=akcija"),
	Barcodes:            types.StringPtr("barkod"),
	UnitPrice:           types.StringPtr("cijena jed.mj.(EUR)"),
	LowestPrice30d:      types.StringPtr("Najniža MPC u 30dana"),
	AnchorPrice:         types.StringPtr("Sidrena cijena"),
	UnitPriceBaseQuantity: types.StringPtr("kol.jed.mj."),
	UnitPriceBaseUnit:   types.StringPtr("jed.mj. (1 KOM/L/KG)"),
}

// kauflandColumnMappingAlt is the alternative column mapping for Kaufland CSV files
var kauflandColumnMappingAlt = csv.CsvColumnMapping{
	ExternalID:          types.StringPtr("Šifra"),
	Name:                "Naziv",
	Category:            types.StringPtr("Kategorija"),
	Brand:               types.StringPtr("Marka"),
	Unit:                types.StringPtr("Mjerna jedinica"),
	UnitQuantity:        types.StringPtr("Količina"),
	Price:               "Cijena",
	DiscountPrice:       types.StringPtr("Akcijska cijena"),
	Barcodes:            types.StringPtr("Barkod"),
	UnitPrice:           types.StringPtr("Cijena za jedinicu mjere"),
	LowestPrice30d:      types.StringPtr("Najniža cijena u zadnjih 30 dana"),
	AnchorPrice:         types.StringPtr("Sidrena cijena"),
	UnitPriceBaseQuantity: types.StringPtr("Količina za jedinicu mjere"),
	UnitPriceBaseUnit:   types.StringPtr("Jedinica mjere za cijenu"),
}

// KauflandAdapter is the chain adapter for Kaufland retail chain
type KauflandAdapter struct {
	*base.BaseCsvAdapter
	discoveryDate string // Date filter for discovery (YYYY-MM-DD format)
}

const (
	kauflandAssetAPIURL = "https://www.kaufland.hr/akcije-novosti/popis-mpc.assetSearch.id=assetList_1599847924.json"
)

// NewKauflandAdapter creates a new Kaufland adapter
func NewKauflandAdapter() (*KauflandAdapter, error) {
	chainConfig := config.ChainConfigs[config.ChainKaufland]

	adapterConfig := base.CsvAdapterConfig{
		BaseAdapterConfig: base.BaseAdapterConfig{
			Slug:           string(config.ChainKaufland),
			Name:           chainConfig.Name,
			SupportedTypes: []types.FileType{types.FileTypeCSV},
			ChainConfig:    chainConfig,
			FilenamePrefixPatterns: []string{
				`(?i)^Kaufland[_-]?`,
				`(?i)^cjenik[_-]?`,
				`(?i)^Hipermarket[_-]?`,
				`(?i)^Supermarket[_-]?`,
			},
		},
		ColumnMapping:            kauflandColumnMapping,
		AlternativeColumnMapping: &kauflandColumnMappingAlt,
	}

	baseAdapter, err := base.NewBaseCsvAdapter(adapterConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create base CSV adapter: %w", err)
	}

	return &KauflandAdapter{
		BaseCsvAdapter: baseAdapter,
	}, nil
}

// SetDiscoveryDate sets the date to use for discovery filtering
func (a *KauflandAdapter) SetDiscoveryDate(date string) {
	a.discoveryDate = date
}

// Discover discovers available Kaufland price files via JSON API
func (a *KauflandAdapter) Discover(targetDate string) ([]types.DiscoveredFile, error) {
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

	// Convert YYYY-MM-DD to DDMMYYYY format used in Kaufland filenames
	parts := strings.Split(date, "-")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid date format: %s (expected YYYY-MM-DD)", date)
	}
	targetDatePattern := fmt.Sprintf("%s%s%s", parts[2], parts[1], parts[0]) // DDMMYYYY

	fmt.Printf("[DEBUG] Fetching Kaufland asset API: %s\n", kauflandAssetAPIURL)
	fmt.Printf("[DEBUG] Looking for date pattern: %s\n", targetDatePattern)

	resp, err := a.HTTPClient().Get(kauflandAssetAPIURL)
	if err != nil {
		fmt.Printf("[ERROR] Failed to fetch Kaufland asset API: %v\n", err)
		return nil, fmt.Errorf("failed to fetch Kaufland asset API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		fmt.Printf("[ERROR] Kaufland asset API returned status %d\n", resp.StatusCode)
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	var assets []kauflandAsset
	if err := json.Unmarshal(bodyBytes, &assets); err != nil {
		return nil, fmt.Errorf("failed to parse JSON response: %w", err)
	}

	for _, asset := range assets {
		filename := asset.Label
		path := asset.Path

		// Extract date from filename (format: ..._{DDMMYYYY}_...)
		dateMatch := regexp.MustCompile(`_(\d{8})_`).FindStringSubmatch(filename)
		if len(dateMatch) < 2 {
			continue
		}

		fileDate := dateMatch[1]

		// Filter by target date
		if fileDate != targetDatePattern {
			continue
		}

		// Build full download URL
		fileURL := fmt.Sprintf("https://www.kaufland.hr%s", path)

		// Skip duplicates
		if seenURLs[fileURL] {
			continue
		}
		seenURLs[fileURL] = true

		var lastModified *time.Time
		if t, err := time.Parse("2006-01-02", date); err == nil {
			lastModified = &t
		}

		discoveredFiles = append(discoveredFiles, types.DiscoveredFile{
			URL:          fileURL,
			Filename:     filename,
			Type:         types.FileTypeCSV,
			Size:         nil,
			LastModified: lastModified,
			Metadata: map[string]string{
				"source":         "kaufland_api",
				"discoveredAt":   time.Now().Format(time.RFC3339),
				"portalDate":     date,
				"fileDatePattern": fileDate,
			},
		})
	}

	if len(discoveredFiles) == 0 {
		fmt.Printf("[DEBUG] No CSV files found for date %s (pattern: %s)\n", date, targetDatePattern)
	} else {
		fmt.Printf("[DEBUG] Found %d CSV file(s) for date %s\n", len(discoveredFiles), date)
	}

	return discoveredFiles, nil
}

// ExtractStoreIdentifierFromFilename extracts store identifier from Kaufland filename
// Pattern: {StoreType}_{Address}_{City}_{StoreId}_{DDMMYYYY}_{Version}.csv
func (a *KauflandAdapter) ExtractStoreIdentifierFromFilename(filename string) string {
	// Match 4-digit store code before date pattern: _{NNNN}_{DDMMYYYY}
	match := regexp.MustCompile(`_(\d{4})_\d{8}_`).FindStringSubmatch(filename)
	if len(match) >= 2 {
		return match[1]
	}

	// Fallback: try to find any 4-digit sequence
	fallbackMatch := regexp.MustCompile(`_(\d{4})_`).FindStringSubmatch(filename)
	if len(fallbackMatch) >= 2 {
		return fallbackMatch[1]
	}

	// Fallback to base class method
	dummyFile := types.DiscoveredFile{Filename: filename}
	if id := a.ExtractStoreIdentifier(dummyFile); id != nil {
		return id.Value
	}
	return ""
}

// ExtractStoreMetadata extracts store metadata from Kaufland filename
// Pattern: {StoreType}_{Address...}_{PostalCode}_{City}_{StoreId}_{DATE}_{Ver}.csv
func (a *KauflandAdapter) ExtractStoreMetadata(file types.DiscoveredFile) *types.StoreMetadata {
	baseName := regexp.MustCompile(`\.(csv|CSV)$`).ReplaceAllString(file.Filename, "")
	parts := strings.Split(baseName, "_")
	if len(parts) < 6 {
		storeID := a.ExtractStoreIdentifierFromFilename(file.Filename)
		return &types.StoreMetadata{
			Name: fmt.Sprintf("Kaufland %s", storeID),
		}
	}

	storeType := parts[0]

	// Find postal code (5-digit pattern) working backwards
	postalIdx := -1
	for i := len(parts) - 4; i > 0; i-- {
		if regexp.MustCompile(`^\d{5}$`).MatchString(parts[i]) {
			postalIdx = i
			break
		}
	}

	if postalIdx == -1 {
		storeID := a.ExtractStoreIdentifierFromFilename(file.Filename)
		return &types.StoreMetadata{
			Name: fmt.Sprintf("Kaufland %s", storeID),
		}
	}

	address := strings.Join(parts[1:postalIdx], " ")
	postalCode := parts[postalIdx]
	city := ""
	if postalIdx+1 < len(parts) {
		city = parts[postalIdx+1]
	}

	return &types.StoreMetadata{
		Name:       fmt.Sprintf("%s %s", storeType, titleCase(city)),
		Address:    titleCase(address),
		City:       titleCase(city),
		PostalCode: postalCode,
		StoreType:  storeType,
	}
}
