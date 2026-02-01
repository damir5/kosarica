package database

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/jsonb"
	"github.com/kosarica/price-service/internal/pkg/cuid2"
)

// Archive represents a stored archive file
type Archive struct {
	ID             string                `json:"id"`              // arc_{uuid}
	ChainSlug      string                `json:"chain_slug"`      // e.g., 'konzum', 'lidl'
	SourceURL      string                `json:"source_url"`      // Original download URL
	Filename       string                `json:"filename"`        // Original filename
	OriginalFormat string                `json:"original_format"` // 'csv', 'xml', 'xlsx', 'zip'
	ArchivePath    string                `json:"archive_path"`    // Storage key/path
	ArchiveType    string                `json:"archive_type"`    // 'local', 's3'
	ContentType    *string               `json:"content_type"`    // MIME type
	FileSize       *int64                `json:"file_size"`       // Size in bytes
	CompressedSize *int64                `json:"compressed_size"` // Compressed size if applicable
	IsCompressed   bool                  `json:"is_compressed"`   // Whether stored data is compressed
	Checksum       string                `json:"checksum"`        // SHA-256 checksum
	DownloadedAt   time.Time             `json:"downloaded_at"`   // When file was downloaded
	Metadata       jsonb.ArchiveMetadata `json:"metadata"`        // Typed archive metadata
	RunID          *string               `json:"run_id"`          // Ingestion run ID (for Load+Cluster)
	CreatedAt      time.Time             `json:"created_at"`
	UpdatedAt      time.Time             `json:"updated_at"`
}

// ArchiveFilterOptions contains options for filtering archives
type ArchiveFilterOptions struct {
	ChainSlug *string
	StartDate *time.Time
	EndDate   *time.Time
	Limit     int
	Offset    int
}

// CreateArchive creates a new archive record in the database
func CreateArchive(ctx context.Context, archive *Archive) error {
	queries := sqlcgen.New(Pool())

	now := time.Now()
	archive.CreatedAt = now
	archive.UpdatedAt = now

	return queries.UpsertArchive(ctx, sqlcgen.UpsertArchiveParams{
		ID:             archive.ID,
		ChainSlug:      archive.ChainSlug,
		SourceUrl:      archive.SourceURL,
		Filename:       archive.Filename,
		OriginalFormat: archive.OriginalFormat,
		ArchivePath:    archive.ArchivePath,
		ArchiveType:    archive.ArchiveType,
		ContentType:    stringPtrToPgText(archive.ContentType),
		FileSize:       int64PtrToPgInt8(archive.FileSize),
		CompressedSize: int64PtrToPgInt8(archive.CompressedSize),
		IsCompressed:   pgtype.Bool{Bool: archive.IsCompressed, Valid: true},
		Checksum:       archive.Checksum,
		DownloadedAt: pgtype.Timestamptz{
			Time:  archive.DownloadedAt,
			Valid: true,
		},
		Metadata: archive.Metadata,
		CreatedAt: pgtype.Timestamptz{
			Time:  archive.CreatedAt,
			Valid: true,
		},
		UpdatedAt: pgtype.Timestamptz{
			Time:  archive.UpdatedAt,
			Valid: true,
		},
	})
}

// CreateArchiveWithRunId creates a new archive record with run_id in the database
func CreateArchiveWithRunId(ctx context.Context, archive *Archive) error {
	queries := sqlcgen.New(Pool())

	now := time.Now()
	archive.CreatedAt = now
	archive.UpdatedAt = now

	return queries.UpsertArchiveWithRunId(ctx, sqlcgen.UpsertArchiveWithRunIdParams{
		ID:             archive.ID,
		ChainSlug:      archive.ChainSlug,
		SourceUrl:      archive.SourceURL,
		Filename:       archive.Filename,
		OriginalFormat: archive.OriginalFormat,
		ArchivePath:    archive.ArchivePath,
		ArchiveType:    archive.ArchiveType,
		ContentType:    stringPtrToPgText(archive.ContentType),
		FileSize:       int64PtrToPgInt8(archive.FileSize),
		CompressedSize: int64PtrToPgInt8(archive.CompressedSize),
		IsCompressed:   pgtype.Bool{Bool: archive.IsCompressed, Valid: true},
		Checksum:       archive.Checksum,
		DownloadedAt: pgtype.Timestamptz{
			Time:  archive.DownloadedAt,
			Valid: true,
		},
		Metadata: archive.Metadata,
		RunID:    stringPtrToPgText(archive.RunID),
		CreatedAt: pgtype.Timestamptz{
			Time:  archive.CreatedAt,
			Valid: true,
		},
		UpdatedAt: pgtype.Timestamptz{
			Time:  archive.UpdatedAt,
			Valid: true,
		},
	})
}

