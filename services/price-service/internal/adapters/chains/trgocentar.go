package chains

import (
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/kosarica/price-service/internal/adapters/base"
	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/parsers/xml"
	"github.com/kosarica/price-service/internal/types"
)

// TrgocentarAdapter is the chain adapter for Trgocentar retail chain
type TrgocentarAdapter struct {
	*base.BaseXmlAdapter
	discoveryDate string // Date filter for discovery (YYYY-MM-DD format)
}

// trgocentarFieldMapping is the field mapping for Trgocentar XML files
var trgocentarFieldMapping = xml.XmlFieldMapping{
	ExternalID: types.StringPtr("sif_art"),
	Name:       "naziv_art",
	Category:   types.StringPtr("naz_kat"),
	Brand:      types.StringPtr("marka"),
	Unit:       types.StringPtr("jmj"),
	UnitQuantity: types.StringPtr("net_kol"),
	Barcodes:   types.StringPtr("ean_kod"),
	UnitPrice:  types.StringPtr("c_jmj"),
	LowestPrice30d: types.StringPtr("c_najniza_30"),
	// Use PriceExtractor for complex price logic
	PriceExtractor: xml.FieldExtractor(func(item map[string]interface{}) string {
		// Try regular price (mpc) first
		if mpc, ok := item["mpc"].(string); ok && strings.TrimSpace(mpc) != "" {
			return strings.TrimSpace(mpc)
		}
		// If regular price is empty, try discount price (mpc_pop)
		if mpcPop, ok := item["mpc_pop"].(string); ok && strings.TrimSpace(mpcPop) != "" {
			return strings.TrimSpace(mpcPop)
		}
		return ""
	}),
	DiscountPrice: types.StringPtr("mpc_pop"),
	// The anchor price field has a dynamic name based on date (e.g., c_020525 for 2025-05-02)
	// We handle this in post-processing
}

// NewTrgocentarAdapter creates a new Trgocentar adapter
func NewTrgocentarAdapter() (*TrgocentarAdapter, error) {
	chainConfig := config.ChainConfigs[config.ChainTrgocentar]

	adapterConfig := base.XmlAdapterConfig{
		BaseAdapterConfig: base.BaseAdapterConfig{
			Slug:           string(config.ChainTrgocentar),
			Name:           chainConfig.Name,
			SupportedTypes: []types.FileType{types.FileTypeXML},
			ChainConfig:    chainConfig,
			FilenamePrefixPatterns: []string{
				`(?i)^Trgocentar[_-]?`,
				`(?i)^cjenik[_-]?`,
				`(?i)^SUPERMARKET[_-]?`,
			},
			FileExtensionPattern: regexp.MustCompile(`\.(xml|XML)$`),
		},
		FieldMapping:     trgocentarFieldMapping,
		DefaultItemsPath: "DocumentElement.cjenik",
		ItemPaths:        []string{"DocumentElement.cjenik"},
	}

	baseAdapter, err := base.NewBaseXmlAdapter(adapterConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create base XML adapter: %w", err)
	}

	return &TrgocentarAdapter{
		BaseXmlAdapter: baseAdapter,
	}, nil
}

// SetDiscoveryDate sets the date to use for discovery filtering
func (a *TrgocentarAdapter) SetDiscoveryDate(date string) {
	a.discoveryDate = date
}

// extractDateFromFilename extracts date from Trgocentar filename
// Pattern: DDMMYYYYHHMM at end before .xml
func (a *TrgocentarAdapter) extractDateFromFilename(filename string) string {
	// Try DDMMYYYYHHMM pattern (Trgocentar specific format)
	match := regexp.MustCompile(`(\d{2})(\d{2})(\d{4})\d{4}\.xml$`).FindStringSubmatch(filename)
	if len(match) >= 4 {
		return fmt.Sprintf("%s-%s-%s", match[3], match[2], match[1])
	}

	// Try YYYY-MM-DD pattern
	match = regexp.MustCompile(`(\d{4})-(\d{2})-(\d{2})`).FindStringSubmatch(filename)
	if len(match) >= 4 {
		return fmt.Sprintf("%s-%s-%s", match[1], match[2], match[3])
	}

	// Try DD-MM-YYYY pattern
	match = regexp.MustCompile(`(\d{2})-(\d{2})-(\d{4})`).FindStringSubmatch(filename)
	if len(match) >= 4 {
		return fmt.Sprintf("%s-%s-%s", match[3], match[2], match[1])
	}

	return ""
}

