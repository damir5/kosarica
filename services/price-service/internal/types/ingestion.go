package types

import "time"

// FileType represents supported file types
type FileType string

const (
	FileTypeCSV  FileType = "csv"
	FileTypeXML  FileType = "xml"
	FileTypeXLSX FileType = "xlsx"
	FileTypeZIP  FileType = "zip"
)

// NormalizedRow represents a normalized row from any chain's data source
type NormalizedRow struct {
	StoreIdentifier string     `json:"storeIdentifier"`
	ExternalID      *string    `json:"externalId,omitempty"`
	Name            string     `json:"name"`
	Description     *string    `json:"description,omitempty"`
	Category        *string    `json:"category,omitempty"`
	Subcategory     *string    `json:"subcategory,omitempty"`
	Brand           *string    `json:"brand,omitempty"`
	Unit            *string    `json:"unit,omitempty"`
	UnitQuantity    *string    `json:"unitQuantity,omitempty"`
	Price           int        `json:"price"` // cents
	DiscountPrice   *int       `json:"discountPrice,omitempty"`
	DiscountStart   *time.Time `json:"discountStart,omitempty"`
	DiscountEnd     *time.Time `json:"discountEnd,omitempty"`
	Barcodes        []string   `json:"barcodes"`
	ImageURL        *string    `json:"imageUrl,omitempty"`
	RowNumber       int        `json:"rowNumber"`
	RawData         string     `json:"rawData"`
	// Croatian transparency fields
	UnitPrice            *int       `json:"unitPrice,omitempty"`
	UnitPriceBaseQuantity *string   `json:"unitPriceBaseQuantity,omitempty"`
	UnitPriceBaseUnit    *string    `json:"unitPriceBaseUnit,omitempty"`
	LowestPrice30d       *int       `json:"lowestPrice30d,omitempty"`
	AnchorPrice          *int       `json:"anchorPrice,omitempty"`
	AnchorPriceAsOf      *time.Time `json:"anchorPriceAsOf,omitempty"`
}