// GetArchivesByRunId retrieves all archives for a given run ID
func GetArchivesByRunId(ctx context.Context, runID string) ([]Archive, error) {
	queries := sqlcgen.New(Pool())

	rows, err := queries.ListArchivesByRunId(ctx, pgtype.Text{String: runID, Valid: true})
	if err != nil {
		return nil, err
	}

	archives := make([]Archive, len(rows))
	for i, row := range rows {
		archives[i] = *convertListArchivesByRunIdRow(row)
	}

	return archives, nil
}

// UpdateArchiveRunId updates the run_id of an existing archive
// This is used to link duplicate archives to the current run
func UpdateArchiveRunId(ctx context.Context, archiveID string, runID string) error {
	queries := sqlcgen.New(Pool())

	return queries.UpdateArchiveRunId(ctx, sqlcgen.UpdateArchiveRunIdParams{
		ID:    archiveID,
		RunID: pgtype.Text{String: runID, Valid: true},
	})
}

// GetArchiveByChecksum looks up an archive by its checksum for deduplication
func GetArchiveByChecksum(ctx context.Context, checksum string) (*Archive, error) {
	queries := sqlcgen.New(Pool())

	row, err := queries.GetArchiveByChecksum(ctx, checksum)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, err
		}
		return nil, err
	}

	return convertGetArchiveByChecksumRow(row), nil
}

// GetArchiveByID retrieves an archive by its ID
func GetArchiveByID(ctx context.Context, id string) (*Archive, error) {
	queries := sqlcgen.New(Pool())

	row, err := queries.GetArchiveById(ctx, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, err
		}
		return nil, err
	}

	return convertGetArchiveByIdRow(row), nil
}

// GetArchivesByChain retrieves archives for a chain with pagination
func GetArchivesByChain(ctx context.Context, chainSlug string, limit, offset int) ([]Archive, error) {
	queries := sqlcgen.New(Pool())

	rows, err := queries.ListArchivesByChain(ctx, sqlcgen.ListArchivesByChainParams{
		ChainSlug: chainSlug,
		Limit:     int32(limit),
		Offset:    int32(offset),
	})
	if err != nil {
		return nil, err
	}

	archives := make([]Archive, len(rows))
	for i, row := range rows {
		archives[i] = *convertListArchivesByChainRow(row)
	}

	return archives, nil
}

// LinkArchiveToIngestionRun associates an archive with an ingestion run
// It also sets the source_url from the archive's source_url
func LinkArchiveToIngestionRun(ctx context.Context, archiveID, runID string) error {
	queries := sqlcgen.New(Pool())

	return queries.LinkArchiveToRun(ctx, sqlcgen.LinkArchiveToRunParams{
		ArchiveID: pgtype.Text{String: archiveID, Valid: true},
		ID:        runID,
	})
}

// UpdateRetailerItemArchiveID links retailer items to their source archive
func UpdateRetailerItemArchiveID(ctx context.Context, itemIDs []string, archiveID string) error {
	if len(itemIDs) == 0 {
		return nil
	}

	queries := sqlcgen.New(Pool())

	return queries.UpdateRetailerItemsArchiveId(ctx, sqlcgen.UpdateRetailerItemsArchiveIdParams{
		ArchiveID: pgtype.Text{String: archiveID, Valid: true},
		Column2:   itemIDs,
	})
}