// Discover discovers available Trgocentar price files from the portal
func (a *TrgocentarAdapter) Discover(targetDate string) ([]types.DiscoveredFile, error) {
	discoveredFiles := make([]types.DiscoveredFile, 0)
	seenURLs := make(map[string]bool)

	fmt.Printf("[DEBUG] Fetching Trgocentar portal: %s\n", a.BaseURL())

	resp, err := a.HTTPClient().Get(a.BaseURL())
	if err != nil {
		fmt.Printf("[ERROR] Failed to fetch Trgocentar portal: %v\n", err)
		return nil, fmt.Errorf("failed to fetch Trgocentar portal: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		fmt.Printf("[ERROR] Trgocentar portal returned status %d\n", resp.StatusCode)
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	html := string(bodyBytes)

	// Extract XML file links
	xmlPattern := regexp.MustCompile(`href=["']([^"']*\.xml(?:\?[^"']*)?)["']`)
	matches := xmlPattern.FindAllStringSubmatch(html, -1)

	for _, match := range matches {
		if len(match) < 2 {
			continue
		}

		href := match[1]
		fileURL := href
		if !strings.HasPrefix(href, "http") {
			fileURL = a.BaseURL() + "/" + strings.TrimPrefix(href, "/")
		}

		// Skip duplicates
		if seenURLs[fileURL] {
			continue
		}
		seenURLs[fileURL] = true

		// Extract filename from URL
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
			Type:         types.FileTypeXML,
			Size:         nil,
			LastModified: lastModified,
			Metadata: map[string]string{
				"source":       "trgocentar_portal",
				"discoveredAt": time.Now().Format(time.RFC3339),
				"portalDate":   fileDate,
			},
		})
	}

	return discoveredFiles, nil
}

// extractFilenameFromURL extracts filename from URL
func (a *TrgocentarAdapter) extractFilenameFromURL(fileURL string) string {
	parts := strings.Split(fileURL, "/")
	if len(parts) > 0 {
		filename := parts[len(parts)-1]
		// Remove query string if present
		if queryIdx := strings.Index(filename, "?"); queryIdx != -1 {
			filename = filename[:queryIdx]
		}
		return filename
	}
	return fileURL
}

// ExtractStoreIdentifierFromFilename extracts store identifier from Trgocentar filename
// Trgocentar filenames contain store codes like P220, P195, P120
func (a *TrgocentarAdapter) ExtractStoreIdentifierFromFilename(filename string) string {
	baseName := regexp.MustCompile(`\.(xml|XML)$`).ReplaceAllString(filename, "")

	// Try to extract Trgocentar store code (P followed by 3 digits)
	match := regexp.MustCompile(`P(\d{3})`).FindStringSubmatch(baseName)
	if len(match) >= 2 {
		return "P" + match[1]
	}

	// Fallback to base class method
	dummyFile := types.DiscoveredFile{Filename: filename}
	if id := a.ExtractStoreIdentifier(dummyFile); id != nil {
		return id.Value
	}
	return ""
}

// ExtractStoreMetadata extracts store metadata from Trgocentar filename
// Pattern: SUPERMARKET_HUM_NA_SUTLI_185_P220_005_050120260747.xml
func (a *TrgocentarAdapter) ExtractStoreMetadata(file types.DiscoveredFile) *types.StoreMetadata {
	baseName := regexp.MustCompile(`\.(xml|XML)$`).ReplaceAllString(file.Filename, "")

	// Extract location between SUPERMARKET_ and _P{code}
	match := regexp.MustCompile(`^SUPERMARKET_(.+?)_P\d{3}`).FindStringSubmatch(baseName)
	if len(match) == 0 {
		storeID := a.ExtractStoreIdentifierFromFilename(file.Filename)
		return &types.StoreMetadata{
			Name: fmt.Sprintf("Trgocentar %s", storeID),
		}
	}

	locationRaw := match[1]
	location := strings.ReplaceAll(locationRaw, "_", " ")

	return &types.StoreMetadata{
		Name:      fmt.Sprintf("Trgocentar %s", strings.Title(strings.ToLower(location))),
		Address:   strings.Title(strings.ToLower(location)),
		StoreType: "SUPERMARKET",
	}
}
