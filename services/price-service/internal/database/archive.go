package database

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Archive represents a stored archive file
type Archive struct {
	ID             string    `json:"id"`              // arc_{uuid}
	ChainSlug      string    `json:"chain_slug"`      // e.g., 'konzum', 'lidl'
	SourceURL      string    `json:"source_url"`      // Original download URL
	Filename       string    `json:"filename"`        // Original filename
	OriginalFormat string    `json:"original_format"` // 'csv', 'xml', 'xlsx', 'zip'
	ArchivePath    string    `json:"archive_path"`    // Storage key/path
	ArchiveType    string    `json:"archive_type"`    // 'local', 's3'
	ContentType    *string   `json:"content_type"`    // MIME type
	FileSize       *int64    `json:"file_size"`       // Size in bytes
	CompressedSize *int64    `json:"compressed_size"` // Compressed size if applicable
	Checksum       string    `json:"checksum"`        // SHA-256 checksum
	DownloadedAt   time.Time `json:"downloaded_at"`   // When file was downloaded
	Metadata       *string   `json:"metadata"`        // JSON metadata
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// ArchiveFilterOptions contains options for filtering archives
type ArchiveFilterOptions struct {
	ChainSlug   *string
	StartDate   *time.Time
	EndDate     *time.Time
	Limit       int
	Offset      int
}

// CreateArchive creates a new archive record in the database
func CreateArchive(ctx context.Context, archive *Archive) error {
	pool := Pool()

	now := time.Now()
	archive.CreatedAt = now
	archive.UpdatedAt = now

	query := `
		INSERT INTO archives (
			id, chain_slug, source_url, filename, original_format,
			archive_path, archive_type, content_type, file_size,
			compressed_size, checksum, downloaded_at, metadata,
			created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
		)
		ON CONFLICT (id) DO UPDATE SET
			source_url = EXCLUDED.source_url,
			filename = EXCLUDED.filename,
			archive_path = EXCLUDED.archive_path,
			original_format = EXCLUDED.original_format,
			archive_type = EXCLUDED.archive_type,
			content_type = EXCLUDED.content_type,
			file_size = EXCLUDED.file_size,
			compressed_size = EXCLUDED.compressed_size,
			checksum = EXCLUDED.checksum,
			downloaded_at = EXCLUDED.downloaded_at,
			metadata = EXCLUDED.metadata,
			updated_at = EXCLUDED.updated_at
	`

	_, err := pool.Exec(ctx, query,
		archive.ID, archive.ChainSlug, archive.SourceURL, archive.Filename,
		archive.OriginalFormat, archive.ArchivePath, archive.ArchiveType,
		archive.ContentType, archive.FileSize, archive.CompressedSize,
		archive.Checksum, archive.DownloadedAt, archive.Metadata,
		archive.CreatedAt, archive.UpdatedAt,
	)

	return err
}

// GetArchiveByChecksum looks up an archive by its checksum for deduplication
func GetArchiveByChecksum(ctx context.Context, checksum string) (*Archive, error) {
	pool := Pool()

	query := `
		SELECT id, chain_slug, source_url, filename, original_format,
			archive_path, archive_type, content_type, file_size,
			compressed_size, checksum, downloaded_at, metadata,
			created_at, updated_at
		FROM archives
		WHERE checksum = $1
		LIMIT 1
	`

	row := pool.QueryRow(ctx, query, checksum)

	var archive Archive
	err := row.Scan(
		&archive.ID, &archive.ChainSlug, &archive.SourceURL, &archive.Filename,
		&archive.OriginalFormat, &archive.ArchivePath, &archive.ArchiveType,
		&archive.ContentType, &archive.FileSize, &archive.CompressedSize,
		&archive.Checksum, &archive.DownloadedAt, &archive.Metadata,
		&archive.CreatedAt, &archive.UpdatedAt,
	)

	if err != nil {
		return nil, err
	}

	return &archive, nil
}

// GetArchiveByID retrieves an archive by its ID
func GetArchiveByID(ctx context.Context, id string) (*Archive, error) {
	pool := Pool()

	query := `
		SELECT id, chain_slug, source_url, filename, original_format,
			archive_path, archive_type, content_type, file_size,
			compressed_size, checksum, downloaded_at, metadata,
			created_at, updated_at
		FROM archives
		WHERE id = $1
	`

	row := pool.QueryRow(ctx, query, id)

	var archive Archive
	err := row.Scan(
		&archive.ID, &archive.ChainSlug, &archive.SourceURL, &archive.Filename,
		&archive.OriginalFormat, &archive.ArchivePath, &archive.ArchiveType,
		&archive.ContentType, &archive.FileSize, &archive.CompressedSize,
		&archive.Checksum, &archive.DownloadedAt, &archive.Metadata,
		&archive.CreatedAt, &archive.UpdatedAt,
	)

	if err != nil {
		return nil, err
	}

	return &archive, nil
}

// GetArchivesByChain retrieves archives for a chain with pagination
func GetArchivesByChain(ctx context.Context, chainSlug string, limit, offset int) ([]Archive, error) {
	pool := Pool()

	query := `
		SELECT id, chain_slug, source_url, filename, original_format,
			archive_path, archive_type, content_type, file_size,
			compressed_size, checksum, downloaded_at, metadata,
			created_at, updated_at
		FROM archives
		WHERE chain_slug = $1
		ORDER BY downloaded_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := pool.Query(ctx, query, chainSlug, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	archives := make([]Archive, 0)
	for rows.Next() {
		var archive Archive
		err := rows.Scan(
			&archive.ID, &archive.ChainSlug, &archive.SourceURL, &archive.Filename,
			&archive.OriginalFormat, &archive.ArchivePath, &archive.ArchiveType,
			&archive.ContentType, &archive.FileSize, &archive.CompressedSize,
			&archive.Checksum, &archive.DownloadedAt, &archive.Metadata,
			&archive.CreatedAt, &archive.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		archives = append(archives, archive)
	}

	return archives, nil
}

// LinkArchiveToIngestionRun associates an archive with an ingestion run
// It also sets the source_url from the archive's source_url
func LinkArchiveToIngestionRun(ctx context.Context, archiveID, runID string) error {
	pool := Pool()

	query := `
		UPDATE ingestion_runs
		SET archive_id = $1,
		    source_url = (
		        SELECT source_url FROM archives WHERE id = $1
		    )
		WHERE id = $2
	`

	_, err := pool.Exec(ctx, query, archiveID, runID)
	return err
}

// UpdateRetailerItemArchiveID links retailer items to their source archive
func UpdateRetailerItemArchiveID(ctx context.Context, itemIDs []string, archiveID string) error {
	if len(itemIDs) == 0 {
		return nil
	}

	pool := Pool()

	query := `
		UPDATE retailer_items
		SET archive_id = $1
		WHERE id = ANY($2)
	`

	_, err := pool.Exec(ctx, query, archiveID, itemIDs)
	return err
}

// CalculateChecksum calculates SHA-256 checksum for data
func CalculateChecksum(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

// GenerateArchiveID generates a new archive ID with arc_ prefix
func GenerateArchiveID() string {
	return fmt.Sprintf("arc_%s", uuid.New().String())
}
