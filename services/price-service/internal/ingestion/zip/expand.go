package zip

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/kosarica/price-service/internal/storage"
	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog"
)

var log = zerolog.New(os.Stdout).With().Timestamp().Logger()

// ExpandOptions contains options for ZIP expansion
type ExpandOptions struct {
	// MaxFileSize is the maximum size for a single file in bytes (0 = unlimited)
	MaxFileSize int64
	// MaxTotalSize is the maximum total size for all extracted files (0 = unlimited)
	MaxTotalSize int64
	// MaxFiles is the maximum number of files to extract (0 = unlimited)
	MaxFiles int
	// AllowedExtensions filters which file extensions to extract (empty = all)
	AllowedExtensions []string
	// SkipPatterns contains patterns to skip (e.g., "__MACOSX")
	SkipPatterns []string
}

// DefaultExpandOptions returns default options for ZIP expansion
func DefaultExpandOptions() ExpandOptions {
	return ExpandOptions{
		MaxFileSize:  100 * 1024 * 1024,  // 100MB per file
		MaxTotalSize: 1024 * 1024 * 1024, // 1GB total
		MaxFiles:     10000,              // Maximum 10k files
		AllowedExtensions: []string{
			".csv", ".CSV",
			".xml", ".XML",
			".xlsx", ".XLSX",
		},
		SkipPatterns: []string{
			"__MACOSX",
			".DS_Store",
			"Thumbs.db",
			"desktop.ini",
		},
	}
}

// ExpandedFile represents a file extracted from a ZIP archive
type ExpandedFile struct {
	InnerFilename string
	Type          types.FileType
	Content       []byte
	Hash          string
	Size          int64
}

// Expander handles ZIP file expansion
type Expander struct {
	storage storage.Storage
	options ExpandOptions
}

// NewExpander creates a new ZIP expander
func NewExpander(store storage.Storage, options ExpandOptions) *Expander {
	return &Expander{
		storage: store,
		options: options,
	}
}

// Expand expands a ZIP file from content and returns extracted files
// This is an in-memory expansion - no files are written to storage
func (e *Expander) Expand(ctx context.Context, content []byte, parentFilename string) ([]ExpandedFile, error) {
	reader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return nil, fmt.Errorf("failed to open ZIP: %w", err)
	}

	var expanded []ExpandedFile
	var totalSize int64
	fileCount := 0

	for _, file := range reader.File {
		// Check context for cancellation
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		// Skip directories
		if file.FileInfo().IsDir() {
			continue
		}

		// Validate filename for zip slip prevention
		safeName, err := sanitizeFilename(file.Name)
		if err != nil {
			// Skip files with suspicious paths
			continue
		}

		// Skip system/hidden files
		if e.shouldSkip(safeName) {
			continue
		}

		// Filter by extension if configured
		if !e.isAllowedExtension(safeName) {
			continue
		}

		// Check file count limit
		fileCount++
		if e.options.MaxFiles > 0 && fileCount > e.options.MaxFiles {
			return nil, fmt.Errorf("too many files in archive (limit: %d)", e.options.MaxFiles)
		}

		// Check declared file size (preliminary check)
		if e.options.MaxFileSize > 0 && int64(file.UncompressedSize64) > e.options.MaxFileSize {
			return nil, fmt.Errorf("file %s exceeds maximum size (%d > %d)",
				safeName, file.UncompressedSize64, e.options.MaxFileSize)
		}

		// Extract file with size-limited reader
		data, err := e.readFileWithLimit(ctx, file, safeName)
		if err != nil {
			return nil, err
		}

		// Update and check total size (using actual bytes read)
		totalSize += int64(len(data))
		if e.options.MaxTotalSize > 0 && totalSize > e.options.MaxTotalSize {
			return nil, fmt.Errorf("total extracted size exceeds maximum (%d > %d)",
				totalSize, e.options.MaxTotalSize)
		}

		// Compute hash
		hash := sha256.Sum256(data)

		// Determine file type
		fileType := detectFileType(safeName)

		expanded = append(expanded, ExpandedFile{
			InnerFilename: safeName,
			Type:          fileType,
			Content:       data,
			Hash:          hex.EncodeToString(hash[:]),
			Size:          int64(len(data)),
		})
	}

	return expanded, nil
}

// readFileWithLimit reads a file from ZIP with size limit enforcement
func (e *Expander) readFileWithLimit(ctx context.Context, file *zip.File, safeName string) ([]byte, error) {
	rc, err := file.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open file %s in ZIP: %w", safeName, err)
	}
	defer func() {
		if closeErr := rc.Close(); closeErr != nil {
			// Log close error but don't fail the operation
			log.Warn().Str("entry", safeName).Err(closeErr).Msg("Failed to close ZIP entry")
		}
	}()

	// Use LimitedReader to enforce actual size limit (not just declared size)
	var reader io.Reader = rc
	if e.options.MaxFileSize > 0 {
		// Add 1 byte to detect if file exceeds limit
		reader = io.LimitReader(rc, e.options.MaxFileSize+1)
	}

	// Read with context awareness using a buffer
	var buf bytes.Buffer
	done := make(chan error, 1)

	go func() {
		_, err := io.Copy(&buf, reader)
		done <- err
	}()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case err := <-done:
		if err != nil {
			return nil, fmt.Errorf("failed to read file %s from ZIP: %w", safeName, err)
		}
	}

	data := buf.Bytes()

	// Check if we hit the limit (file was larger than allowed)
	if e.options.MaxFileSize > 0 && int64(len(data)) > e.options.MaxFileSize {
		return nil, fmt.Errorf("file %s exceeds maximum size (actual data > %d bytes)", safeName, e.options.MaxFileSize)
	}

	return data, nil
}

