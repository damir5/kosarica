package base

import (
	"regexp"

	"github.com/kosarica/price-service/internal/parsers/xlsx"
	"github.com/kosarica/price-service/internal/types"
)

// XlsxAdapterConfig contains configuration for XLSX-based chain adapters
type XlsxAdapterConfig struct {
	BaseAdapterConfig
	ColumnMapping            xlsx.XlsxColumnMapping
	AlternativeColumnMapping *xlsx.XlsxColumnMapping
	// HasHeader indicates whether the first data row is a header
	HasHeader bool
	// HeaderRowCount is the number of rows to skip before data starts
	HeaderRowCount int
	// DefaultStoreIdentifier is used if not found in spreadsheet
	DefaultStoreIdentifier string
}

// BaseXlsxAdapter provides common XLSX parsing logic
type BaseXlsxAdapter struct {
	*BaseChainAdapter
	xlsxParser               *xlsx.Parser
	columnMapping            xlsx.XlsxColumnMapping
	altMapping               *xlsx.XlsxColumnMapping
	hasHeader                bool
	headerRowCount           int
	defaultStoreIdentifier   string
}

// NewBaseXlsxAdapter creates a new base XLSX adapter
func NewBaseXlsxAdapter(cfg XlsxAdapterConfig) (*BaseXlsxAdapter, error) {
	// Set XLSX file extension pattern
	if cfg.FileExtensionPattern == nil {
		cfg.FileExtensionPattern = regexp.MustCompile(`\.(xlsx|xls|XLSX|XLS)$`)
	}

	// Create base adapter
	base, err := NewBaseChainAdapter(cfg.BaseAdapterConfig)
	if err != nil {
		return nil, err
	}

	// Create XLSX parser
	parserOptions := xlsx.XlsxParserOptions{
		ColumnMapping:          &cfg.ColumnMapping,
		HasHeader:              cfg.HasHeader,
		HeaderRowCount:         cfg.HeaderRowCount,
		DefaultStoreIdentifier: cfg.DefaultStoreIdentifier,
		SkipEmptyRows:          true,
	}

	xlsxParser := xlsx.NewParser(parserOptions)
	if cfg.AlternativeColumnMapping != nil {
		xlsxParser.SetAlternativeMapping(cfg.AlternativeColumnMapping)
	}

	return &BaseXlsxAdapter{
		BaseChainAdapter:       base,
		xlsxParser:             xlsxParser,
		columnMapping:          cfg.ColumnMapping,
		altMapping:             cfg.AlternativeColumnMapping,
		hasHeader:              cfg.HasHeader,
		headerRowCount:         cfg.HeaderRowCount,
		defaultStoreIdentifier: cfg.DefaultStoreIdentifier,
	}, nil
}

// Parse parses XLSX content into normalized rows
// Tries primary column mapping first, then alternative if no valid rows
func (a *BaseXlsxAdapter) Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error) {
	// Preprocess content (can be overridden by subclasses)
	processedContent := a.preprocessContent(content)

	// Get store identifier - prefer default if set (e.g., for national pricing)
	// Only fall back to filename extraction if no default is configured
	storeIdentifier := a.defaultStoreIdentifier
	if storeIdentifier == "" {
		storeIdentifier = a.extractStoreIdentifierFromFilename(filename)
	}

	// Parse with store identifier
	result, err := a.xlsxParser.ParseWithStoreID(processedContent, storeIdentifier)
	if err != nil {
		return nil, err
	}

	// Post-process results
	return a.postprocessResult(result), nil
}

// preprocessContent preprocesses content before parsing
// Can be overridden by subclasses
func (a *BaseXlsxAdapter) preprocessContent(content []byte) []byte {
	return content
}

// postprocessResult post-processes parse result
// Can be overridden by subclasses
func (a *BaseXlsxAdapter) postprocessResult(result *types.ParseResult) *types.ParseResult {
	return result
}

// GetColumnMapping returns the primary column mapping
func (a *BaseXlsxAdapter) GetColumnMapping() xlsx.XlsxColumnMapping {
	return a.columnMapping
}

// GetAlternativeMapping returns the alternative column mapping
func (a *BaseXlsxAdapter) GetAlternativeMapping() *xlsx.XlsxColumnMapping {
	return a.altMapping
}

// SetParserOptions updates the parser options
func (a *BaseXlsxAdapter) SetParserOptions(options xlsx.XlsxParserOptions) {
	a.xlsxParser.SetOptions(options)
}

// extractStoreIdentifierFromFilename extracts store identifier string from filename
func (a *BaseXlsxAdapter) extractStoreIdentifierFromFilename(filename string) string {
	baseName := a.fileExtensionPattern.ReplaceAllString(filename, "")

	cleanName := baseName
	for _, pattern := range a.filenamePrefixPatterns {
		cleanName = pattern.ReplaceAllString(cleanName, "")
	}

	cleanName = trimWhitespace(cleanName)

	if cleanName == "" {
		return a.fileExtensionPattern.ReplaceAllString(filename, "")
	}

	return cleanName
}

// trimWhitespace trims whitespace from string
func trimWhitespace(s string) string {
	return regexp.MustCompile(`^\s+|\s+$`).ReplaceAllString(s, "")
}
