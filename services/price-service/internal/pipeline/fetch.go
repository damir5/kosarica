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
	"github.com/kosarica/price-service/internal/jsonb"
	"github.com/kosarica/price-service/internal/storage"
	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog/log"
)

// FetchResult represents the result of fetching a file
type FetchResult struct {
	StorageKey  string
	Hash        string
	Content     []byte
	IsZip       bool
	ArchiveID   string // ID of the archive record
	FileSize    int
	IsDuplicate bool
	RunID       string // Run ID for linking archive to run
}

// FetchPhase executes the fetch phase of the ingestion pipeline
// It downloads files from the discovered URLs and stores them in archive storage
func FetchPhase(ctx context.Context, chainID string, file types.DiscoveredFile, storageBackend storage.Storage) (*FetchResult, error) {
	// Get adapter from registry
	adapter, err := registry.GetAdapter(config.ChainID(chainID))
	if err != nil {
		return nil, fmt.Errorf("failed to get adapter for %s: %w", chainID, err)
	}

	log.Info().Str("filename", file.Filename).Str("url", file.URL).Msg("Fetching file")

	// Fetch the file
	fetched, err := adapter.Fetch(file)
	if err != nil {
		return nil, fmt.Errorf("fetch failed for %s: %w", file.Filename, err)
	}

	// Compute hash and file size
	hash := computeSha256(fetched.Content)
	fileSize := len(fetched.Content)

	// Check file size limit (100MB max to prevent OOM)
	const maxFileSize = 100 * 1024 * 1024 // 100MB
	if fileSize > maxFileSize {
		return nil, fmt.Errorf("file %s exceeds maximum size of 100MB (got %d bytes)", file.Filename, fileSize)
	}

	// Check for duplicate by checksum in archives table
	existingArchive, err := database.GetArchiveByChecksum(ctx, hash)
	if err != nil && err != pgx.ErrNoRows {
		return nil, fmt.Errorf("failed to check archive: %w", err)
	}
	if existingArchive != nil {
		log.Info().Str("filename", file.Filename).Str("existing_archive", existingArchive.ID).Msg("Skipping duplicate file")
		return &FetchResult{
			ArchiveID:   existingArchive.ID,
			Content:     fetched.Content,
			IsZip:       file.Type == types.FileTypeZIP,
			Hash:        hash,
			FileSize:    fileSize,
			IsDuplicate: true,
		}, nil
	}

	// Generate archive ID
	archiveID := database.GenerateArchiveID()

	// Build storage key
	storageKey := buildArchiveKey(chainID, file.Filename, time.Now())

	// Storage metadata for compression decisions (file type determines if we compress)
	storageMetadata := &storage.Metadata{
		Custom: map[string]string{"file_type": string(file.Type)},
	}

	if err := storageBackend.Put(ctx, storageKey, fetched.Content, storageMetadata); err != nil {
		return nil, fmt.Errorf("failed to store file: %w", err)
	}

	// Create archive record in database with compression info
	fileSize64 := int64(fileSize)
	var compressedSize64 *int64
	var isCompressed bool

	// Check if file was compressed by storage layer
	if storageMetadata.CompressedSize > 0 {
		cs := storageMetadata.CompressedSize
		compressedSize64 = &cs
		isCompressed = true
	}

	// Build database metadata (replaces .meta files)
	fileTypeStr := string(file.Type)
	dbMetadata := jsonb.ArchiveMetadata{
		OriginalFilename: &file.Filename,
		FileType:         &fileTypeStr,
	}

	archive := &database.Archive{
		ID:             archiveID,
		ChainSlug:      chainID,
		SourceURL:      file.URL,
		Filename:       file.Filename,
		OriginalFormat: string(file.Type),
		ArchivePath:    storageKey,
		ArchiveType:    "local",
		FileSize:       &fileSize64,
		CompressedSize: compressedSize64,
		IsCompressed:   isCompressed,
		Checksum:       hash,
		DownloadedAt:   time.Now(),
		Metadata:       dbMetadata,
	}

	if err := database.CreateArchive(ctx, archive); err != nil {
		log.Warn().Err(err).Msg("Failed to create archive record")
		// Continue anyway - file is stored
	}

	log.Info().Str("filename", file.Filename).Int("file_size", fileSize).Str("hash", hash).Str("storage_key", storageKey).Msg("Archived file")

	return &FetchResult{
		StorageKey:  storageKey,
		Hash:        hash,
		Content:     fetched.Content,
		IsZip:       file.Type == types.FileTypeZIP,
		ArchiveID:   archiveID,
		FileSize:    fileSize,
		IsDuplicate: false,
	}, nil
}

