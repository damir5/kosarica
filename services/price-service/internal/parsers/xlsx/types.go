package xlsx

// XlsxColumnIndex represents a column index that can be either numeric (for web format) or string (for header name)
type XlsxColumnIndex struct {
	// Index is the numeric column index (0-based)
	Index *int
	// Header is the header name to match
	Header *string
}

// NewNumericIndex creates a column index from a numeric position
func NewNumericIndex(index int) XlsxColumnIndex {
	return XlsxColumnIndex{Index: &index}
}

// NewHeaderIndex creates a column index from a header name
func NewHeaderIndex(header string) XlsxColumnIndex {
	return XlsxColumnIndex{Header: &header}
}

// IsNumeric returns true if this is a numeric index
func (c XlsxColumnIndex) IsNumeric() bool {
	return c.Index != nil
}

// IsHeader returns true if this is a header-based index
func (c XlsxColumnIndex) IsHeader() bool {
	return c.Header != nil
}

// XlsxColumnMapping maps NormalizedRow field names to XLSX column indices or header names
// Supports both numeric indices (for web format) and header names (for local format)
type XlsxColumnMapping struct {
	StoreIdentifier       *XlsxColumnIndex `json:"storeIdentifier,omitempty"`
	ExternalID            *XlsxColumnIndex `json:"externalId,omitempty"`
	Name                  XlsxColumnIndex  `json:"name"` // Required
	Description           *XlsxColumnIndex `json:"description,omitempty"`
	Category              *XlsxColumnIndex `json:"category,omitempty"`
	Subcategory           *XlsxColumnIndex `json:"subcategory,omitempty"`
	Brand                 *XlsxColumnIndex `json:"brand,omitempty"`
	Unit                  *XlsxColumnIndex `json:"unit,omitempty"`
	UnitQuantity          *XlsxColumnIndex `json:"unitQuantity,omitempty"`
	Price                 XlsxColumnIndex  `json:"price"` // Required
	DiscountPrice         *XlsxColumnIndex `json:"discountPrice,omitempty"`
	DiscountStart         *XlsxColumnIndex `json:"discountStart,omitempty"`
	DiscountEnd           *XlsxColumnIndex `json:"discountEnd,omitempty"`
	Barcodes              *XlsxColumnIndex `json:"barcodes,omitempty"`
	ImageURL              *XlsxColumnIndex `json:"imageUrl,omitempty"`
	UnitPrice             *XlsxColumnIndex `json:"unitPrice,omitempty"`
	UnitPriceBaseQuantity *XlsxColumnIndex `json:"unitPriceBaseQuantity,omitempty"`
	UnitPriceBaseUnit     *XlsxColumnIndex `json:"unitPriceBaseUnit,omitempty"`
	LowestPrice30d        *XlsxColumnIndex `json:"lowestPrice30d,omitempty"`
	AnchorPrice           *XlsxColumnIndex `json:"anchorPrice,omitempty"`
	AnchorPriceAsOf       *XlsxColumnIndex `json:"anchorPriceAsOf,omitempty"`
}

// XlsxParserOptions represents XLSX parser options
type XlsxParserOptions struct {
	// ColumnMapping is the mapping configuration
	ColumnMapping *XlsxColumnMapping `json:"columnMapping,omitempty"`
	// HasHeader indicates whether the first data row is a header
	HasHeader bool `json:"hasHeader,omitempty"`
	// HeaderRowCount is the number of rows to skip before data starts (default: 0, or 1 if hasHeader is true)
	HeaderRowCount int `json:"headerRowCount,omitempty"`
	// DefaultStoreIdentifier is used if not found in spreadsheet
	DefaultStoreIdentifier string `json:"defaultStoreIdentifier,omitempty"`
	// SkipEmptyRows indicates whether to skip empty rows
	SkipEmptyRows bool `json:"skipEmptyRows,omitempty"`
	// SheetNameOrIndex specifies which sheet to parse (default: first sheet)
	// Can be a string (sheet name) or int (sheet index, 0-based)
	SheetNameOrIndex interface{} `json:"sheetNameOrIndex,omitempty"`
}

// DefaultOptions returns default XLSX parser options
func DefaultOptions() XlsxParserOptions {
	return XlsxParserOptions{
		HasHeader:      true,
		HeaderRowCount: 0,
		SkipEmptyRows:  true,
	}
}

// ResolvedColumnIndices contains resolved numeric column indices
type ResolvedColumnIndices struct {
	StoreIdentifier       int
	ExternalID            int
	Name                  int
	Description           int
	Category              int
	Subcategory           int
	Brand                 int
	Unit                  int
	UnitQuantity          int
	Price                 int
	DiscountPrice         int
	DiscountStart         int
	DiscountEnd           int
	Barcodes              int
	ImageURL              int
	UnitPrice             int
	UnitPriceBaseQuantity int
	UnitPriceBaseUnit     int
	LowestPrice30d        int
	AnchorPrice           int
	AnchorPriceAsOf       int
}

// InvalidIndex indicates a column was not found or not specified
const InvalidIndex = -1

// NewResolvedColumnIndices creates a new ResolvedColumnIndices with all invalid indices
func NewResolvedColumnIndices() ResolvedColumnIndices {
	return ResolvedColumnIndices{
		StoreIdentifier:       InvalidIndex,
		ExternalID:            InvalidIndex,
		Name:                  InvalidIndex,
		Description:           InvalidIndex,
		Category:              InvalidIndex,
		Subcategory:           InvalidIndex,
		Brand:                 InvalidIndex,
		Unit:                  InvalidIndex,
		UnitQuantity:          InvalidIndex,
		Price:                 InvalidIndex,
		DiscountPrice:         InvalidIndex,
		DiscountStart:         InvalidIndex,
		DiscountEnd:           InvalidIndex,
		Barcodes:              InvalidIndex,
		ImageURL:              InvalidIndex,
		UnitPrice:             InvalidIndex,
		UnitPriceBaseQuantity: InvalidIndex,
		UnitPriceBaseUnit:     InvalidIndex,
		LowestPrice30d:        InvalidIndex,
		AnchorPrice:           InvalidIndex,
		AnchorPriceAsOf:       InvalidIndex,
	}
}
