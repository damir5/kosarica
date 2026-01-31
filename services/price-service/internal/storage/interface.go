package storage

import (
	"context"
	"time"
)

// Metadata contains file metadata for storage
type Metadata struct {
	ContentType    string            `json:"contentType,omitempty"`
	OriginalName   string            `json:"originalName,omitempty"`
	ChainSlug      string            `json:"chainSlug,omitempty"`
	SourceURL      string            `json:"sourceUrl,omitempty"`
	DownloadedAt   time.Time         `json:"downloadedAt,omitempty"`
	CompressedSize int64             `json:"compressedSize,omitempty"`
	Custom         map[string]string `json:"custom,omitempty"`
}

// FileInfo contains information about a stored file
type FileInfo struct {
	Key         string    `json:"key"`
	Size        int64     `json:"size"`
	Checksum    string    `json:"checksum"`
	ContentType string    `json:"contentType,omitempty"`
	ModifiedAt  time.Time `json:"modifiedAt"`
	Metadata    *Metadata `json:"metadata,omitempty"`
}

// Storage defines the interface for file storage operations
// Implementations can be local filesystem, S3, GCS, etc.
type Storage interface {
	// Put stores content at the given key with optional metadata
	Put(ctx context.Context, key string, content []byte, metadata *Metadata) error

	// Get retrieves content from the given key
	Get(ctx context.Context, key string) ([]byte, error)

	// GetInfo retrieves file information without content
	GetInfo(ctx context.Context, key string) (*FileInfo, error)

	// Exists checks if a file exists at the given key
	Exists(ctx context.Context, key string) (bool, error)

	// Delete removes a file at the given key
	Delete(ctx context.Context, key string) error

	// List returns all keys matching the given prefix
	List(ctx context.Context, prefix string) ([]string, error)

	// GetChecksum returns the checksum for a file (without reading full content)
	GetChecksum(ctx context.Context, key string) (string, error)
}

// StorageType represents the type of storage backend
type StorageType string

const (
	StorageTypeLocal StorageType = "local"
	StorageTypeS3    StorageType = "s3"
)

// IntermediateStorage extends Storage with methods for intermediate data.
// These methods are used during ingestion to store parsed data before clustering.
type IntermediateStorage interface {
	Storage

	// WriteIntermediateJSON writes a JSON object to intermediate storage.
	// Path format: intermediate/{runId}/{filename}.json
	WriteIntermediateJSON(ctx context.Context, runID, filename string, data interface{}) error

	// ReadIntermediateJSON reads a JSON object from intermediate storage.
	ReadIntermediateJSON(ctx context.Context, runID, filename string, dest interface{}) error

	// ListIntermediateFiles returns all files in intermediate storage for a run.
	ListIntermediateFiles(ctx context.Context, runID string) ([]string, error)

	// DeleteIntermediateDir deletes all intermediate files for a run.
	DeleteIntermediateDir(ctx context.Context, runID string) error
}

// BuildIntermediateKey builds a storage key for intermediate files.
func BuildIntermediateKey(runID, filename string) string {
	return "intermediate/" + runID + "/" + filename
}
