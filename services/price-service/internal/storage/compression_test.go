package storage

import (
	"testing"
)

// TestCompressionDecompression tests gzip compression roundtrip
func TestCompressionDecompression(t *testing.T) {
	tests := []struct {
		name string
		data string
	}{
		{
			name: "small csv data",
			data: "product,price\ncola,10\nbread,5\n",
		},
		{
			name: "larger csv data",
			data: generateLargeCSV(1000),
		},
		{
			name: "json data",
			data: `{"products":[{"name":"cola","price":10},{"name":"bread","price":5}]}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testData := []byte(tt.data)

			// Test compression
			compressed, err := CompressWithGzip(testData)
			if err != nil {
				t.Fatalf("Compress failed: %v", err)
			}

			// Test decompression
			decompressed, err := DecompressGzip(compressed)
			if err != nil {
				t.Fatalf("Decompress failed: %v", err)
			}

			// Verify data integrity
			if string(decompressed) != string(testData) {
				t.Errorf("Decompressed data mismatch\nGot: %s\nWant: %s", string(decompressed), string(testData))
			}

			// Verify compression ratio
			if len(compressed) >= len(testData) {
				t.Logf("Warning: compression didn't reduce size (got %d, original %d)",
					len(compressed), len(testData))
			} else {
				ratio := float64(len(compressed)) / float64(len(testData)) * 100
				t.Logf("Compression ratio: %.1f%% (%d/%d bytes)", ratio, len(compressed), len(testData))
			}
		})
	}
}

// TestShouldCompress tests the ShouldCompress function
func TestShouldCompress(t *testing.T) {
	tests := []struct {
		name     string
		fileType string
		want     bool
	}{
		{"csv should compress", "csv", true},
		{"xml should compress", "xml", true},
		{"json should compress", "json", true},
		{"xlsx should not compress", "xlsx", false},
		{"xls should not compress", "xls", false},
		{"zip should not compress", "zip", false},
		{"gz should not compress", "gz", false},
		{"bz2 should not compress", "bz2", false},
		{"xz should not compress", "xz", false},
		{"zst should not compress", "zst", false},
		{"unknown type should not compress", "unknown", false},
		{"empty should not compress", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ShouldCompress(tt.fileType); got != tt.want {
				t.Errorf("ShouldCompress(%q) = %v, want %v", tt.fileType, got, tt.want)
			}
		})
	}
}

// TestDecompressWithInvalidData tests error handling for corrupted data
func TestDecompressWithInvalidData(t *testing.T) {
	invalidData := []byte("this is not gzip compressed data")

	_, err := DecompressGzip(invalidData)
	if err == nil {
		t.Error("Expected error when decompressing invalid data, got nil")
	}
}

// generateLargeCSV generates a CSV with the specified number of rows
func generateLargeCSV(rows int) string {
	result := "product,price,barcode\n"
	for i := 0; i < rows; i++ {
		result += "product_" + string(rune('A'+i%26)) + "," + "10.0\n"
	}
	return result
}
