package chains

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/kosarica/price-service/internal/adapters/base"
	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/parsers/csv"
	"github.com/kosarica/price-service/internal/types"
)

// metroColumnMapping is the primary column mapping for Metro CSV files
var metroColumnMapping = csv.CsvColumnMapping{
	ExternalID:     types.StringPtr("SIFRA"),
	Name:           "NAZIV",
	Category:       types.StringPtr("KATEGORIJA"),
	Brand:          types.StringPtr("MARKA"),
	Unit:           types.StringPtr("JED_MJERE"),
	UnitQuantity:   types.StringPtr("NETO_KOLICINA"),
	Price:          "MPC",
	DiscountPrice:  types.StringPtr("POSEBNA_PRODAJA"),
	Barcodes:       types.StringPtr("BARKOD"),
	UnitPrice:      types.StringPtr("CIJENA_PO_MJERI"),
	LowestPrice30d: types.StringPtr("NAJNIZA_30_DANA"),
	// Note: anchorPrice column has dynamic date suffix (SIDRENA_XX_XX)
	AnchorPrice: types.StringPtr("SIDRENA"),
}

// metroColumnMappingAlt is the alternative column mapping for Metro CSV files
var metroColumnMappingAlt = csv.CsvColumnMapping{
	ExternalID:     types.StringPtr("Šifra"),
	Name:           "Naziv",
	Category:       types.StringPtr("Kategorija"),
	Brand:          types.StringPtr("Marka"),
	Unit:           types.StringPtr("Mjerna jedinica"),
	UnitQuantity:   types.StringPtr("Količina"),
	Price:          "Cijena",
	DiscountPrice:  types.StringPtr("Akcijska cijena"),
	DiscountStart:  types.StringPtr("Početak akcije"),
	DiscountEnd:    types.StringPtr("Kraj akcije"),
	Barcodes:       types.StringPtr("Barkod"),
	UnitPrice:      types.StringPtr("Cijena za jedinicu mjere"),
	LowestPrice30d: types.StringPtr("Najniža cijena u zadnjih 30 dana"),
	AnchorPrice:    types.StringPtr("Sidrena cijena"),
}

// MetroAdapter is the chain adapter for Metro retail chain
type MetroAdapter struct {
	*base.BaseCsvAdapter
}

// NewMetroAdapter creates a new Metro adapter
func NewMetroAdapter() (*MetroAdapter, error) {
	chainConfig := config.ChainConfigs[config.ChainMetro]

	adapterConfig := base.CsvAdapterConfig{
		BaseAdapterConfig: base.BaseAdapterConfig{
			Slug:           string(config.ChainMetro),
			Name:           chainConfig.Name,
			SupportedTypes: []types.FileType{types.FileTypeCSV},
			ChainConfig:    chainConfig,
			FilenamePrefixPatterns: []string{
				`(?i)^Metro[_-]?`,
				`(?i)^cjenik[_-]?`,
			},
		},
		ColumnMapping:            metroColumnMapping,
		AlternativeColumnMapping: &metroColumnMappingAlt,
	}

	baseAdapter, err := base.NewBaseCsvAdapter(adapterConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create base CSV adapter: %w", err)
	}

	return &MetroAdapter{
		BaseCsvAdapter: baseAdapter,
	}, nil
}

// Parse parses CSV content with Metro-specific preprocessing
func (a *MetroAdapter) Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error) {
	// Preprocess content to normalize dynamic column headers
	preprocessed := a.preprocessCSVContent(content)

	// Use base adapter's Parse method with preprocessed content
	return a.BaseCsvAdapter.Parse(preprocessed, filename, options)
}

// preprocessCSVContent preprocesses CSV content to normalize Metro column headers
// The SIDRENA column has a date suffix (e.g., SIDRENA_02_05) that changes
func (a *MetroAdapter) preprocessCSVContent(content []byte) []byte {
	text := string(content)

	// Normalize SIDRENA_XX_XX to SIDRENA (date suffix varies)
	text = regexp.MustCompile(`SIDRENA_\d{2}_\d{2}`).ReplaceAllString(text, "SIDRENA")

	return []byte(text)
}

