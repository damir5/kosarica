package chains

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/kosarica/price-service/internal/adapters/base"
	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/parsers/xlsx"
	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog/log"
)

const (
	// DM portal URL where the price list is published
	dmPortalURL = "https://www.dm.hr/novo/promocije/nove-oznake-cijena-i-vazeci-cjenik-u-dm-u-2906632"

	// Direct URL to the DM price list Excel file on their content server
	dmPriceListURL = "https://content.services.dmtech.com/rootpage-dm-shop-hr-hr/resource/blob/3245770/0a2d2d47073cad06c1f3a8d4fbba2e50/vlada-oznacavanje-cijena-cijenik-236-data.xlsx"

	// DM national store identifier (uniform pricing across all stores)
	dmNationalStoreIdentifier = "dm_national"
)

// dmWebColumnMapping is the column mapping for DM web XLSX files
// Uses numeric indices because the web format has:
// - Row 0: Title row
// - Row 1: Empty row
// - Row 2: Headers (with one null/empty header for šifra column)
// - Row 3+: Data
//
// Web format columns:
// 0: naziv (name)
// 1: šifra (product code) - column header is null/empty
// 2: marka (brand)
// 3: barkod (barcode)
// 4: kategorija proizvoda (category)
// 5: neto količina (quantity)
// 6: Jedinica mjere (unit)
// 7: Cijena za jedinicu mjere (unit price)
// 8: dostupno samo online (online only flag - ignored)
// 9: MPC (regular price)
// 10: MPC za vrijeme posebnog oblika prodaje (discount/clearance price)
// 11: Najniža cijena u posljednjih 30 dana (lowest price in 30 days)
// 12: sidrena cijena (anchor price)
var dmWebColumnMapping = xlsx.XlsxColumnMapping{
	Name:          xlsx.NewNumericIndex(0),
	ExternalID:    ptr(xlsx.NewNumericIndex(1)),
	Brand:         ptr(xlsx.NewNumericIndex(2)),
	Barcodes:      ptr(xlsx.NewNumericIndex(3)),
	Category:      ptr(xlsx.NewNumericIndex(4)),
	UnitQuantity:  ptr(xlsx.NewNumericIndex(5)),
	Unit:          ptr(xlsx.NewNumericIndex(6)),
	UnitPrice:     ptr(xlsx.NewNumericIndex(7)),
	// Column 8 is "dostupno samo online" - ignored
	Price:         xlsx.NewNumericIndex(9),
	DiscountPrice: ptr(xlsx.NewNumericIndex(10)),
	LowestPrice30d: ptr(xlsx.NewNumericIndex(11)),
	AnchorPrice:   ptr(xlsx.NewNumericIndex(12)),
}

// dmLocalColumnMapping is the column mapping for local DM XLSX files (legacy/test format)
// Maps DM's Croatian column names to NormalizedRow fields
var dmLocalColumnMapping = xlsx.XlsxColumnMapping{
	ExternalID:            ptr(xlsx.NewHeaderIndex("Šifra")),
	Name:                  xlsx.NewHeaderIndex("Naziv"),
	Category:              ptr(xlsx.NewHeaderIndex("Kategorija")),
	Brand:                 ptr(xlsx.NewHeaderIndex("Marka")),
	Unit:                  ptr(xlsx.NewHeaderIndex("Mjerna jedinica")),
	UnitQuantity:          ptr(xlsx.NewHeaderIndex("Količina")),
	Price:                 xlsx.NewHeaderIndex("Cijena"),
	DiscountPrice:         ptr(xlsx.NewHeaderIndex("Akcijska cijena")),
	DiscountStart:         ptr(xlsx.NewHeaderIndex("Početak akcije")),
	DiscountEnd:           ptr(xlsx.NewHeaderIndex("Kraj akcije")),
	Barcodes:              ptr(xlsx.NewHeaderIndex("Barkod")),
	UnitPrice:             ptr(xlsx.NewHeaderIndex("Cijena za jedinicu mjere")),
	LowestPrice30d:        ptr(xlsx.NewHeaderIndex("Najniža cijena u zadnjih 30 dana")),
	AnchorPrice:           ptr(xlsx.NewHeaderIndex("Sidrena cijena")),
	UnitPriceBaseQuantity: ptr(xlsx.NewHeaderIndex("Količina za jedinicu mjere")),
	UnitPriceBaseUnit:     ptr(xlsx.NewHeaderIndex("Jedinica mjere za cijenu")),
	AnchorPriceAsOf:       ptr(xlsx.NewHeaderIndex("Datum sidrene cijene")),
}

