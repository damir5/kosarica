package xml

// FieldExtractor is a function that extracts a value from an XML item
type FieldExtractor func(map[string]interface{}) string

// BarcodeExtractor is a function that extracts barcodes from an XML item
type BarcodeExtractor func(map[string]interface{}) []string

// XmlFieldMapping maps NormalizedRow field names to XML paths
// Paths use dot notation for nested elements (e.g., "product.price.value")
// Can be a string path or an extraction function
type XmlFieldMapping struct {
	// String paths for simple field extraction
	StoreIdentifier     *string            `json:"storeIdentifier,omitempty"`
	ExternalID          *string            `json:"externalId,omitempty"`
	Name                string             `json:"name"` // Required
	Description         *string            `json:"description,omitempty"`
	Category            *string            `json:"category,omitempty"`
	Subcategory         *string            `json:"subcategory,omitempty"`
	Brand               *string            `json:"brand,omitempty"`
	Unit                *string            `json:"unit,omitempty"`
	UnitQuantity        *string            `json:"unitQuantity,omitempty"`
	Price               string             `json:"price"` // Required
	DiscountPrice       *string            `json:"discountPrice,omitempty"`
	DiscountStart       *string            `json:"discountStart,omitempty"`
	DiscountEnd         *string            `json:"discountEnd,omitempty"`
	Barcodes            *string            `json:"barcodes,omitempty"`
	ImageURL            *string            `json:"imageUrl,omitempty"`
	UnitPrice           *string            `json:"unitPrice,omitempty"`
	UnitPriceBaseQuantity *string          `json:"unitPriceBaseQuantity,omitempty"`
	UnitPriceBaseUnit   *string            `json:"unitPriceBaseUnit,omitempty"`
	LowestPrice30d      *string            `json:"lowestPrice30d,omitempty"`
	AnchorPrice         *string            `json:"anchorPrice,omitempty"`
	AnchorPriceAsOf     *string            `json:"anchorPriceAsOf,omitempty"`

	// Function extractors for complex field extraction
	NameExtractor       FieldExtractor     `json:"-"`
	PriceExtractor      FieldExtractor     `json:"-"`
	BarcodesExtractor   BarcodeExtractor   `json:"-"`
}

// XmlParserOptions represents XML parser options
type XmlParserOptions struct {
	ItemsPath                string           `json:"itemsPath"` // Path to items array (e.g., "products.product")
	FieldMapping             XmlFieldMapping  `json:"fieldMapping"`
	DefaultStoreIdentifier   string           `json:"defaultStoreIdentifier,omitempty"`
	Encoding                 string           `json:"encoding,omitempty"`
	AttributePrefix          string           `json:"attributePrefix,omitempty"` // Default: "@_"
}

// DefaultXmlOptions returns default XML parser options
func DefaultXmlOptions() XmlParserOptions {
	return XmlParserOptions{
		AttributePrefix: "@_",
		Encoding:        "utf-8",
	}
}
