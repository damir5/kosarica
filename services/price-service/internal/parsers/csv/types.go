package csv

import "time"

// CsvDelimiter represents supported CSV delimiters
type CsvDelimiter string

const (
	DelimiterComma     CsvDelimiter = ","
	DelimiterSemicolon CsvDelimiter = ";"
	DelimiterTab       CsvDelimiter = "\t"
)

// CsvEncoding represents supported encodings
type CsvEncoding string

const (
	EncodingUTF8      CsvEncoding = "utf-8"
	EncodingWindows1250 CsvEncoding = "windows-1250"
	EncodingISO88592   CsvEncoding = "iso-8859-2"
)

// CsvColumnMapping maps NormalizedRow field names to CSV column indices or header names
type CsvColumnMapping struct {
	StoreIdentifier     *string `json:"storeIdentifier,omitempty"`
	ExternalID          *string `json:"externalId,omitempty"`
	Name                string  `json:"name"`
	Description         *string `json:"description,omitempty"`
	Category            *string `json:"category,omitempty"`
	Subcategory         *string `json:"subcategory,omitempty"`
	Brand               *string `json:"brand,omitempty"`
	Unit                *string `json:"unit,omitempty"`
	UnitQuantity        *string `json:"unitQuantity,omitempty"`
	Price               string  `json:"price"`
	DiscountPrice       *string `json:"discountPrice,omitempty"`
	DiscountStart       *string `json:"discountStart,omitempty"`
	DiscountEnd         *string `json:"discountEnd,omitempty"`
	Barcodes            *string `json:"barcodes,omitempty"`
	ImageURL            *string `json:"imageUrl,omitempty"`
	UnitPrice           *string `json:"unitPrice,omitempty"`
	UnitPriceBaseQuantity *string `json:"unitPriceBaseQuantity,omitempty"`
	UnitPriceBaseUnit   *string `json:"unitPriceBaseUnit,omitempty"`
	LowestPrice30d      *string `json:"lowestPrice30d,omitempty"`
	AnchorPrice         *string `json:"anchorPrice,omitempty"`
	AnchorPriceAsOf     *string `json:"anchorPriceAsOf,omitempty"`
}

// CsvParserOptions represents CSV parser options
type CsvParserOptions struct {
	Delimiter            CsvDelimiter     `json:"delimiter,omitempty"`
	Encoding             CsvEncoding      `json:"encoding,omitempty"`
	HasHeader            bool             `json:"hasHeader,omitempty"`
	ColumnMapping        *CsvColumnMapping `json:"columnMapping,omitempty"`
	DefaultStoreIdentifier string          `json:"defaultStoreIdentifier,omitempty"`
	SkipEmptyRows        bool             `json:"skipEmptyRows,omitempty"`
	QuoteChar            rune             `json:"quoteChar,omitempty"`
}

// DefaultOptions returns default CSV parser options
func DefaultOptions() CsvParserOptions {
	return CsvParserOptions{
		Delimiter:     DelimiterComma,
		Encoding:      EncodingUTF8,
		HasHeader:     true,
		SkipEmptyRows: true,
		QuoteChar:     '"',
	}
}

// ColumnIndex represents a resolved column index (either by position or header name)
type ColumnIndex struct {
	Field string
	Index int
	// ByName indicates if this was resolved by header name vs position
	ByName bool
}