// dmLocalColumnMappingAlt is the alternative column mapping for local DM XLSX files
// Some DM exports may use abbreviated or different column names
var dmLocalColumnMappingAlt = xlsx.XlsxColumnMapping{
	ExternalID:            ptr(xlsx.NewHeaderIndex("Sifra")),
	Name:                  xlsx.NewHeaderIndex("Naziv artikla"),
	Category:              ptr(xlsx.NewHeaderIndex("Kategorija")),
	Brand:                 ptr(xlsx.NewHeaderIndex("Marka")),
	Unit:                  ptr(xlsx.NewHeaderIndex("JM")),
	UnitQuantity:          ptr(xlsx.NewHeaderIndex("Kolicina")),
	Price:                 xlsx.NewHeaderIndex("Cijena"),
	DiscountPrice:         ptr(xlsx.NewHeaderIndex("Akcija")),
	DiscountStart:         ptr(xlsx.NewHeaderIndex("Pocetak akcije")),
	DiscountEnd:           ptr(xlsx.NewHeaderIndex("Kraj akcije")),
	Barcodes:              ptr(xlsx.NewHeaderIndex("EAN")),
	UnitPrice:             ptr(xlsx.NewHeaderIndex("Cijena za jedinicu mjere")),
	LowestPrice30d:        ptr(xlsx.NewHeaderIndex("Najniza cijena u zadnjih 30 dana")),
	AnchorPrice:           ptr(xlsx.NewHeaderIndex("Sidrena cijena")),
	UnitPriceBaseQuantity: ptr(xlsx.NewHeaderIndex("Kolicina za JM")),
	UnitPriceBaseUnit:     ptr(xlsx.NewHeaderIndex("JM za cijenu")),
	AnchorPriceAsOf:       ptr(xlsx.NewHeaderIndex("Datum sidrene cijene")),
}

// ptr is a helper function to get a pointer to an XlsxColumnIndex
func ptr(idx xlsx.XlsxColumnIndex) *xlsx.XlsxColumnIndex {
	return &idx
}

// DmAdapter is the chain adapter for DM retail chain
type DmAdapter struct {
	*base.BaseXlsxAdapter
	discoveryDate string // Date to filter discovery (YYYY-MM-DD format)
}

// NewDmAdapter creates a new DM adapter
func NewDmAdapter() (*DmAdapter, error) {
	chainConfig := config.ChainConfigs[config.ChainDm]

	adapterConfig := base.XlsxAdapterConfig{
		BaseAdapterConfig: base.BaseAdapterConfig{
			Slug:           string(config.ChainDm),
			Name:           chainConfig.Name,
			SupportedTypes: []types.FileType{types.FileTypeXLSX},
			ChainConfig:    chainConfig,
			FilenamePrefixPatterns: []string{
				`(?i)^DM[_-]?`,
				`(?i)^dm[_-]?`,
				`(?i)^cjenik[_-]?`,
				`(?i)^vlada-oznacavanje`,
			},
		},
		ColumnMapping:            dmWebColumnMapping,
		AlternativeColumnMapping: &dmLocalColumnMapping,
		HasHeader:                false, // Web format uses index-based mapping, skip header detection
		HeaderRowCount:           3,     // Skip title row, empty row, and header row
		DefaultStoreIdentifier:   dmNationalStoreIdentifier,
	}

	baseAdapter, err := base.NewBaseXlsxAdapter(adapterConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create base XLSX adapter: %w", err)
	}

	return &DmAdapter{
		BaseXlsxAdapter: baseAdapter,
	}, nil
}

