package pipeline

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/storage"
	"github.com/kosarica/price-service/internal/types"
)

// FetchResult represents the result of fetching a file
type FetchResult struct {
	StorageKey string
	Hash       string
	Content    []byte
	IsZip      bool
	ArchiveID  string // ID of the archive record
}

// FetchPhase executes the fetch phase of the ingestion pipeline
// It downloads files from the discovered URLs and stores them in archive storage
func FetchPhase(ctx context.Context, chainID string, file types.DiscoveredFile, storageBackend storage.Storage) (*FetchResult, error) {
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

	// Check for duplicate by checksum in archives table
	existingArchive, err := database.GetArchiveByChecksum(ctx, hash)
	if err != nil && err != pgx.ErrNoRows {
		return nil, fmt.Errorf("failed to check archive: %w", err)
	}
	if existingArchive != nil {
		fmt.Printf("[INFO] Skipping duplicate file: %s (existing archive: %s)\n", file.Filename, existingArchive.ID)
		return &FetchResult{
			ArchiveID: existingArchive.ID,
			Content:   fetched.Content,
			IsZip:     file.Type == types.FileTypeZIP,
		}, nil
	}

	// Generate archive ID
	archiveID := database.GenerateArchiveID()

	// Build storage key
	storageKey := buildArchiveKey(chainID, file.Filename, time.Now())

	// Store file in archive storage
	metadata := &storage.Metadata{
		OriginalName:  file.Filename,
		ChainSlug:     chainID,
		SourceURL:     file.URL,
		DownloadedAt:  time.Now(),
	}

	if err := storageBackend.Put(ctx, storageKey, fetched.Content, metadata); err != nil {
		return nil, fmt.Errorf("failed to store file: %w", err)
	}

	// Create archive record in database
	fileSize := int64(len(fetched.Content))
	archive := &database.Archive{
		ID:             archiveID,
		ChainSlug:      chainID,
		SourceURL:      file.URL,
		Filename:       file.Filename,
		OriginalFormat: string(file.Type),
		ArchivePath:    storageKey,
		ArchiveType:    "local",
		FileSize:       &fileSize,
		Checksum:       hash,
		DownloadedAt:   time.Now(),
	}

	if err := database.CreateArchive(ctx, archive); err != nil {
		fmt.Printf("[WARN] Failed to create archive record: %v\n", err)
		// Continue anyway - file is stored
	}

	fmt.Printf("[INFO] Archived file: %s (%d bytes, hash: %s, key: %s)\n", file.Filename, fileSize, hash, storageKey)

	return &FetchResult{
		StorageKey: storageKey,
		Hash:       hash,
		Content:    fetched.Content,
		IsZip:      file.Type == types.FileTypeZIP,
		ArchiveID:  archiveID,
	}, nil
}

// computeSha256 computes SHA256 hash of byte slice
func computeSha256(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// buildArchiveKey builds a storage key for an archive file
func buildArchiveKey(chainSlug, filename string, downloadedAt time.Time) string {
	datePrefix := downloadedAt.Format("2006/01/02")
	return fmt.Sprintf("archives/%s/%s/%s", chainSlug, datePrefix, filename)
}

