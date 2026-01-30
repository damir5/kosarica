package storage

import (
	"github.com/klauspost/compress/zstd"
)

// CompressWithZstd compresses data using zstd
func CompressWithZstd(data []byte) ([]byte, error) {
	// Use default compression level
	encoder, err := zstd.NewWriter(nil)
	if err != nil {
		return nil, err
	}
	return encoder.EncodeAll(data, nil), nil
}

// DecompressZstd decompresses zstd data
func DecompressZstd(data []byte) ([]byte, error) {
	decoder, err := zstd.NewReader(nil)
	if err != nil {
		return nil, err
	}
	return decoder.DecodeAll(data, nil)
}

// ShouldCompress returns true if file type should be compressed
func ShouldCompress(fileType string) bool {
	switch fileType {
	case "csv", "xml", "json":
		return true // Plain text - compress
	case "xlsx", "xls":
		return false // Already compressed (ZIP-based)
	case "zip", "gz", "bz2", "xz", "zst":
		return false // Already compressed
	default:
		return false // Don't compress unknown types
	}
}