// sanitizeFilename validates and sanitizes a filename from ZIP to prevent zip slip
// Returns error if the filename is potentially dangerous
func sanitizeFilename(filename string) (string, error) {
	// Reject absolute paths
	if path.IsAbs(filename) || filepath.IsAbs(filename) {
		return "", fmt.Errorf("absolute path not allowed: %s", filename)
	}

	// Reject Windows drive letters
	if len(filename) >= 2 && filename[1] == ':' {
		return "", fmt.Errorf("Windows drive letter not allowed: %s", filename)
	}

	// Reject backslashes (Windows path separators)
	if strings.Contains(filename, "\\") {
		// Convert backslashes to forward slashes for normalization
		filename = strings.ReplaceAll(filename, "\\", "/")
	}

	// Clean the path to resolve . and ..
	cleaned := path.Clean(filename)

	// Reject if path escapes (starts with .. after cleaning)
	if strings.HasPrefix(cleaned, "..") || strings.HasPrefix(cleaned, "/") {
		return "", fmt.Errorf("path traversal not allowed: %s", filename)
	}

	// Reject if any component is ".."
	parts := strings.Split(cleaned, "/")
	for _, part := range parts {
		if part == ".." {
			return "", fmt.Errorf("path traversal not allowed: %s", filename)
		}
	}

	// Return just the base name for safety (flatten directory structure)
	// This prevents any potential issues with nested paths
	baseName := path.Base(cleaned)
	if baseName == "." || baseName == "/" || baseName == "" {
		return "", fmt.Errorf("invalid filename: %s", filename)
	}

	return baseName, nil
}

// ExpandAndStore expands a ZIP file and stores extracted files
func (e *Expander) ExpandAndStore(
	ctx context.Context,
	content []byte,
	chainSlug string,
	date time.Time,
	parentFilename string,
) ([]ExpandedFile, error) {
	expanded, err := e.Expand(ctx, content, parentFilename)
	if err != nil {
		return nil, err
	}

	// Store each expanded file
	for _, file := range expanded {
		// Check context for cancellation
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		key := storage.BuildExpandedKey(chainSlug, date, parentFilename, file.InnerFilename)

		metadata := &storage.Metadata{
			ContentType:  detectContentType(file.InnerFilename),
			OriginalName: file.InnerFilename,
			ChainSlug:    chainSlug,
			DownloadedAt: time.Now(),
			Custom: map[string]string{
				"parentZip": parentFilename,
			},
		}

		if err := e.storage.Put(ctx, key, file.Content, metadata); err != nil {
			return nil, fmt.Errorf("failed to store expanded file %s: %w", file.InnerFilename, err)
		}
	}

	return expanded, nil
}

// shouldSkip checks if a file should be skipped based on patterns
func (e *Expander) shouldSkip(filename string) bool {
	for _, pattern := range e.options.SkipPatterns {
		if strings.Contains(filename, pattern) {
			return true
		}
	}
	return false
}

// isAllowedExtension checks if a file has an allowed extension
func (e *Expander) isAllowedExtension(filename string) bool {
	if len(e.options.AllowedExtensions) == 0 {
		return true
	}

	ext := strings.ToLower(filepath.Ext(filename))
	for _, allowed := range e.options.AllowedExtensions {
		if strings.EqualFold(ext, allowed) {
			return true
		}
	}
	return false
}

// detectFileType detects file type from filename
func detectFileType(filename string) types.FileType {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".csv":
		return types.FileTypeCSV
	case ".xml":
		return types.FileTypeXML
	case ".xlsx", ".xls":
		return types.FileTypeXLSX
	case ".zip":
		return types.FileTypeZIP
	default:
		return types.FileTypeCSV // Default to CSV
	}
}

// detectContentType returns MIME type for a filename
func detectContentType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".csv":
		return "text/csv"
	case ".xml":
		return "application/xml"
	case ".xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".xls":
		return "application/vnd.ms-excel"
	case ".zip":
		return "application/zip"
	default:
		return "application/octet-stream"
	}
}

// ExpandInMemory is a convenience function for in-memory ZIP expansion
func ExpandInMemory(content []byte, parentFilename string) ([]ExpandedFile, error) {
	expander := &Expander{
		storage: nil,
		options: DefaultExpandOptions(),
	}
	return expander.Expand(context.Background(), content, parentFilename)
}

// ConvertToTypesExpandedFiles converts zip.ExpandedFile to types.ExpandedFile
func ConvertToTypesExpandedFiles(parent types.DiscoveredFile, expanded []ExpandedFile) []types.ExpandedFile {
	result := make([]types.ExpandedFile, len(expanded))
	for i, file := range expanded {
		result[i] = types.ExpandedFile{
			Parent:        parent,
			InnerFilename: file.InnerFilename,
			Type:          file.Type,
			Content:       file.Content,
			Hash:          file.Hash,
		}
	}
	return result
}
