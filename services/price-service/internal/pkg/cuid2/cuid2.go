package cuid2

import (
	crypto_rand "crypto/rand"
	"math/big"
	"math/rand"
	"strings"
	"time"
)

// Base62 alphabet: 0-9, A-Z, a-z (62 characters)
const base62Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// randomBytes reads random bytes with fallback to math/rand if crypto/rand fails
func randomBytes(p []byte) error {
	// Try crypto/rand first
	_, err := crypto_rand.Read(p)
	if err == nil {
		return nil
	}
	
	// Fallback to math/rand if crypto/rand fails
	// This is less secure but prevents service crash
	rand.Seed(time.Now().UnixNano())
	n, err := rand.Read(p)
	if err != nil {
		return err
	}
	if n != len(p) {
		return err
	}
	return nil
}

// EncodeTimestampBase62 encodes a Unix timestamp (seconds) as a 6-character base62 string.
// Produces lexicographically sortable output for timestamps.
//
// Range: 0 to ~56 billion seconds (~1800 years from Unix epoch)
func EncodeTimestampBase62(timestampSeconds int64) string {
	n := timestampSeconds
	result := make([]byte, 6)
	for i := 5; i >= 0; i-- {
		remainder := n % 62
		result[i] = base62Alphabet[remainder]
		n = n / 62
	}
	return string(result)
}

// EncodeTimestampBase64 is an alias for EncodeTimestampBase62 for backward compatibility
func EncodeTimestampBase64(timestampSeconds int64) string {
	return EncodeTimestampBase62(timestampSeconds)
}

// generateCuidLikeId generates a CUID-like ID using base62 encoding with rejection sampling.
// Compatible with crypto/rand for secure randomness.
//
// Uses bit extraction with rejection sampling for uniform distribution:
// - Extracts 6 bits at a time (values 0-63)
// - Rejects values >= 62 to maintain uniform distribution
// - ~5.95 bits of entropy per character (log2(62))
func generateCuidLikeId(length int) string {
	// Request extra bytes to account for rejection sampling (~3% rejection rate)
	bytesNeeded := (length*6)/8 + 4
	bytes := make([]byte, bytesNeeded)
	if err := randomBytes(bytes); err != nil {
		// Last resort: use timestamp-based ID
		return EncodeTimestampBase62(time.Now().Unix()) + string(base62Alphabet)[0:length-6]
	}

	var result strings.Builder
	bitBuffer := uint64(0)
	bitsInBuffer := uint(0)
	byteIndex := 0

	for result.Len() < length {
		// Refill buffer if needed
		for bitsInBuffer < 6 && byteIndex < len(bytes) {
			bitBuffer = (bitBuffer << 8) | uint64(bytes[byteIndex])
			bitsInBuffer += 8
			byteIndex++
		}

		// Extract 6 bits
		value := (bitBuffer >> (bitsInBuffer - 6)) & 0x3f
		bitsInBuffer -= 6

		// Rejection sampling: only accept values < 62 for uniform distribution
		if value < 62 {
			result.WriteByte(base62Alphabet[value])
		}

		// If we run out of bytes (unlikely), get more
		if byteIndex >= len(bytes) && result.Len() < length {
			if err := randomBytes(bytes); err != nil {
				// Last resort: append timestamp to complete
				return result.String() + EncodeTimestampBase62(time.Now().Unix())[:length-result.Len()]
			}
			byteIndex = 0
			bitBuffer = 0
			bitsInBuffer = 0
		}
	}

	return result.String()
}

// PrefixedIdOptions for generating prefixed IDs.
type PrefixedIdOptions struct {
	// TimeSortable include time-sortable prefix for B-tree index locality (default: true).
	// When true, adds a 6-char base62 timestamp prefix.
	TimeSortable bool
	// RandomLength of random portion (default: 18 if TimeSortable, 24 otherwise).
	RandomLength int
}

// GeneratePrefixedId generates a prefixed ID using CUID-like random strings.
// By default, includes a time-sortable prefix for B-tree index locality.
//
// Examples:
//
//	GeneratePrefixedId("usr")                                      // "usr_0CL2KwaB3cD5eF7gH9iJ1k" (time-sortable)
//	GeneratePrefixedId("usr", PrefixedIdOptions{TimeSortable: false}) // "usr_8kJ2mN4pQ6rS0tU3vW5xY7zA" (pure random)
func GeneratePrefixedId(prefix string, options PrefixedIdOptions) string {
	timeSortable := true
	randomLength := 0

	if options.TimeSortable {
		timeSortable = options.TimeSortable
	}
	if options.RandomLength > 0 {
		randomLength = options.RandomLength
	}

	if timeSortable {
		timestamp := EncodeTimestampBase62(time.Now().Unix())
		if randomLength == 0 {
			randomLength = 18
		}
		return prefix + "_" + timestamp + generateCuidLikeId(randomLength)
	}

	if randomLength == 0 {
		randomLength = 24
	}
	return prefix + "_" + generateCuidLikeId(randomLength)
}

// RandomBigInt generates a random big.Int in range [0, max)
func RandomBigInt(max *big.Int) (*big.Int, error) {
	// Try crypto/rand first
	n, err := crypto_rand.Int(crypto_rand.Reader, max)
	if err == nil {
		return n, nil
	}
	
	// Fallback to math/rand if crypto/rand fails
	// Convert max to int64 and use rand.Int63n
	rand.Seed(time.Now().UnixNano())
	if !max.IsUint64() {
		// If max doesn't fit in uint64, return error
		return nil, err
	}
	maxUint64 := max.Uint64()
	if maxUint64 > 0 {
		randomVal := rand.Int63n(int64(maxUint64))
		return new(big.Int).SetInt64(randomVal), nil
	}
	
	return new(big.Int), err
}
