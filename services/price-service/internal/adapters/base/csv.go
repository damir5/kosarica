package base

import (
	"regexp"

	_ "github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/parsers/csv"
	"github.com/kosarica/price-service/internal/types"
)

// CsvAdapterConfig contains configuration for CSV-based chain adapters
type CsvAdapterConfig struct {
	BaseAdapterConfig
	ColumnMapping           csv.CsvColumnMapping
	AlternativeColumnMapping *csv.CsvColumnMapping
}

// BaseCsvAdapter provides common CSV parsing logic
type BaseCsvAdapter struct {
	*BaseChainAdapter
	csvParser        *csv.Parser
	columnMapping    csv.CsvColumnMapping
	altMapping       *csv.CsvColumnMapping
}

// NewBaseCsvAdapter creates a new base CSV adapter
func NewBaseCsvAdapter(cfg CsvAdapterConfig) (*BaseCsvAdapter, error) {
	// Set CSV file extension pattern
	if cfg.FileExtensionPattern == nil {
		cfg.FileExtensionPattern = regexp.MustCompile(`\.(csv|CSV)$`)
	}

	// Create base adapter
	base, err := NewBaseChainAdapter(cfg.BaseAdapterConfig)
	if err != nil {
		return nil, err
	}

	// Validate CSV config exists
	if cfg.ChainConfig.CSV == nil {
		return nil, &AdapterError{
			Chain: cfg.Name,
			Msg:   "CSV adapter requires CSV configuration",
		}
	}

	// Create CSV parser
	csvConfig := cfg.ChainConfig.CSV
	parserOptions := csv.CsvParserOptions{
		Delimiter:     csvConfig.Delimiter,
		Encoding:      csvConfig.Encoding,
		HasHeader:     csvConfig.HasHeader,
		ColumnMapping: &cfg.ColumnMapping,
		SkipEmptyRows: true,
		QuoteChar:     '"',
	}

	csvParser := csv.NewParser(parserOptions)
	if cfg.AlternativeColumnMapping != nil {
		csvParser.SetAlternativeMapping(cfg.AlternativeColumnMapping)
	}

	return &BaseCsvAdapter{
		BaseChainAdapter: base,
		csvParser:        csvParser,
		columnMapping:    cfg.ColumnMapping,
		altMapping:       cfg.AlternativeColumnMapping,
	}, nil
}

// Parse parses CSV content into normalized rows
// Tries primary column mapping first, then alternative if no valid rows
func (a *BaseCsvAdapter) Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error) {
	// Preprocess content (can be overridden by subclasses)
	processedContent := a.preprocessContent(content)

	// Extract store identifier from filename
	storeIdentifier := a.extractStoreIdentifierFromFilename(filename)

	// Parse with store identifier
	// The parser handles alternative mapping internally if no valid rows found
	result, err := a.csvParser.ParseWithStoreID(processedContent, storeIdentifier)
	if err != nil {
		return nil, err
	}

	// Post-process results
	return a.postprocessResult(result), nil
}

// preprocessContent preprocesses content before parsing
// Can be overridden by subclasses
func (a *BaseCsvAdapter) preprocessContent(content []byte) []byte {
	return content
}

// postprocessResult post-processes parse result
// Can be overridden by subclasses
func (a *BaseCsvAdapter) postprocessResult(result *types.ParseResult) *types.ParseResult {
	return result
}

// GetColumnMapping returns the primary column mapping
func (a *BaseCsvAdapter) GetColumnMapping() csv.CsvColumnMapping {
	return a.columnMapping
}

// GetAlternativeMapping returns the alternative column mapping
func (a *BaseCsvAdapter) GetAlternativeMapping() *csv.CsvColumnMapping {
	return a.altMapping
}

// AdapterError represents an adapter-specific error
type AdapterError struct {
	Chain string
	Msg   string
}

func (e *AdapterError) Error() string {
	return e.Chain + ": " + e.Msg
}
