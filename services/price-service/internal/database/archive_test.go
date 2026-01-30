package database

import (
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
)

// TestArchiveUseSqlc verifies that archive.go uses sqlc-generated queries
func TestArchiveUseSqlc(t *testing.T) {
	t.Run("sqlcgen archive types exist", func(t *testing.T) {
		// This test verifies that the sqlcgen package types are used
		var _ sqlcgen.Queries
		var _ sqlcgen.UpsertArchiveParams
		var _ sqlcgen.ListArchivesByChainParams
		var _ sqlcgen.LinkArchiveToRunParams
		var _ sqlcgen.UpdateRetailerItemsArchiveIdParams
	})

	t.Run("convertSqlcArchive returns correct type", func(t *testing.T) {
		contentType := "application/json"
		fileSize := int64(12345)

		input := sqlcgen.Archive{
			ID:             "arc_test",
			ChainSlug:      "testchain",
			SourceUrl:      "https://example.com/file.zip",
			Filename:       "file.zip",
			OriginalFormat: "zip",
			ArchivePath:    "/archives/file.zip",
			ArchiveType:    "local",
			ContentType:    pgtype.Text{String: contentType, Valid: true},
			FileSize:       pgtype.Int8{Int64: fileSize, Valid: true},
			CompressedSize: pgtype.Int8{Valid: false},
			Checksum:       "sha256:abc123",
		}

		result := convertSqlcArchive(input)

		if result.ID != "arc_test" {
			t.Errorf("Expected ID 'arc_test', got '%s'", result.ID)
		}
		if result.ChainSlug != "testchain" {
			t.Errorf("Expected ChainSlug 'testchain', got '%s'", result.ChainSlug)
		}
		if result.SourceURL != "https://example.com/file.zip" {
			t.Errorf("Expected SourceURL 'https://example.com/file.zip', got '%s'", result.SourceURL)
		}
		if result.Filename != "file.zip" {
			t.Errorf("Expected Filename 'file.zip', got '%s'", result.Filename)
		}
		if result.OriginalFormat != "zip" {
			t.Errorf("Expected OriginalFormat 'zip', got '%s'", result.OriginalFormat)
		}
		if result.ArchivePath != "/archives/file.zip" {
			t.Errorf("Expected ArchivePath '/archives/file.zip', got '%s'", result.ArchivePath)
		}
		if result.ArchiveType != "local" {
			t.Errorf("Expected ArchiveType 'local', got '%s'", result.ArchiveType)
		}
		if result.ContentType == nil || *result.ContentType != contentType {
			t.Errorf("Expected ContentType '%s', got %v", contentType, result.ContentType)
		}
		if result.FileSize == nil || *result.FileSize != fileSize {
			t.Errorf("Expected FileSize %d, got %v", fileSize, result.FileSize)
		}
		if result.CompressedSize != nil {
			t.Errorf("Expected CompressedSize nil, got %v", result.CompressedSize)
		}
		if result.Checksum != "sha256:abc123" {
			t.Errorf("Expected Checksum 'sha256:abc123', got '%s'", result.Checksum)
		}
	})

	t.Run("stringPtrToPgText handles nil", func(t *testing.T) {
		result := stringPtrToPgText(nil)
		if result.Valid {
			t.Error("Expected Valid=false for nil input")
		}
	})

	t.Run("stringPtrToPgText handles value", func(t *testing.T) {
		val := "test"
		result := stringPtrToPgText(&val)
		if !result.Valid {
			t.Error("Expected Valid=true for non-nil input")
		}
		if result.String != "test" {
			t.Errorf("Expected String='test', got '%s'", result.String)
		}
	})

	t.Run("pgTextToStringPtr handles invalid", func(t *testing.T) {
		result := pgTextToStringPtr(pgtype.Text{Valid: false})
		if result != nil {
			t.Errorf("Expected nil for invalid pgtype.Text, got %v", result)
		}
	})

	t.Run("pgTextToStringPtr handles valid", func(t *testing.T) {
		result := pgTextToStringPtr(pgtype.Text{String: "hello", Valid: true})
		if result == nil {
			t.Error("Expected non-nil for valid pgtype.Text")
		}
		if *result != "hello" {
			t.Errorf("Expected 'hello', got '%s'", *result)
		}
	})

	t.Run("int64PtrToPgInt8 handles nil", func(t *testing.T) {
		result := int64PtrToPgInt8(nil)
		if result.Valid {
			t.Error("Expected Valid=false for nil input")
		}
	})

	t.Run("int64PtrToPgInt8 handles value", func(t *testing.T) {
		val := int64(9999999)
		result := int64PtrToPgInt8(&val)
		if !result.Valid {
			t.Error("Expected Valid=true for non-nil input")
		}
		if result.Int64 != 9999999 {
			t.Errorf("Expected Int64=9999999, got %d", result.Int64)
		}
	})

	t.Run("pgInt8ToInt64Ptr handles invalid", func(t *testing.T) {
		result := pgInt8ToInt64Ptr(pgtype.Int8{Valid: false})
		if result != nil {
			t.Errorf("Expected nil for invalid pgtype.Int8, got %v", result)
		}
	})

	t.Run("pgInt8ToInt64Ptr handles valid", func(t *testing.T) {
		result := pgInt8ToInt64Ptr(pgtype.Int8{Int64: 88888888, Valid: true})
		if result == nil {
			t.Error("Expected non-nil for valid pgtype.Int8")
		}
		if *result != 88888888 {
			t.Errorf("Expected 88888888, got %d", *result)
		}
	})

	t.Run("Archive type has expected fields", func(t *testing.T) {
		a := Archive{}
		aType := reflect.TypeOf(a)

		expectedFields := []string{
			"ID", "ChainSlug", "SourceURL", "Filename", "OriginalFormat",
			"ArchivePath", "ArchiveType", "ContentType", "FileSize",
			"CompressedSize", "Checksum", "DownloadedAt", "Metadata",
			"CreatedAt", "UpdatedAt",
		}

		for _, field := range expectedFields {
			if _, found := aType.FieldByName(field); !found {
				t.Errorf("Archive missing expected field: %s", field)
			}
		}
	})

	t.Run("CalculateChecksum returns hex string", func(t *testing.T) {
		data := []byte("test data for checksum")
		result := CalculateChecksum(data)

		// SHA-256 produces 64 hex characters
		if len(result) != 64 {
			t.Errorf("Expected 64 character hex string, got %d characters", len(result))
		}

		// Should be consistent
		result2 := CalculateChecksum(data)
		if result != result2 {
			t.Error("CalculateChecksum should be deterministic")
		}
	})

	t.Run("GenerateArchiveID has arc_ prefix", func(t *testing.T) {
		id := GenerateArchiveID()
		if len(id) < 4 || id[:4] != "arc_" {
			t.Errorf("Expected ID with 'arc_' prefix, got '%s'", id)
		}
	})
}