// CalculateChecksum calculates SHA-256 checksum for data
func CalculateChecksum(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

// GenerateArchiveID generates a new archive ID with arc_ prefix
func GenerateArchiveID() string {
	return cuid2.GeneratePrefixedId("arc", cuid2.PrefixedIdOptions{})
}

// Helper functions for type conversion

func convertSqlcArchive(a sqlcgen.Archive) *Archive {
	return &Archive{
		ID:             a.ID,
		ChainSlug:      a.ChainSlug,
		SourceURL:      a.SourceUrl,
		Filename:       a.Filename,
		OriginalFormat: a.OriginalFormat,
		ArchivePath:    a.ArchivePath,
		ArchiveType:    a.ArchiveType,
		ContentType:    pgTextToStringPtr(a.ContentType),
		FileSize:       pgInt8ToInt64Ptr(a.FileSize),
		CompressedSize: pgInt8ToInt64Ptr(a.CompressedSize),
		IsCompressed:   a.IsCompressed.Bool,
		Checksum:       a.Checksum,
		DownloadedAt:   a.DownloadedAt.Time,
		Metadata:       a.Metadata,
		CreatedAt:      a.CreatedAt.Time,
		UpdatedAt:      a.UpdatedAt.Time,
	}
}

func convertGetArchiveByChecksumRow(a sqlcgen.GetArchiveByChecksumRow) *Archive {
	return &Archive{
		ID:             a.ID,
		ChainSlug:      a.ChainSlug,
		SourceURL:      a.SourceUrl,
		Filename:       a.Filename,
		OriginalFormat: a.OriginalFormat,
		ArchivePath:    a.ArchivePath,
		ArchiveType:    a.ArchiveType,
		ContentType:    pgTextToStringPtr(a.ContentType),
		FileSize:       pgInt8ToInt64Ptr(a.FileSize),
		CompressedSize: pgInt8ToInt64Ptr(a.CompressedSize),
		IsCompressed:   a.IsCompressed.Bool,
		Checksum:       a.Checksum,
		DownloadedAt:   a.DownloadedAt.Time,
		Metadata:       a.Metadata,
		RunID:          pgTextToStringPtr(a.RunID),
		CreatedAt:      a.CreatedAt.Time,
		UpdatedAt:      a.UpdatedAt.Time,
	}
}

func convertGetArchiveByIdRow(a sqlcgen.GetArchiveByIdRow) *Archive {
	return &Archive{
		ID:             a.ID,
		ChainSlug:      a.ChainSlug,
		SourceURL:      a.SourceUrl,
		Filename:       a.Filename,
		OriginalFormat: a.OriginalFormat,
		ArchivePath:    a.ArchivePath,
		ArchiveType:    a.ArchiveType,
		ContentType:    pgTextToStringPtr(a.ContentType),
		FileSize:       pgInt8ToInt64Ptr(a.FileSize),
		CompressedSize: pgInt8ToInt64Ptr(a.CompressedSize),
		IsCompressed:   a.IsCompressed.Bool,
		Checksum:       a.Checksum,
		DownloadedAt:   a.DownloadedAt.Time,
		Metadata:       a.Metadata,
		RunID:          pgTextToStringPtr(a.RunID),
		CreatedAt:      a.CreatedAt.Time,
		UpdatedAt:      a.UpdatedAt.Time,
	}
}

func convertListArchivesByChainRow(a sqlcgen.ListArchivesByChainRow) *Archive {
	return &Archive{
		ID:             a.ID,
		ChainSlug:      a.ChainSlug,
		SourceURL:      a.SourceUrl,
		Filename:       a.Filename,
		OriginalFormat: a.OriginalFormat,
		ArchivePath:    a.ArchivePath,
		ArchiveType:    a.ArchiveType,
		ContentType:    pgTextToStringPtr(a.ContentType),
		FileSize:       pgInt8ToInt64Ptr(a.FileSize),
		CompressedSize: pgInt8ToInt64Ptr(a.CompressedSize),
		IsCompressed:   a.IsCompressed.Bool,
		Checksum:       a.Checksum,
		DownloadedAt:   a.DownloadedAt.Time,
		Metadata:       a.Metadata,
		RunID:          pgTextToStringPtr(a.RunID),
		CreatedAt:      a.CreatedAt.Time,
		UpdatedAt:      a.UpdatedAt.Time,
	}
}

func convertListArchivesByRunIdRow(a sqlcgen.ListArchivesByRunIdRow) *Archive {
	return &Archive{
		ID:             a.ID,
		ChainSlug:      a.ChainSlug,
		SourceURL:      a.SourceUrl,
		Filename:       a.Filename,
		OriginalFormat: a.OriginalFormat,
		ArchivePath:    a.ArchivePath,
		ArchiveType:    a.ArchiveType,
		ContentType:    pgTextToStringPtr(a.ContentType),
		FileSize:       pgInt8ToInt64Ptr(a.FileSize),
		CompressedSize: pgInt8ToInt64Ptr(a.CompressedSize),
		IsCompressed:   a.IsCompressed.Bool,
		Checksum:       a.Checksum,
		DownloadedAt:   a.DownloadedAt.Time,
		Metadata:       a.Metadata,
		RunID:          pgTextToStringPtr(a.RunID),
		CreatedAt:      a.CreatedAt.Time,
		UpdatedAt:      a.UpdatedAt.Time,
	}
}

func stringPtrToPgText(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: *s, Valid: true}
}

func pgTextToStringPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	return &t.String
}

func int64PtrToPgInt8(p *int64) pgtype.Int8 {
	if p == nil {
		return pgtype.Int8{Valid: false}
	}
	return pgtype.Int8{Int64: *p, Valid: true}
}

func pgInt8ToInt64Ptr(p pgtype.Int8) *int64 {
	if !p.Valid {
		return nil
	}
	return &p.Int64
}