// extractDateFromFilename extracts date from Metro filename
// Pattern: ..._METRO_YYYYMMDDTHHMM_...
func (a *MetroAdapter) extractDateFromFilename(filename string) *time.Time {
	match := regexp.MustCompile(`METRO_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})`).FindStringSubmatch(filename)
	if len(match) >= 6 {
		year := match[1]
		month := match[2]
		day := match[3]
		hour := match[4]
		minute := match[5]

		if t, err := time.Parse("2006-01-02 15:04", fmt.Sprintf("%s-%s-%s %s:%s", year, month, day, hour, minute)); err == nil {
			return &t
		}
	}
	return nil
}

// extractStoreCodeFromFilename extracts store code (S10, S11, etc.) from filename
func (a *MetroAdapter) extractStoreCodeFromFilename(filename string) string {
	match := regexp.MustCompile(`_S(\d+)_`).FindStringSubmatch(filename)
	if len(match) >= 2 {
		return "S" + match[1]
	}
	return ""
}

// Discover discovers available Metro price files from the portal
func (a *MetroAdapter) Discover(targetDate string) ([]types.DiscoveredFile, error) {
	// Use base class discover method
	files, err := a.BaseCsvAdapter.Discover(targetDate)
	if err != nil {
		return nil, err
	}

	// Enrich files with lastModified extracted from filename
	for i := range files {
		if date := a.extractDateFromFilename(files[i].Filename); date != nil {
			files[i].LastModified = date
		}
	}

	return files, nil
}

// ExtractStoreIdentifier extracts store identifier from Metro filename
func (a *MetroAdapter) ExtractStoreIdentifier(file types.DiscoveredFile) *types.StoreIdentifier {
	storeCode := a.extractStoreCodeFromFilename(file.Filename)
	if storeCode == "" {
		return a.BaseCsvAdapter.ExtractStoreIdentifier(file)
	}

	return &types.StoreIdentifier{
		Type:  "portal_id",
		Value: storeCode,
	}
}

// ExtractStoreIdentifierFromFilename extracts store code from Metro filename
func (a *MetroAdapter) ExtractStoreIdentifierFromFilename(filename string) string {
	return a.extractStoreCodeFromFilename(filename)
}

// ExtractStoreMetadata extracts store metadata from Metro filename
// Pattern: ..._METRO_YYYYMMDDTHHM_S{code}_{LOCATION},{CITY}.csv
func (a *MetroAdapter) ExtractStoreMetadata(file types.DiscoveredFile) *types.StoreMetadata {
	// Extract everything after S{code}_
	match := regexp.MustCompile(`_S(\d+)_(.+)\.csv$`).FindStringSubmatch(file.Filename)
	if len(match) == 0 {
		storeID := a.ExtractStoreIdentifierFromFilename(file.Filename)
		return &types.StoreMetadata{
			Name: fmt.Sprintf("Metro %s", storeID),
		}
	}

	locationPart := match[2]

	// Split by comma to separate location and city
	commaIdx := strings.LastIndex(locationPart, ",")
	if commaIdx == -1 {
		return &types.StoreMetadata{
			Name:    fmt.Sprintf("Metro %s", titleCase(strings.ReplaceAll(locationPart, "_", " "))),
			Address: titleCase(strings.ReplaceAll(locationPart, "_", " ")),
		}
	}

	address := strings.ReplaceAll(locationPart[:commaIdx], "_", " ")
	city := locationPart[commaIdx+1:]

	return &types.StoreMetadata{
		Name:    fmt.Sprintf("Metro %s", titleCase(city)),
		Address: titleCase(address),
		City:    titleCase(city),
	}
}
