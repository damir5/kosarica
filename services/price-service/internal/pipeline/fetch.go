package pipeline

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/types"
)

// FetchResult represents the result of fetching a file
type FetchResult struct {
	StorageKey string
	Hash       string
	Content    []byte
	IsZip      bool
}

// FetchPhase executes the fetch phase of the ingestion pipeline
// It downloads files from the discovered URLs
func FetchPhase(ctx context.Context, chainID string, file types.DiscoveredFile) (*FetchResult, error) {
	// Get adapter from registry
	adapter, err := registry.GetAdapter(config.ChainID(chainID))
	if err != nil {
		return nil, fmt.Errorf("failed to get adapter for %s: %w", chainID, err)
	}

	fmt.Printf("[INFO] Fetching file: %s from %s\n", file.Filename, file.URL)

	// Fetch the file
	fetched, err := adapter.Fetch(file)
	if err != nil {
		return nil, fmt.Errorf("fetch failed for %s: %w", file.Filename, err)
	}

	// Compute hash
	hash := computeSha256(fetched.Content)

	// Check for duplicate by hash in storage
	if isDuplicateFile(ctx, file.Filename, hash) {
		fmt.Printf("[INFO] Skipping duplicate file: %s (hash: %s)\n", file.Filename, hash)
		return nil, nil
	}

	// Store file in storage (for now, we'll just keep in memory)
	// In Phase 10, we'll implement proper storage abstraction
	storageKey := fmt.Sprintf("runs/%s/files/%s", time.Now().Format("20060102"), file.Filename)

	fmt.Printf("[INFO] Fetched file: %s (%d bytes, hash: %s)\n", file.Filename, len(fetched.Content), hash)

	return &FetchResult{
		StorageKey: storageKey,
		Hash:       hash,
		Content:    fetched.Content,
		IsZip:      file.Type == types.FileTypeZIP,
	}, nil
}

// computeSha256 computes SHA256 hash of byte slice
func computeSha256(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// isDuplicateFile checks if a file with the same hash already exists
func isDuplicateFile(ctx context.Context, filename string, hash string) bool {
	pool := database.Pool()

	var exists bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM ingestion_files
			WHERE file_hash = $1
			LIMIT 1
		)
	`, hash).Scan(&exists)

	return err == nil && exists
}

