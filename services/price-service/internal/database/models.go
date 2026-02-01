package database

import (
	"time"
)

// Chain represents a retail chain (Konzum, Lidl, etc.)
type Chain struct {
	Slug      string    `json:"slug"`     // konzum, lidl, plodine, etc.
	Name      string    `json:"name"`     // Human-readable name
	Website   *string   `json:"website"`  // Optional website URL
	LogoURL   *string   `json:"logo_url"` // Optional logo URL
	CreatedAt time.Time `json:"created_at"`
}

// Store represents a physical or virtual store location
type Store struct {
	ID                 string    `json:"id"`                    // CUID2
	ChainSlug          string    `json:"chain_slug"`            // FK to chains.slug
	Name               string    `json:"name"`                  // Store name
	Address            *string   `json:"address"`               // Street address
	City               *string   `json:"city"`                  // City name
	PostalCode         *string   `json:"postal_code"`           // Postal/ZIP code
	Latitude           *string   `json:"latitude"`              // Latitude as string
	Longitude          *string   `json:"longitude"`             // Longitude as string
	IsVirtual          bool      `json:"is_virtual"`            // Virtual store (uses another store's prices)
	PriceSourceStoreID *string   `json:"price_source_store_id"` // ID of physical store for virtual stores
	Status             string    `json:"status"`                // 'active' | 'pending'
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// StoreIdentifier maps a store to various identifier types
type StoreIdentifier struct {
	ID        string    `json:"id"`       // CUID2
	StoreID   string    `json:"store_id"` // FK to stores.id
	Type      string    `json:"type"`     // 'filename_code', 'portal_id', 'internal_id', etc.
	Value     string    `json:"value"`    // The identifier value
	CreatedAt time.Time `json:"created_at"`
}

// RetailerItem represents a product as sold by a retailer
type RetailerItem struct {
	ID           string    `json:"id"`            // CUID2
	ChainSlug    string    `json:"chain_slug"`    // FK to chains.slug
	ExternalID   *string   `json:"external_id"`   // Retailer's internal ID
	Name         string    `json:"name"`          // Item name
	Description  *string   `json:"description"`   // Item description
	Category     *string   `json:"category"`      // Category
	Subcategory  *string   `json:"subcategory"`   // Subcategory
	Brand        *string   `json:"brand"`         // Brand name
	Unit         *string   `json:"unit"`          // kg, l, kom, etc.
	UnitQuantity *string   `json:"unit_quantity"` // "1", "0.5", "500g", etc.
	ImageURL     *string   `json:"image_url"`     // Image URL
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// RetailerItemBarcode maps a retailer item to its barcodes
type RetailerItemBarcode struct {
	ID             string    `json:"id"`               // CUID2
	RetailerItemID string    `json:"retailer_item_id"` // FK to retailer_items.id
	Barcode        string    `json:"barcode"`          // EAN-13, EAN-8, etc.
	IsPrimary      bool      `json:"is_primary"`       // Whether this is a primary barcode
	CreatedAt      time.Time `json:"created_at"`
}

// IngestionRun represents a single ingestion run for a chain
type IngestionRun struct {
	ID               string     `json:"id"`         // CUID2 format: run_xxx
	ChainSlug        string     `json:"chain_slug"` // FK to chains.slug
	Source           string     `json:"source"`     // 'cli', 'worker', 'scheduled'
	Status           string     `json:"status"`     // 'pending', 'running', 'completed', 'failed'
	StatusReason     *string    `json:"status_reason"`
	StatusSeverity   *string    `json:"status_severity"`
	StatusType       *string    `json:"status_type"`
	StartedAt        *time.Time `json:"started_at"`
	CompletedAt      *time.Time `json:"completed_at"`
	TotalFiles       *int       `json:"total_files"`
	ProcessedFiles   *int       `json:"processed_files"`
	TotalEntries     *int       `json:"total_entries"`
	ProcessedEntries *int       `json:"processed_entries"`
	ErrorCount       *int       `json:"error_count"`
	Metadata         *string    `json:"metadata"` // JSON for additional run info
	// Rerun support
	ParentRunID   *string   `json:"parent_run_id"`   // For rerun tracking
	RerunType     *string   `json:"rerun_type"`      // 'file', 'chunk', 'entry'
	RerunTargetID *string   `json:"rerun_target_id"` // ID of file/chunk/entry being rerun
	CreatedAt     time.Time `json:"created_at"`
}

// IngestionFile represents a file being ingested
type IngestionFile struct {
	ID             *int64     `json:"id"`        // bigserial
	RunID          string     `json:"run_id"`    // FK to ingestion_runs.id (CUID2)
	Filename       string     `json:"filename"`  // Original filename
	FileType       string     `json:"file_type"` // 'csv', 'xml', 'xlsx', 'zip'
	FileSize       *int       `json:"file_size"` // Size in bytes
	FileHash       *string    `json:"file_hash"` // For deduplication
	Status         string     `json:"status"`    // 'pending', 'processing', 'completed', 'failed'
	StatusReason   *string    `json:"status_reason"`
	StatusSeverity *string    `json:"status_severity"`
	StatusType     *string    `json:"status_type"`
	EntryCount     *int       `json:"entry_count"` // Number of entries
	ProcessedAt    *time.Time `json:"processed_at"`
	Metadata       *string    `json:"metadata"` // JSON for file-specific info
	// Chunking support
	TotalChunks     *int      `json:"total_chunks"`     // Number of chunks
	ProcessedChunks *int      `json:"processed_chunks"` // Processed chunks
	ChunkSize       *int      `json:"chunk_size"`       // Rows per chunk
	CreatedAt       time.Time `json:"created_at"`
}

// IngestionError represents an error during ingestion
type IngestionError struct {
	ID           int64     `json:"id"`            // bigserial
	RunID        string    `json:"run_id"`        // FK to ingestion_runs.id (CUID2)
	FileID       *string   `json:"file_id"`       // FK to ingestion_files.id
	ChunkID      *string   `json:"chunk_id"`      // FK to ingestion_chunks.id
	EntryID      *string   `json:"entry_id"`      // FK to ingestion_file_entries.id
	ErrorType    string    `json:"error_type"`    // 'parse', 'validation', 'store_resolution', 'persist'
	ErrorMessage string    `json:"error_message"` // Error message
	ErrorDetails *string   `json:"error_details"` // JSON with stack trace
	Severity     string    `json:"severity"`      // 'warning', 'error', 'critical'
	CreatedAt    time.Time `json:"created_at"`
}
