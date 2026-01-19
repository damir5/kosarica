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

// Put stores content at the given key with optional metadata
func (s *LocalStorage) Put(ctx context.Context, key string, content []byte, metadata *Metadata) error {
	fullPath := s.keyToPath(key)

	// Ensure parent directory exists
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}

	// Write content
	if err := os.WriteFile(fullPath, content, 0644); err != nil {
		return fmt.Errorf("failed to write file %s: %w", fullPath, err)
	}

	// Write metadata if provided
	if metadata != nil {
		metaPath := fullPath + ".meta"
		metaBytes, err := json.Marshal(metadata)
		if err != nil {
			return fmt.Errorf("failed to marshal metadata: %w", err)
		}
		if err := os.WriteFile(metaPath, metaBytes, 0644); err != nil {
			return fmt.Errorf("failed to write metadata %s: %w", metaPath, err)
		}
	}

	return nil
}

// Get retrieves content from the given key
func (s *LocalStorage) Get(ctx context.Context, key string) ([]byte, error) {
	fullPath := s.keyToPath(key)

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

	stat, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("file not found: %s", key)
		}
		return nil, fmt.Errorf("failed to stat file %s: %w", fullPath, err)
	}

	// Compute checksum
	checksum, err := s.computeFileChecksum(fullPath)
	if err != nil {
		return nil, fmt.Errorf("failed to compute checksum: %w", err)
	}

	info := &FileInfo{
		Key:        key,
		Size:       stat.Size(),
		Checksum:   checksum,
		ModifiedAt: stat.ModTime(),
	}

	// Try to load metadata
	metaPath := fullPath + ".meta"
	if metaBytes, err := os.ReadFile(metaPath); err == nil {
		var metadata Metadata
		if err := json.Unmarshal(metaBytes, &metadata); err == nil {
			info.Metadata = &metadata
			info.ContentType = metadata.ContentType
		}
	}

	return info, nil
}

// Exists checks if a file exists at the given key
func (s *LocalStorage) Exists(ctx context.Context, key string) (bool, error) {
	fullPath := s.keyToPath(key)

	_, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, fmt.Errorf("failed to stat file %s: %w", fullPath, err)
	}

	return true, nil
}

// Delete removes a file at the given key
func (s *LocalStorage) Delete(ctx context.Context, key string) error {
	fullPath := s.keyToPath(key)

	// Delete content file
	if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete file %s: %w", fullPath, err)
	}

	// Delete metadata file if exists
	metaPath := fullPath + ".meta"
	if err := os.Remove(metaPath); err != nil && !os.IsNotExist(err) {
		// Ignore metadata deletion errors
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

		// Skip directories and metadata files
		if info.IsDir() || strings.HasSuffix(path, ".meta") {
			return nil
		}

		// Convert path back to key
		key := s.pathToKey(path)

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
