package cuid2

import (
	"math/big"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestEncodeTimestampBase64(t *testing.T) {
	tests := []struct {
		name     string
		seconds  int64
		expected string
	}{
		{"Zero timestamp", 0, "000000"},
		{"One second", 1, "000001"},
		{"62 seconds", 62, "000010"},
		{"One minute", 60, "00000y"},
		{"One hour", 3600, "0000w4"},
		{"One day", 86400, "000MTY"},
		{"Unix epoch test", 1704067200, "1rK5iq"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := EncodeTimestampBase64(tt.seconds)
			if result != tt.expected {
				t.Errorf("EncodeTimestampBase64(%d) = %s, want %s", tt.seconds, result, tt.expected)
			}
		})
	}

	// Verify base62 encoding consistency by checking specific values
	testEncodings := map[int64]string{
		0:          "000000",
		1:          "000001",
		62:         "000010",
		60:         "00000y",
		3600:       "0000w4",
		86400:      "000MTY",
		1704067200:  "1rK5iq",
	}

	for seconds, expected := range testEncodings {
		result := EncodeTimestampBase64(seconds)
		if result != expected {
			t.Errorf("Base62 encoding mismatch for %d: got %s, want %s", seconds, result, expected)
		}
	}

	result := EncodeTimestampBase64(1234567890)
	for _, c := range result {
		if !strings.ContainsRune(base62Alphabet, c) {
			t.Errorf("Result contains non-base62 character: %c in %s", c, result)
		}
	}
}

func TestGenerateCuidLikeId(t *testing.T) {
	length := 24
	id := generateCuidLikeId(length)

	if len(id) != length {
		t.Errorf("Generated ID length = %d, want %d", len(id), length)
	}

	for _, c := range id {
		if !strings.ContainsRune(base62Alphabet, c) {
			t.Errorf("ID contains non-base62 character: %c in %s", c, id)
		}
	}

	ids := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		id := generateCuidLikeId(length)
		if ids[id] {
			t.Errorf("Generated duplicate ID: %s", id)
		}
		ids[id] = true
	}
}

func TestGeneratePrefixedId(t *testing.T) {
	id := GeneratePrefixedId("usr", PrefixedIdOptions{})
	if !strings.HasPrefix(id, "usr_") {
		t.Errorf("ID doesn't have expected prefix: got %s, want prefix 'usr_'", id)
	}

	parts := strings.Split(id, "_")
	if len(parts) != 2 {
		t.Errorf("ID format incorrect: %s", id)
	}

	timestampPart := parts[1][:6]
	if len(timestampPart) != 6 {
		t.Errorf("Timestamp part should be 6 characters: got %d", len(timestampPart))
	}

	randomPart := parts[1][6:]
	if len(randomPart) != 18 {
		t.Errorf("Random part should be 18 characters: got %d", len(randomPart))
	}

	id2 := GeneratePrefixedId("usr", PrefixedIdOptions{
		TimeSortable: false,
	})
	if !strings.HasPrefix(id2, "usr_") {
		t.Errorf("Non-time-sortable ID doesn't have expected prefix: got %s", id2)
	}

	parts2 := strings.Split(id2, "_")
	if len(parts2) != 2 {
		t.Errorf("Non-time-sortable ID format incorrect: %s", id2)
	}

	if len(parts2[1]) != 24 {
		t.Errorf("Non-time-sortable random part should be 24 characters: got %d", len(parts2[1]))
	}

	id3 := GeneratePrefixedId("test", PrefixedIdOptions{
		RandomLength: 10,
	})
	randomPart3 := strings.Split(id3, "_")[1]
	if len(randomPart3) != 16 {
		t.Errorf("Custom length ID random part should be 16 characters (6 timestamp + 10 random): got %d", len(randomPart3))
	}
}

func TestGeneratePrefixedIdUniqueness(t *testing.T) {
	ids := make(map[string]bool)
	prefixes := []string{"run", "arc", "grp", "itm", "sid", "bid"}

	for i := 0; i < 10000; i++ {
		for _, prefix := range prefixes {
			id := GeneratePrefixedId(prefix, PrefixedIdOptions{})
			if ids[id] {
				t.Errorf("Generated duplicate ID: %s", id)
			}
			ids[id] = true
		}
	}
}

func TestTimeSortability(t *testing.T) {
	id1 := GeneratePrefixedId("test", PrefixedIdOptions{})
	time.Sleep(10 * time.Millisecond)
	id2 := GeneratePrefixedId("test", PrefixedIdOptions{})
	time.Sleep(10 * time.Millisecond)
	id3 := GeneratePrefixedId("test", PrefixedIdOptions{})

	extractTimestamp := func(id string) string {
		parts := strings.Split(id, "_")
		if len(parts) != 2 {
			return ""
		}
		return parts[1][:6]
	}

	timestamp1 := extractTimestamp(id1)
	timestamp2 := extractTimestamp(id2)
	timestamp3 := extractTimestamp(id3)

	if timestamp1 > timestamp2 {
		t.Errorf("Timestamps not sorted: %s > %s", timestamp1, timestamp2)
	}
	if timestamp2 > timestamp3 {
		t.Errorf("Timestamps not sorted: %s > %s", timestamp2, timestamp3)
	}
}

func TestPrefixedIdFormat(t *testing.T) {
	id := GeneratePrefixedId("run", PrefixedIdOptions{})

	if len(id) != 28 {
		t.Errorf("ID length incorrect: got %d, want 28", len(id))
	}

	if !strings.HasPrefix(id, "run_") {
		t.Errorf("ID doesn't have correct prefix: %s", id)
	}

	matched, _ := regexp.MatchString(`^run_[0-9A-Za-z]{24}$`, id)
	if !matched {
		t.Errorf("ID format doesn't match expected pattern: %s", id)
	}
}

func TestAllPrefixes(t *testing.T) {
	prefixes := []string{"run_", "arc_", "grp_", "itm_", "sid_", "bid_"}

	for _, prefix := range prefixes {
		prefixWithoutUnderscore := strings.TrimSuffix(prefix, "_")
		id := GeneratePrefixedId(prefixWithoutUnderscore, PrefixedIdOptions{})

		if !strings.HasPrefix(id, prefix) {
			t.Errorf("ID with prefix %s doesn't start with correct prefix: %s", prefixWithoutUnderscore, id)
		}

		// Verify all characters after prefix are base62
		randomPart := strings.TrimPrefix(id, prefix)
		for _, c := range randomPart {
			if !strings.ContainsRune(base62Alphabet, c) {
				t.Errorf("ID %s contains non-base62 character: %c", id, c)
			}
		}
	}
}

func TestRandomBigInt(t *testing.T) {
	max := big.NewInt(1000)

	for i := 0; i < 100; i++ {
		n, err := RandomBigInt(max)
		if err != nil {
			t.Errorf("RandomBigInt failed: %v", err)
		}

		if n.Cmp(max) >= 0 {
			t.Errorf("Generated value %d is >= max %d", n, max)
		}

		if n.Sign() < 0 {
			t.Errorf("Generated value %d is negative", n)
		}
	}
}
