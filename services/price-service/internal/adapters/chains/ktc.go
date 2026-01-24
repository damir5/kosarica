package chains

import (
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/kosarica/price-service/internal/adapters/base"
	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/parsers/csv"
	"github.com/kosarica/price-service/internal/types"
)

// ktcColumnMapping is the primary column mapping for KTC CSV files
var ktcColumnMapping = csv.CsvColumnMapping{
	ExternalID:     types.StringPtr("Šifra proizvoda"),
	Name:           "Naziv proizvoda",
	Category:       types.StringPtr("Kategorija"),
	Brand:          types.StringPtr("Marka proizvoda"),
	Unit:           types.StringPtr("Jedinica mjere"),
	UnitQuantity:   types.StringPtr("Neto količina"),
	Price:          "Maloprodajna cijena",
	DiscountPrice:  types.StringPtr("MPC za vrijeme posebnog oblika prodaje"),
	Barcodes:       types.StringPtr("Barkod"),
	UnitPrice:      types.StringPtr("Cijena za jedinicu mjere"),
	LowestPrice30d: types.StringPtr("Najniža cijena u posljednjih 30 dana"),
}

// ktcColumnMappingAlt is the alternative column mapping for KTC CSV files
var ktcColumnMappingAlt = csv.CsvColumnMapping{
	ExternalID:     types.StringPtr("Sifra proizvoda"),
	Name:           "Naziv proizvoda",
	Category:       types.StringPtr("Kategorija"),
	Brand:          types.StringPtr("Marka proizvoda"),
	Unit:           types.StringPtr("Jedinica mjere"),
	UnitQuantity:   types.StringPtr("Neto kolicina"),
	Price:          "Maloprodajna cijena",
	DiscountPrice:  types.StringPtr("MPC za vrijeme posebnog oblika prodaje"),
	Barcodes:       types.StringPtr("Barkod"),
	UnitPrice:      types.StringPtr("Cijena za jedinicu mjere"),
	LowestPrice30d: types.StringPtr("Najniza cijena u posljednjih 30 dana"),
}

// KtcAdapter is the chain adapter for KTC retail chain
type KtcAdapter struct {
	*base.BaseCsvAdapter
	discoveryDate string // Date filter for discovery (YYYY-MM-DD format)
}

// NewKtcAdapter creates a new KTC adapter
func NewKtcAdapter() (*KtcAdapter, error) {
	chainConfig := config.ChainConfigs[config.ChainKtc]

	adapterConfig := base.CsvAdapterConfig{
		BaseAdapterConfig: base.BaseAdapterConfig{
			Slug:           string(config.ChainKtc),
			Name:           chainConfig.Name,
			SupportedTypes: []types.FileType{types.FileTypeCSV},
			ChainConfig:    chainConfig,
			FilenamePrefixPatterns: []string{
				`(?i)^TRGOVINA[_-]?`,
				`(?i)^KTC[_-]?`,
				`(?i)^cjenik[_-]?`,
			},
		},
		ColumnMapping:            ktcColumnMapping,
		AlternativeColumnMapping: &ktcColumnMappingAlt,
	}

	baseAdapter, err := base.NewBaseCsvAdapter(adapterConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create base CSV adapter: %w", err)
	}

	return &KtcAdapter{
		BaseCsvAdapter: baseAdapter,
	}, nil
}

// SetDiscoveryDate sets the date to use for discovery filtering
func (a *KtcAdapter) SetDiscoveryDate(date string) {
	a.discoveryDate = date
}

// extractDateFromFilename extracts date from KTC filename
// Pattern: YYYYMMDD-HHMMSS at end of filename
func (a *KtcAdapter) extractDateFromFilename(filename string) string {
	// Match 8-digit date pattern (YYYYMMDD) before 6-digit time
	match := regexp.MustCompile(`(\d{4})(\d{2})(\d{2})-\d{6}\.csv$`).FindStringSubmatch(filename)
	if len(match) >= 4 {
		return fmt.Sprintf("%s-%s-%s", match[1], match[2], match[3])
	}
	return ""
}