// FetchPhaseWithRunId executes the fetch phase and links the archive to a run ID
// This version sets the run_id field on the archive record for Load+Cluster to query
func FetchPhaseWithRunId(ctx context.Context, chainID string, file types.DiscoveredFile, storageBackend storage.Storage, runID string) (*FetchResult, error) {
	// Get adapter from registry
	adapter, err := registry.GetAdapter(config.ChainID(chainID))
	if err != nil {
		return nil, fmt.Errorf("failed to get adapter for %s: %w", chainID, err)
	}

	log.Info().Str("filename", file.Filename).Str("url", file.URL).Str("runId", runID).Msg("Fetching file with run ID")

	// Fetch the file
	fetched, err := adapter.Fetch(file)
	if err != nil {
		return nil, fmt.Errorf("fetch failed for %s: %w", file.Filename, err)
	}

	// Compute hash and file size
	hash := computeSha256(fetched.Content)
	fileSize := len(fetched.Content)

	// Check file size limit (100MB max to prevent OOM)
	const maxFileSize = 100 * 1024 * 1024 // 100MB
	if fileSize > maxFileSize {
		return nil, fmt.Errorf("file %s exceeds maximum size of 100MB (got %d bytes)", file.Filename, fileSize)
	}

	// Check for duplicate by checksum in archives table
	existingArchive, err := database.GetArchiveByChecksum(ctx, hash)
	if err != nil && err != pgx.ErrNoRows {
		return nil, fmt.Errorf("failed to check archive: %w", err)
	}
	if existingArchive != nil {
		log.Info().Str("filename", file.Filename).Str("existing_archive", existingArchive.ID).Msg("Skipping duplicate file")
		return &FetchResult{
			ArchiveID:   existingArchive.ID,
			Content:     fetched.Content,
			IsZip:       file.Type == types.FileTypeZIP,
			Hash:        hash,
			FileSize:    fileSize,
			IsDuplicate: true,
			RunID:       runID,
		}, nil
	}

	// Generate archive ID
	archiveID := database.GenerateArchiveID()

	// Build storage key
	storageKey := buildArchiveKey(chainID, file.Filename, time.Now())

	// Storage metadata for compression decisions (file type determines if we compress)
	storageMetadata := &storage.Metadata{
		Custom: map[string]string{"file_type": string(file.Type)},
	}

	if err := storageBackend.Put(ctx, storageKey, fetched.Content, storageMetadata); err != nil {
		return nil, fmt.Errorf("failed to store file: %w", err)
	}

	// Create archive record in database with compression info and run_id
	fileSize64 := int64(fileSize)
	var compressedSize64 *int64
	var isCompressed bool

	// Check if file was compressed by storage layer
	if storageMetadata.CompressedSize > 0 {
		cs := storageMetadata.CompressedSize
		compressedSize64 = &cs
		isCompressed = true
	}

	// Build database metadata (replaces .meta files)
	fileTypeStr := string(file.Type)
	dbMetadata := jsonb.ArchiveMetadata{
		OriginalFilename: &file.Filename,
		FileType:         &fileTypeStr,
	}

	archive := &database.Archive{
		ID:             archiveID,
		ChainSlug:      chainID,
		SourceURL:      file.URL,
		Filename:       file.Filename,
		OriginalFormat: string(file.Type),
		ArchivePath:    storageKey,
		ArchiveType:    "local",
		FileSize:       &fileSize64,
		CompressedSize: compressedSize64,
		IsCompressed:   isCompressed,
		Checksum:       hash,
		DownloadedAt:   time.Now(),
		Metadata:       dbMetadata,
		RunID:          &runID,
	}

	if err := database.CreateArchiveWithRunId(ctx, archive); err != nil {
		log.Warn().Err(err).Msg("Failed to create archive record with run_id")
		// Continue anyway - file is stored
	}

	log.Info().
		Str("filename", file.Filename).
		Int("file_size", fileSize).
		Str("hash", hash).
		Str("storage_key", storageKey).
		Str("runId", runID).
		Msg("Archived file with run ID")

	return &FetchResult{
		StorageKey:  storageKey,
		Hash:        hash,
		Content:     fetched.Content,
		IsZip:       file.Type == types.FileTypeZIP,
		ArchiveID:   archiveID,
		FileSize:    fileSize,
		IsDuplicate: false,
		RunID:       runID,
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
