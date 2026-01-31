package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// LocalStorage implements Storage interface using local filesystem
type LocalStorage struct {
	basePath string
}

// NewLocalStorage creates a new local filesystem storage
func NewLocalStorage(basePath string) (*LocalStorage, error) {
	// Ensure base path exists
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage directory %s: %w", basePath, err)
	}

	return &LocalStorage{
		basePath: basePath,
	}, nil
}

const MinCompressionSize = 1024 // 1KB minimum

// Put stores content at the given key with optional metadata
func (s *LocalStorage) Put(ctx context.Context, key string, content []byte, metadata *Metadata) error {
	fullPath := s.keyToPath(key)

	// Ensure parent directory exists
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}

	var dataToStore []byte
	var compressed bool
	storePath := fullPath

	// Determine if we should compress
	if metadata != nil && len(content) >= MinCompressionSize {
		fileType := ""
		if metadata.Custom != nil {
			fileType = metadata.Custom["file_type"]
		}
		if ShouldCompress(fileType) {
			compressedData, err := CompressWithGzip(content)
			if err == nil && len(compressedData) < len(content) {
				dataToStore = compressedData
				compressed = true
				storePath = fullPath + ".gz"
			}
		}
	}

	if !compressed {
		dataToStore = content
	}

	// Update metadata with compression info
	if metadata != nil {
		if metadata.Custom == nil {
			metadata.Custom = make(map[string]string)
		}
		if compressed {
			metadata.Custom["compressed"] = "true"
			metadata.Custom["original_size"] = fmt.Sprintf("%d", len(content))
			metadata.CompressedSize = int64(len(dataToStore))
		}
	}

	// Write content file
	if err := os.WriteFile(storePath, dataToStore, 0644); err != nil {
		return fmt.Errorf("failed to write file %s: %w", storePath, err)
	}

	return nil
}

// Get retrieves content from the given key
func (s *LocalStorage) Get(ctx context.Context, key string) ([]byte, error) {
	fullPath := s.keyToPath(key)

	// Check if .gz version exists (compressed file)
	gzPath := fullPath + ".gz"
	if _, err := os.Stat(gzPath); err == nil {
		content, err := os.ReadFile(gzPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read compressed file %s: %w", gzPath, err)
		}
		decompressed, err := DecompressGzip(content)
		if err != nil {
			return nil, fmt.Errorf("decompression failed for %s (file may be corrupted): %w", key, err)
		}
		return decompressed, nil
	}

	// Fall back to uncompressed file
	content, err := os.ReadFile(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("file not found: %s", key)
		}
		return nil, fmt.Errorf("failed to read file %s: %w", fullPath, err)
	}

	return content, nil
}

// GetInfo retrieves file information without content
func (s *LocalStorage) GetInfo(ctx context.Context, key string) (*FileInfo, error) {
	fullPath := s.keyToPath(key)

	// Check for compressed version first
	actualPath := fullPath
	isCompressed := false
	gzPath := fullPath + ".gz"
	if _, err := os.Stat(gzPath); err == nil {
		actualPath = gzPath
		isCompressed = true
	}

	stat, err := os.Stat(actualPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("file not found: %s", key)
		}
		return nil, fmt.Errorf("failed to stat file %s: %w", actualPath, err)
	}

	// Compute checksum
	checksum, err := s.computeFileChecksum(actualPath)
	if err != nil {
		return nil, fmt.Errorf("failed to compute checksum: %w", err)
	}

	info := &FileInfo{
		Key:        key,
		Size:       stat.Size(),
		Checksum:   checksum,
		ModifiedAt: stat.ModTime(),
	}

	// Add compression info if applicable
	if isCompressed {
		info.Metadata = &Metadata{
			Custom: map[string]string{"compressed": "true"},
		}
	}

	return info, nil
}

// Exists checks if a file exists at the given key
func (s *LocalStorage) Exists(ctx context.Context, key string) (bool, error) {
	fullPath := s.keyToPath(key)

	// Check for uncompressed file
	if _, err := os.Stat(fullPath); err == nil {
		return true, nil
	}

	// Check for compressed file
	gzPath := fullPath + ".gz"
	if _, err := os.Stat(gzPath); err == nil {
		return true, nil
	}

	return false, nil
}

// Delete removes a file at the given key
func (s *LocalStorage) Delete(ctx context.Context, key string) error {
	fullPath := s.keyToPath(key)

	// Delete uncompressed content file
	if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete file %s: %w", fullPath, err)
	}

	// Delete compressed file if exists
	gzPath := fullPath + ".gz"
	if err := os.Remove(gzPath); err != nil && !os.IsNotExist(err) {
		// Ignore deletion errors for gz file
	}

	return nil
}

// List returns all keys matching the given prefix
func (s *LocalStorage) List(ctx context.Context, prefix string) ([]string, error) {
	searchPath := s.keyToPath(prefix)

	// Ensure search path is a directory or get parent directory
	stat, err := os.Stat(searchPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Get parent directory
			searchPath = filepath.Dir(searchPath)
			if _, err := os.Stat(searchPath); os.IsNotExist(err) {
				return []string{}, nil
			}
		} else {
			return nil, fmt.Errorf("failed to stat path %s: %w", searchPath, err)
		}
	} else if !stat.IsDir() {
		searchPath = filepath.Dir(searchPath)
	}

	var keys []string
	err = filepath.Walk(searchPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		// Convert path back to key, stripping .gz extension if present
		key := s.pathToKey(path)
		key = strings.TrimSuffix(key, ".gz")

		// Filter by prefix
		if strings.HasPrefix(key, prefix) {
			keys = append(keys, key)
		}

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to list files: %w", err)
	}

	return keys, nil
}