// SetDiscoveryDate sets the date to filter discovery results
// Date should be in YYYY-MM-DD format
func (a *DmAdapter) SetDiscoveryDate(date string) {
	a.discoveryDate = date
}

// Discover discovers available DM price files
// Primary: Fetches current price list from DM web portal
// Fallback: Searches local data directory for files matching date pattern
func (a *DmAdapter) Discover(targetDate string) ([]types.DiscoveredFile, error) {
	discoveredFiles := make([]types.DiscoveredFile, 0)
	date := targetDate
	if date == "" && a.discoveryDate != "" {
		date = a.discoveryDate
	}
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}

	// Primary: Try to discover from web
	log.Info().Msg("Discovering DM price list from web portal")

	resp, err := a.HTTPClient().Get(dmPriceListURL)
	if err == nil && resp.StatusCode == 200 {
		defer resp.Body.Close()
		// Discard body since we only need headers
		_, _ = io.Copy(io.Discard, resp.Body)

		contentLength := resp.Header.Get("Content-Length")
		lastModified := resp.Header.Get("Last-Modified")

		// Extract filename from URL
		urlParts := strings.Split(dmPriceListURL, "/")
		urlFilename := "dm-cjenik.xlsx"
		if len(urlParts) > 0 {
			urlFilename = urlParts[len(urlParts)-1]
		}

		var size *int
		if contentLength != "" {
			var s int
			fmt.Sscanf(contentLength, "%d", &s)
			if s > 0 {
				size = &s
			}
		}

		var modTime *time.Time
		if lastModified != "" {
			if t, err := time.Parse(time.RFC1123, lastModified); err == nil {
				modTime = &t
			}
		}
		if modTime == nil {
			now := time.Now()
			modTime = &now
		}

		discoveredFiles = append(discoveredFiles, types.DiscoveredFile{
			URL:          dmPriceListURL,
			Filename:     urlFilename,
			Type:         types.FileTypeXLSX,
			Size:         size,
			LastModified: modTime,
			Metadata: map[string]string{
				"source":       "dm_web",
				"discoveredAt": time.Now().Format(time.RFC3339),
				"portalUrl":    dmPortalURL,
				"portalDate":   date,
			},
		})

		log.Info().Str("filename", urlFilename).Msg("Found DM price list")
		return discoveredFiles, nil
	}

	if err != nil {
		log.Warn().Err(err).Msg("Failed to access DM web portal")
	} else if resp != nil {
		log.Warn().Int("status_code", resp.StatusCode).Msg("DM web portal returned non-200, falling back to local files")
		resp.Body.Close()
	}
	log.Warn().Msg("Falling back to local files")

	// Fallback: Look for local files in ./data/ingestion/dm/ directory
	dataDir := filepath.Join(".", "data", "ingestion", "dm")
	log.Debug().Str("directory", dataDir).Msg("Scanning DM local directory")

	if _, err := os.Stat(dataDir); os.IsNotExist(err) {
		log.Warn().Str("directory", dataDir).Msg("DM data directory not found")
		return discoveredFiles, nil
	}

	entries, err := os.ReadDir(dataDir)
	if err != nil {
		log.Error().Err(err).Msg("Error reading DM data directory")
		return discoveredFiles, nil
	}

	// Match DM filename patterns: dm_YYYY-MM-DD.xlsx or DM_YYYY-MM-DD.xlsx
	filenamePattern := regexp.MustCompile(`^(dm|DM)[_-](\d{4}-\d{2}-\d{2})\.(xlsx|xls)$`)

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filename := entry.Name()
		match := filenamePattern.FindStringSubmatch(filename)
		if match == nil {
			continue
		}

		fileDate := match[2]

		// Filter by discovery date if set
		if date != "" && fileDate != date {
			continue
		}

		filePath := filepath.Join(dataDir, filename)
		info, err := entry.Info()
		if err != nil {
			continue
		}

		size := int(info.Size())

		// Parse date from filename
		var lastModified *time.Time
		if t, err := time.Parse("2006-01-02", fileDate); err == nil {
			lastModified = &t
		}

		discoveredFiles = append(discoveredFiles, types.DiscoveredFile{
			URL:          "file://" + filePath,
			Filename:     filename,
			Type:         types.FileTypeXLSX,
			Size:         &size,
			LastModified: lastModified,
			Metadata: map[string]string{
				"source":       "dm_local",
				"discoveredAt": time.Now().Format(time.RFC3339),
				"portalDate":   fileDate,
			},
		})
	}

	return discoveredFiles, nil
}