// NormalizedRowValidation represents validation result for a normalized row
type NormalizedRowValidation struct {
	IsValid  bool     `json:"isValid"`
	Errors   []string `json:"errors,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
}

// StoreDescriptor represents resolved store information
type StoreDescriptor struct {
	ID         string  `json:"id"`
	ChainSlug  string  `json:"chainSlug"`
	Name       string  `json:"name"`
	Address    *string `json:"address,omitempty"`
	City       *string `json:"city,omitempty"`
	PostalCode *string `json:"postalCode,omitempty"`
	Latitude   *string `json:"latitude,omitempty"`
	Longitude  *string `json:"longitude,omitempty"`
}

// StoreIdentifier represents a store identifier with its type and value
type StoreIdentifier struct {
	Type  string `json:"type"`  // 'filename_code', 'portal_id', 'internal_id', etc.
	Value string `json:"value"` // The identifier value
}

// StoreMetadata represents metadata extracted from file for auto-registering stores
type StoreMetadata struct {
	Name      string `json:"name"`                // Store name
	Address   string `json:"address,omitempty"`   // Street address
	City      string `json:"city,omitempty"`      // City name
	PostalCode string `json:"postalCode,omitempty"` // Postal/ZIP code
	StoreType string `json:"storeType,omitempty"` // 'SUPERMARKET', 'HIPERMARKET', etc.
}

// StoreResolutionResult represents result of store resolution attempt
type StoreResolutionResult struct {
	Found               bool              `json:"found"`
	Store               *StoreDescriptor  `json:"store,omitempty"`
	MatchedIdentifier   *StoreIdentifier  `json:"matchedIdentifier,omitempty"`
	AttemptedIdentifiers []StoreIdentifier `json:"attemptedIdentifiers,omitempty"`
}

// DiscoveredFile represents a discovered file from a chain's data source
type DiscoveredFile struct {
	URL          string            `json:"url"`
	Filename     string            `json:"filename"`
	Type         FileType          `json:"type"`
	Size         *int              `json:"size,omitempty"`
	LastModified *time.Time        `json:"lastModified,omitempty"`
	Metadata     map[string]string `json:"metadata,omitempty"`
}

// FetchedFile represents a fetched file
type FetchedFile struct {
	Discovered DiscoveredFile `json:"discovered"`
	Content   []byte         `json:"content"`
	Hash      string         `json:"hash"`
}

// ExpandedFile represents a file expanded from a ZIP archive
type ExpandedFile struct {
	Parent       DiscoveredFile `json:"parent"`
	InnerFilename string         `json:"innerFilename"`
	Type         FileType       `json:"type"`
	Content      []byte         `json:"content"`
	Hash         string         `json:"hash"`
}

// ParseOptions represents options for parsing
type ParseOptions struct {
	SkipInvalid *bool `json:"skipInvalid,omitempty"`
	Limit       *int  `json:"limit,omitempty"`
}

// ParseError represents a parsing error
type ParseError struct {
	RowNumber   *int    `json:"rowNumber,omitempty"`
	Field       *string `json:"field,omitempty"`
	Message     string  `json:"message"`
	OriginalValue *string `json:"originalValue,omitempty"`
}

// ParseWarning represents a parsing warning
type ParseWarning struct {
	RowNumber *int    `json:"rowNumber,omitempty"`
	Field     *string `json:"field,omitempty"`
	Message   string  `json:"message"`
}

// ParseResult represents result of parsing
type ParseResult struct {
	Rows      []NormalizedRow `json:"rows"`
	Errors    []ParseError    `json:"errors,omitempty"`
	Warnings  []ParseWarning  `json:"warnings,omitempty"`
	TotalRows int             `json:"totalRows"`
	ValidRows int             `json:"validRows"`
}

// IngestionSource represents source of an ingestion run
type IngestionSource string

const (
	SourceCLI       IngestionSource = "cli"
	SourceWorker    IngestionSource = "worker"
	SourceScheduled IngestionSource = "scheduled"
)

// IngestionStatus represents status of an ingestion run
type IngestionStatus string

const (
	StatusPending   IngestionStatus = "pending"
	StatusRunning   IngestionStatus = "running"
	StatusCompleted IngestionStatus = "completed"
	StatusFailed    IngestionStatus = "failed"
)

// FileStatus represents status of an ingestion file
type FileStatus string

const (
	FileStatusPending    FileStatus = "pending"
	FileStatusProcessing FileStatus = "processing"
	FileStatusCompleted  FileStatus = "completed"
	FileStatusFailed     FileStatus = "failed"
)

// ErrorSeverity represents severity levels
type ErrorSeverity string

const (
	SeverityWarning  ErrorSeverity = "warning"
	SeverityError    ErrorSeverity = "error"
	SeverityCritical ErrorSeverity = "critical"
)

// IngestionErrorType represents error types for ingestion errors
type IngestionErrorType string

const (
	ErrorTypeParse           IngestionErrorType = "parse"
	ErrorTypeValidation      IngestionErrorType = "validation"
	ErrorTypeStoreResolution IngestionErrorType = "store_resolution"
	ErrorTypePersist         IngestionErrorType = "persist"
	ErrorTypeFetch           IngestionErrorType = "fetch"
	ErrorTypeExpand          IngestionErrorType = "expand"
	ErrorTypeUnknown         IngestionErrorType = "unknown"
)

// StringPtr returns a pointer to the given string
func StringPtr(s string) *string {
	return &s
}

// IntPtr returns a pointer to the given int
func IntPtr(i int) *int {
	return &i
}

// TimePtr returns a pointer to the given time
func TimePtr(t time.Time) *time.Time {
	return &t
}

// BoolPtr returns a pointer to the given bool
func BoolPtr(b bool) *bool {
	return &b
}
