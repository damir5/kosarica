package base

import (
	"regexp"
	"strings"

	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/parsers/xml"
	"github.com/kosarica/price-service/internal/types"
)

// XmlAdapterConfig contains configuration for XML-based chain adapters
type XmlAdapterConfig struct {
	BaseAdapterConfig
	FieldMapping           xml.XmlFieldMapping
	AlternativeFieldMapping *xml.XmlFieldMapping
	DefaultItemsPath       string
	ItemPaths              []string
}

// BaseXmlAdapter provides common XML parsing logic
type BaseXmlAdapter struct {
	*BaseChainAdapter
	fieldMapping    xml.XmlFieldMapping
	altMapping      *xml.XmlFieldMapping
	itemPaths       []string
}

// NewBaseXmlAdapter creates a new base XML adapter
func NewBaseXmlAdapter(cfg XmlAdapterConfig) (*BaseXmlAdapter, error) {
	// Set XML file extension pattern
	if cfg.FileExtensionPattern == nil {
		cfg.FileExtensionPattern = regexp.MustCompile(`\.(xml|XML)$`)
	}

	// Create base adapter
	base, err := NewBaseChainAdapter(cfg.BaseAdapterConfig)
	if err != nil {
		return nil, err
	}

	// Set default item paths if not provided
	itemPaths := cfg.ItemPaths
	if len(itemPaths) == 0 {
		itemPaths = []string{
			"products.product",
			"Products.Product",
			"items.item",
			"Items.Item",
			"data.product",
			"Data.Product",
			"Cjenik.Proizvod",
			"cjenik.proizvod",
		}
	}

	return &BaseXmlAdapter{
		BaseChainAdapter: base,
		fieldMapping:     cfg.FieldMapping,
		altMapping:       cfg.AlternativeFieldMapping,
		itemPaths:        itemPaths,
	}, nil
}

// Parse parses XML content into normalized rows
// Tries multiple item paths and field mappings to find valid data
func (a *BaseXmlAdapter) Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error) {
	// Extract store identifier from filename
	storeIdentifier := a.extractStoreIdentifierFromFilename(filename)

	var lastErr error

	// Try with primary field mapping first
	for _, itemsPath := range a.itemPaths {
		result, err := a.parseWithItemsPath(content, itemsPath, a.fieldMapping, storeIdentifier)
		if err != nil {
			lastErr = err
			continue
		}
		if result.ValidRows > 0 {
			return result, nil
		}
	}

	// Try alternative field mapping if available
	if a.altMapping != nil {
		for _, itemsPath := range a.itemPaths {
			result, err := a.parseWithItemsPath(content, itemsPath, *a.altMapping, storeIdentifier)
			if err != nil {
				lastErr = err
				continue
			}
			if result.ValidRows > 0 {
				return result, nil
			}
		}
	}

	// Return error if all attempts failed
	if lastErr != nil {
		return nil, lastErr
	}

	// Return empty result as fallback
	return &types.ParseResult{
		Rows:      []types.NormalizedRow{},
		Errors:    []types.ParseError{},
		Warnings:  []types.ParseWarning{},
		TotalRows: 0,
		ValidRows: 0,
	}, nil
}

// parseWithItemsPath attempts to parse XML with specific items path and field mapping
func (a *BaseXmlAdapter) parseWithItemsPath(content []byte, itemsPath string, fieldMapping xml.XmlFieldMapping, storeIdentifier string) (*types.ParseResult, error) {
	// XML parsing will be fully implemented in Phase 7
	// For now, return a not-implemented error to avoid silent success
	return nil, &AdapterError{
		Chain: a.name,
		Msg:   "XML parsing not yet implemented - see Phase 7",
	}
}

// ExtractStoreIdentifier extracts store identifier from XML file
// For XML files, store ID is typically embedded in content or filename
func (a *BaseXmlAdapter) ExtractStoreIdentifier(file types.DiscoveredFile) *types.StoreIdentifier {
	// Try to extract from metadata if set during discovery
	if storeID, ok := file.Metadata["storeId"]; ok && storeID != "" {
		return &types.StoreIdentifier{
			Type:  "portal_id",
			Value: storeID,
		}
	}

	// Try to extract from filename as fallback
	identifier := a.extractStoreIdentifierFromFilename(file.Filename)
	if identifier != "" {
		return &types.StoreIdentifier{
			Type:  "filename_code",
			Value: identifier,
		}
	}

	return nil
}

// extractStoreIdentifierFromFilename extracts store identifier from XML filename
// Handles XML-specific patterns like "store_123" or "poslovnica_456"
func (a *BaseXmlAdapter) extractStoreIdentifierFromFilename(filename string) string {
	baseName := a.fileExtensionPattern.ReplaceAllString(filename, "")

	cleanName := baseName
	for _, pattern := range a.filenamePrefixPatterns {
		cleanName = pattern.ReplaceAllString(cleanName, "")
	}
	cleanName = strings.TrimSpace(cleanName)

	// Try to extract store ID from patterns like "store_123" or "poslovnica_456"
	storeIdPatterns := []string{
		`(?:store|poslovnica|trgovina)[_-]?(\d+)`,
		`(?:store|poslovnica|trgovina)[_-]?([A-Za-z0-9]+)`,
	}

	for _, pattern := range storeIdPatterns {
		re := regexp.MustCompile(pattern)
		if match := re.FindStringSubmatch(cleanName); len(match) > 1 {
			return match[1]
		}
	}

	if cleanName == "" {
		return a.fileExtensionPattern.ReplaceAllString(filename, "")
	}

	return cleanName
}

// GetFieldMapping returns the primary field mapping
func (a *BaseXmlAdapter) GetFieldMapping() xml.XmlFieldMapping {
	return a.fieldMapping
}

// GetAlternativeMapping returns the alternative field mapping
func (a *BaseXmlAdapter) GetAlternativeMapping() *xml.XmlFieldMapping {
	return a.altMapping
}

// GetItemPaths returns the item paths to try
func (a *BaseXmlAdapter) GetItemPaths() []string {
	return a.itemPaths
}