// Fetch fetches a discovered DM file
// For local files (file:// URLs), reads directly from filesystem
func (a *DmAdapter) Fetch(file types.DiscoveredFile) (*types.FetchedFile, error) {
	if strings.HasPrefix(file.URL, "file://") {
		filePath := strings.TrimPrefix(file.URL, "file://")
		f, err := os.Open(filePath)
		if err != nil {
			return nil, fmt.Errorf("failed to open local file: %w", err)
		}
		defer f.Close()

		content, err := io.ReadAll(f)
		if err != nil {
			return nil, fmt.Errorf("failed to read local file: %w", err)
		}

		hash := computeHash(content)

		return &types.FetchedFile{
			Discovered: file,
			Content:    content,
			Hash:       hash,
		}, nil
	}

	// Fall back to base class implementation for remote URLs
	return a.BaseXlsxAdapter.BaseChainAdapter.Fetch(file)
}

// Parse parses DM XLSX content into normalized rows
// Automatically detects file format (web vs local) based on filename pattern
func (a *DmAdapter) Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error) {
	storeIdentifier := dmNationalStoreIdentifier

	// Detect if this is a web format file (from content.services.dmtech.com)
	isWebFormat := strings.Contains(filename, "vlada-oznacavanje") || strings.Contains(filename, "cijenik-")

	if isWebFormat {
		// Web format: uses numeric column indices, has 3 header rows to skip
		a.SetParserOptions(xlsx.XlsxParserOptions{
			ColumnMapping:          &dmWebColumnMapping,
			HasHeader:              false,
			HeaderRowCount:         3, // Skip title row, empty row, and header row
			DefaultStoreIdentifier: storeIdentifier,
			SkipEmptyRows:          true,
		})

		return a.BaseXlsxAdapter.Parse(content, filename, options)
	}

	// Local format: uses Croatian column names with standard header
	a.SetParserOptions(xlsx.XlsxParserOptions{
		ColumnMapping:          &dmLocalColumnMapping,
		HasHeader:              true,
		HeaderRowCount:         0,
		DefaultStoreIdentifier: storeIdentifier,
		SkipEmptyRows:          true,
	})

	result, err := a.BaseXlsxAdapter.Parse(content, filename, options)
	if err != nil {
		return nil, err
	}

	// If no valid rows, try alternative column mapping
	if result.ValidRows == 0 && len(result.Errors) > 0 {
		a.SetParserOptions(xlsx.XlsxParserOptions{
			ColumnMapping:          &dmLocalColumnMappingAlt,
			HasHeader:              true,
			HeaderRowCount:         0,
			DefaultStoreIdentifier: storeIdentifier,
			SkipEmptyRows:          true,
		})
		result, err = a.BaseXlsxAdapter.Parse(content, filename, options)
	}

	return result, err
}

// ExtractStoreIdentifier extracts store identifier for DM
// DM has national pricing, so always returns the national identifier
func (a *DmAdapter) ExtractStoreIdentifier(file types.DiscoveredFile) *types.StoreIdentifier {
	// DM has uniform national pricing - no per-store variation
	return &types.StoreIdentifier{
		Type:  "national",
		Value: dmNationalStoreIdentifier,
	}
}

// ExtractStoreMetadata extracts store metadata for DM
func (a *DmAdapter) ExtractStoreMetadata(file types.DiscoveredFile) *types.StoreMetadata {
	return &types.StoreMetadata{
		Name:      "DM National",
		StoreType: "national",
	}
}

// computeHash computes SHA-256 hash of content
func computeHash(content []byte) string {
	hash := sha256.Sum256(content)
	return hex.EncodeToString(hash[:])
}