// GetChecksum returns the checksum for a file
func (s *LocalStorage) GetChecksum(ctx context.Context, key string) (string, error) {
	fullPath := s.keyToPath(key)

	// Check for compressed version first
	gzPath := fullPath + ".gz"
	if _, err := os.Stat(gzPath); err == nil {
		return s.computeFileChecksum(gzPath)
	}

	return s.computeFileChecksum(fullPath)
}

// keyToPath converts a storage key to a filesystem path
func (s *LocalStorage) keyToPath(key string) string {
	// Clean the key to prevent path traversal
	cleanKey := filepath.Clean(key)
	cleanKey = strings.TrimPrefix(cleanKey, "/")
	cleanKey = strings.TrimPrefix(cleanKey, "\\")

	return filepath.Join(s.basePath, cleanKey)
}

// pathToKey converts a filesystem path to a storage key
func (s *LocalStorage) pathToKey(path string) string {
	relPath, err := filepath.Rel(s.basePath, path)
	if err != nil {
		return path
	}
	// Normalize to forward slashes for consistency
	return strings.ReplaceAll(relPath, "\\", "/")
}

// computeFileChecksum computes SHA256 checksum for a file
func (s *LocalStorage) computeFileChecksum(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", fmt.Errorf("failed to compute hash: %w", err)
	}

	return hex.EncodeToString(hash.Sum(nil)), nil
}

// ComputeChecksum computes SHA256 checksum for content
func ComputeChecksum(content []byte) string {
	hash := sha256.Sum256(content)
	return hex.EncodeToString(hash[:])
}

// GetBasePath returns the base path for this storage
func (s *LocalStorage) GetBasePath() string {
	return s.basePath
}

// BuildArchiveKey builds a storage key for an archive file
func BuildArchiveKey(chainSlug string, date time.Time, filename string) string {
	dateStr := date.Format("2006-01-02")
	return fmt.Sprintf("archives/%s/%s/%s", chainSlug, dateStr, filename)
}

// BuildExpandedKey builds a storage key for an expanded file from a ZIP
func BuildExpandedKey(chainSlug string, date time.Time, parentFilename, innerFilename string) string {
	dateStr := date.Format("2006-01-02")
	// Remove .zip extension from parent
	parentBase := strings.TrimSuffix(parentFilename, ".zip")
	parentBase = strings.TrimSuffix(parentBase, ".ZIP")
	return fmt.Sprintf("expanded/%s/%s/%s/%s", chainSlug, dateStr, parentBase, innerFilename)
}

// ============================================================================
// IntermediateStorage Implementation
// ============================================================================

// WriteIntermediateJSON writes a JSON object to intermediate storage.
func (s *LocalStorage) WriteIntermediateJSON(ctx context.Context, runID, filename string, data interface{}) error {
	key := BuildIntermediateKey(runID, filename)

	jsonBytes, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal JSON: %w", err)
	}

	return s.Put(ctx, key, jsonBytes, &Metadata{
		ContentType: "application/json",
		Custom: map[string]string{
			"file_type": "json",
		},
	})
}

// ReadIntermediateJSON reads a JSON object from intermediate storage.
func (s *LocalStorage) ReadIntermediateJSON(ctx context.Context, runID, filename string, dest interface{}) error {
	key := BuildIntermediateKey(runID, filename)

	content, err := s.Get(ctx, key)
	if err != nil {
		return fmt.Errorf("failed to read intermediate file %s: %w", key, err)
	}

	if err := json.Unmarshal(content, dest); err != nil {
		return fmt.Errorf("failed to unmarshal JSON from %s: %w", key, err)
	}

	return nil
}

// ListIntermediateFiles returns all files in intermediate storage for a run.
func (s *LocalStorage) ListIntermediateFiles(ctx context.Context, runID string) ([]string, error) {
	prefix := "intermediate/" + runID + "/"

	keys, err := s.List(ctx, prefix)
	if err != nil {
		return nil, fmt.Errorf("failed to list intermediate files for run %s: %w", runID, err)
	}

	// Return just the filenames, not full keys
	filenames := make([]string, 0, len(keys))
	for _, key := range keys {
		filename := strings.TrimPrefix(key, prefix)
		if filename != "" {
			filenames = append(filenames, filename)
		}
	}

	return filenames, nil
}

// DeleteIntermediateDir deletes all intermediate files for a run.
func (s *LocalStorage) DeleteIntermediateDir(ctx context.Context, runID string) error {
	prefix := "intermediate/" + runID + "/"

	keys, err := s.List(ctx, prefix)
	if err != nil {
		return fmt.Errorf("failed to list intermediate files for deletion: %w", err)
	}

	for _, key := range keys {
		if err := s.Delete(ctx, key); err != nil {
			return fmt.Errorf("failed to delete intermediate file %s: %w", key, err)
		}
	}

	// Also try to remove the directory itself
	dirPath := s.keyToPath(prefix)
	os.RemoveAll(dirPath) // Ignore errors - directory might not be empty or might not exist

	return nil
}

// BuildStoreDataKey builds a key for parsed store data.
func BuildStoreDataKey(runID, storeIdentifier string) string {
	// Sanitize store identifier for use in filename
	safeIdentifier := strings.ReplaceAll(storeIdentifier, "/", "_")
	safeIdentifier = strings.ReplaceAll(safeIdentifier, "\\", "_")
	safeIdentifier = strings.ReplaceAll(safeIdentifier, ":", "_")
	return "stores/" + safeIdentifier + ".json"
}

// BuildManifestKey builds a key for the run manifest.
func BuildManifestKey() string {
	return "manifest.json"
}