// Discover discovers available KTC price files
// KTC uses a two-level portal: main page lists stores, each store page lists CSV files
func (a *KtcAdapter) Discover(targetDate string) ([]types.DiscoveredFile, error) {
	discoveredFiles := make([]types.DiscoveredFile, 0)
	seenURLs := make(map[string]bool)

	log.Debug().Str("chain", a.Name()).Str("portal", a.BaseURL()).Msg("Fetching portal")

	// Fetch main page to get list of stores
	resp, err := a.HTTPClient().Get(a.BaseURL())
	if err != nil {
		log.Error().Err(err).Msg("Failed to fetch KTC portal")
		return nil, fmt.Errorf("failed to fetch KTC portal: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		log.Error().Int("status_code", resp.StatusCode).Msg("KTC portal returned unexpected status")
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	html := string(bodyBytes)

	// Extract store names from links like: ?poslovnica=RC%20BJELOVAR%20PJ-50
	storePattern := regexp.MustCompile(`poslovnica=([^"&]+)`)
	matches := storePattern.FindAllStringSubmatch(html, -1)

	stores := make([]string, 0)
	seenStores := make(map[string]bool)
	for _, match := range matches {
		if len(match) >= 2 {
			storeName, _ := url.QueryUnescape(match[1])
			if !seenStores[storeName] {
				seenStores[storeName] = true
				stores = append(stores, storeName)
			}
		}
	}

	log.Debug().Int("store_count", len(stores)).Msg("Found stores on KTC portal")

	// For each store, fetch store page and extract CSV links
	for _, storeName := range stores {
		storeURL := fmt.Sprintf("%s?poslovnica=%s", a.BaseURL(), url.QueryEscape(storeName))

		storeResp, err := a.HTTPClient().Get(storeURL)
		if err != nil {
			log.Warn().Str("store", storeName).Err(err).Msg("Failed to fetch store page")
			continue
		}
		defer storeResp.Body.Close()

		if storeResp.StatusCode != 200 {
			log.Warn().Str("store", storeName).Int("status_code", storeResp.StatusCode).Msg("Store page returned unexpected status")
			continue
		}

		storeBodyBytes, err := io.ReadAll(storeResp.Body)
		if err != nil {
			continue
		}

		storeHtml := string(storeBodyBytes)

		// Extract CSV links like: /ktcftp/Cjenici/STORE_NAME/FILENAME.csv
		csvPattern := regexp.MustCompile(`href="([^"]*\.csv)"`)
		csvMatches := csvPattern.FindAllStringSubmatch(storeHtml, -1)

		for _, csvMatch := range csvMatches {
			if len(csvMatch) < 2 {
				continue
			}

			href := csvMatch[1]
			fileURL := href
			if !strings.HasPrefix(href, "http") {
				fileURL = a.BaseURL() + "/" + strings.TrimPrefix(href, "/")
			}

			// Skip duplicates
			if seenURLs[fileURL] {
				continue
			}
			seenURLs[fileURL] = true

			filename := a.extractFilenameFromURL(fileURL)
			fileDate := a.extractDateFromFilename(filename)

			// Filter by date if discoveryDate is set
			if a.discoveryDate != "" && fileDate != "" && fileDate != a.discoveryDate {
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
				Type:         types.FileTypeCSV,
				Size:         nil,
				LastModified: lastModified,
				Metadata: map[string]string{
					"source":       "ktc_portal",
					"discoveredAt": time.Now().Format(time.RFC3339),
					"storeName":    storeName,
					"portalDate":   fileDate,
				},
			})
		}
	}

	return discoveredFiles, nil
}

// extractFilenameFromURL extracts filename from URL
func (a *KtcAdapter) extractFilenameFromURL(fileURL string) string {
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

// ExtractStoreIdentifierFromFilename extracts store identifier from KTC filename
// Pattern: TRGOVINA-ADDRESS-STORE_ID-DATE-TIME.csv
// Store IDs like: PJ50-1, PJ7B-1, PJ8A-1
func (a *KtcAdapter) ExtractStoreIdentifierFromFilename(filename string) string {
	// Try to match PJ followed by alphanumeric + dash + digit before date
	match := regexp.MustCompile(`(PJ[\dA-Z]+-\d+)-\d{8}-\d{6}\.csv$`).FindStringSubmatch(filename)
	if len(match) >= 2 {
		return match[1]
	}

	// Try simpler pattern: PJ followed by alphanumeric
	simpleMatch := regexp.MustCompile(`(PJ[\dA-Z]+)-\d+-\d{8}`).FindStringSubmatch(filename)
	if len(simpleMatch) >= 2 {
		return simpleMatch[1]
	}

	// Fallback to base class method
	dummyFile := types.DiscoveredFile{Filename: filename}
	if id := a.ExtractStoreIdentifier(dummyFile); id != nil {
		return id.Value
	}
	return ""
}

// ExtractStoreMetadata extracts store metadata from KTC filename
// Pattern: TRGOVINA-ADDRESS-STORE_ID-DATE-TIME.csv
func (a *KtcAdapter) ExtractStoreMetadata(file types.DiscoveredFile) *types.StoreMetadata {
	baseName := regexp.MustCompile(`\.(csv|CSV)$`).ReplaceAllString(file.Filename, "")

	// Extract address between TRGOVINA- and -PJ
	match := regexp.MustCompile(`^TRGOVINA-(.+?)-(PJ[\dA-Z]+-\d+)-`).FindStringSubmatch(baseName)
	if len(match) == 0 {
		storeID := a.ExtractStoreIdentifierFromFilename(file.Filename)
		return &types.StoreMetadata{
			Name: fmt.Sprintf("KTC %s", storeID),
		}
	}

	addressFull := match[1]

	// Last word is typically the city
	words := strings.Fields(addressFull)
	city := ""
	address := addressFull
	if len(words) > 1 {
		city = words[len(words)-1]
		address = strings.Join(words[:len(words)-1], " ")
	}

	return &types.StoreMetadata{
		Name:   fmt.Sprintf("KTC %s", titleCase(city)),
		Address: titleCase(address),
		City:   titleCase(city),
	}
}
