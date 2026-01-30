package storage

import (
	"bytes"
	"compress/gzip"
	"io"
)

// CompressWithGzip compresses data using gzip
func CompressWithGzip(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	if _, err := w.Write(data); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// DecompressGzip decompresses gzip data
func DecompressGzip(data []byte) ([]byte, error) {
	r, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
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
