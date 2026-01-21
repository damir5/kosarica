package pricegroups

import (
	"fmt"
	"sync"
	"testing"
)

// HASH-1: Same prices, 1000 iterations = same hash (determinism)
func TestHashDeterminism(t *testing.T) {
	prices := []ItemPrice{
		{ItemID: "abc123-def4-5678-90ab-cdef12345678", Price: 1000, DiscountPrice: intPtr(500)},
		{ItemID: "def456-abc1-2345-67ab-cdef12345678", Price: 2000, DiscountPrice: nil},
		{ItemID: "789012-abcd-ef12-3456-7890abcdef12", Price: 1500, DiscountPrice: intPtr(750)},
	}

	firstHash := ComputePriceHash(prices)

	// Run 1000 times to ensure consistency
	for i := 0; i < 1000; i++ {
		hash := ComputePriceHash(prices)
		if hash != firstHash {
			t.Errorf("Iteration %d: hash mismatch (got %s, want %s)", i, hash, firstHash)
		}
	}
}

// HASH-2: Different order = same hash (order independence)
func TestHashOrderIndependence(t *testing.T) {
	item1 := ItemPrice{ItemID: "aaa111-bbbb-cccc-dddd-eeeeee111111", Price: 1000, DiscountPrice: intPtr(500)}
	item2 := ItemPrice{ItemID: "bbb222-cccc-dddd-eeee-ffffee222222", Price: 2000, DiscountPrice: nil}
	item3 := ItemPrice{ItemID: "ccc333-dddd-eeee-ffff-gggggg333333", Price: 1500, DiscountPrice: intPtr(750)}

	// Different orderings
	order1 := []ItemPrice{item1, item2, item3}
	order2 := []ItemPrice{item3, item1, item2}
	order3 := []ItemPrice{item2, item3, item1}

	hash1 := ComputePriceHash(order1)
	hash2 := ComputePriceHash(order2)
	hash3 := ComputePriceHash(order3)

	if hash1 != hash2 {
		t.Errorf("Order 1 and 2 produce different hashes: %s vs %s", hash1, hash2)
	}
	if hash1 != hash3 {
		t.Errorf("Order 1 and 3 produce different hashes: %s vs %s", hash1, hash3)
	}
	if hash2 != hash3 {
		t.Errorf("Order 2 and 3 produce different hashes: %s vs %s", hash2, hash3)
	}
}

// HASH-3: NULL discount ≠ 0 discount (distinct hashes!)
func TestHashNullVsZeroDiscount(t *testing.T) {
	itemID := "abc123-def4-5678-90ab-cdef12345678"
	basePrice := 1000

	// NULL discount
	pricesWithNull := []ItemPrice{
		{ItemID: itemID, Price: basePrice, DiscountPrice: nil},
	}

	// 0 discount (explicit zero)
	zeroPrice := 0
	pricesWithZero := []ItemPrice{
		{ItemID: itemID, Price: basePrice, DiscountPrice: &zeroPrice},
	}

	hashNull := ComputePriceHash(pricesWithNull)
	hashZero := ComputePriceHash(pricesWithZero)

	if hashNull == hashZero {
		t.Errorf("NULL and 0 discount produce same hash (%s), should be different!", hashNull)
	}
}

// HASH-4: Any price difference = different hash (sensitivity)
func TestHashSensitivity(t *testing.T) {
	itemID := "abc123-def4-5678-90ab-cdef12345678"

	testCases := []struct {
		name     string
		prices1  []ItemPrice
		prices2  []ItemPrice
		sameHash bool
	}{
		{
			name: "Different regular price",
			prices1: []ItemPrice{
				{ItemID: itemID, Price: 1000, DiscountPrice: intPtr(500)},
			},
			prices2: []ItemPrice{
				{ItemID: itemID, Price: 1001, DiscountPrice: intPtr(500)},
			},
			sameHash: false,
		},
		{
			name: "Different discount price",
			prices1: []ItemPrice{
				{ItemID: itemID, Price: 1000, DiscountPrice: intPtr(500)},
			},
			prices2: []ItemPrice{
				{ItemID: itemID, Price: 1000, DiscountPrice: intPtr(501)},
			},
			sameHash: false,
		},
		{
			name: "NULL vs non-NULL discount",
			prices1: []ItemPrice{
				{ItemID: itemID, Price: 1000, DiscountPrice: nil},
			},
			prices2: []ItemPrice{
				{ItemID: itemID, Price: 1000, DiscountPrice: intPtr(500)},
			},
			sameHash: false,
		},
		{
			name: "Different item ID",
			prices1: []ItemPrice{
				{ItemID: "abc123-def4-5678-90ab-cdef12345678", Price: 1000, DiscountPrice: nil},
			},
			prices2: []ItemPrice{
				{ItemID: "abc123-def4-5678-90ab-cdef12345679", Price: 1000, DiscountPrice: nil},
			},
			sameHash: false,
		},
		{
			name: "Same prices (should have same hash)",
			prices1: []ItemPrice{
				{ItemID: itemID, Price: 1000, DiscountPrice: intPtr(500)},
			},
			prices2: []ItemPrice{
				{ItemID: itemID, Price: 1000, DiscountPrice: intPtr(500)},
			},
			sameHash: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			hash1 := ComputePriceHash(tc.prices1)
			hash2 := ComputePriceHash(tc.prices2)

			if tc.sameHash && hash1 != hash2 {
				t.Errorf("Expected same hash, got different: %s vs %s", hash1, hash2)
			}
			if !tc.sameHash && hash1 == hash2 {
				t.Errorf("Expected different hashes, got same: %s", hash1)
			}
		})
	}
}

// HASH-5: Consistent across goroutines (thread safety)
func TestHashThreadSafety(t *testing.T) {
	prices := make([]ItemPrice, 100)
	for i := 0; i < 100; i++ {
		prices[i] = ItemPrice{
			ItemID:        fmt.Sprintf("item-%03d-aaaa-bbbb-cccc-dddd%012d", i, i),
			Price:         (i + 1) * 100,
			DiscountPrice: intPtr(i * 10),
		}
	}

	expectedHash := ComputePriceHash(prices)

	// Run in multiple goroutines
	const numGoroutines = 100
	const iterationsPerGoroutine = 100

	var wg sync.WaitGroup
	hashes := make([]string, numGoroutines*iterationsPerGoroutine)
	mu := sync.Mutex{}

	for g := 0; g < numGoroutines; g++ {
		wg.Add(1)
		go func(goroutineID int) {
			defer wg.Done()
			for i := 0; i < iterationsPerGoroutine; i++ {
				hash := ComputePriceHash(prices)
				mu.Lock()
				hashes[goroutineID*iterationsPerGoroutine+i] = hash
				mu.Unlock()
			}
		}(g)
	}

	wg.Wait()

	// Verify all hashes match
	for i, hash := range hashes {
		if hash != expectedHash {
			t.Errorf("Hash %d mismatch: got %s, want %s", i, hash, expectedHash)
		}
	}
}

// HASH-6: UUID formatting consistency (lowercase, hyphens)
func TestHashUUIDFormatting(t *testing.T) {
	itemID := "ABC123-DEF4-5678-90AB-CDEF12345678" // Uppercase

	// Should be normalized to lowercase
	prices := []ItemPrice{
		{ItemID: itemID, Price: 1000, DiscountPrice: nil},
	}

	hash1 := ComputePriceHash(prices)

	// Same UUID in lowercase should produce same hash
	lowercaseID := "abc123-def4-5678-90ab-cdef12345678"
	prices2 := []ItemPrice{
		{ItemID: lowercaseID, Price: 1000, DiscountPrice: nil},
	}

	hash2 := ComputePriceHash(prices2)

	if hash1 != hash2 {
		t.Errorf("UUID case normalization failed: %s vs %s", hash1, hash2)
	}

	// Different formatting (without hyphens) should produce different hash
	noHyphensID := "abc123def4567890abcdef12345678"
	prices3 := []ItemPrice{
		{ItemID: noHyphensID, Price: 1000, DiscountPrice: nil},
	}

	hash3 := ComputePriceHash(prices3)

	if hash1 == hash3 {
		t.Errorf("UUID without hyphens should produce different hash (got %s)", hash3)
	}
}

// Test empty prices list
func TestHashEmptyPrices(t *testing.T) {
	prices := []ItemPrice{}
	hash := ComputePriceHash(prices)

	// Should produce a valid hash (SHA256 of empty input)
	if len(hash) != 64 { // SHA-256 hex is 64 characters
		t.Errorf("Expected 64 character hash, got %d", len(hash))
	}

	// Should be deterministic
	hash2 := ComputePriceHash(prices)
	if hash != hash2 {
		t.Errorf("Empty hash not deterministic: %s vs %s", hash, hash2)
	}
}

// Test single item
func TestHashSingleItem(t *testing.T) {
	prices := []ItemPrice{
		{ItemID: "abc123-def4-5678-90ab-cdef12345678", Price: 1000, DiscountPrice: nil},
	}

	hash := ComputePriceHash(prices)

	if len(hash) != 64 {
		t.Errorf("Expected 64 character hash, got %d", len(hash))
	}

	// Should be deterministic
	hash2 := ComputePriceHash(prices)
	if hash != hash2 {
		t.Errorf("Single item hash not deterministic: %s vs %s", hash, hash2)
	}
}

// Test negative prices (should still hash correctly)
func TestHashNegativePrices(t *testing.T) {
	prices1 := []ItemPrice{
		{ItemID: "abc123-def4-5678-90ab-cdef12345678", Price: -100, DiscountPrice: nil},
	}

	prices2 := []ItemPrice{
		{ItemID: "abc123-def4-5678-90ab-cdef12345678", Price: 100, DiscountPrice: nil},
	}

	hash1 := ComputePriceHash(prices1)
	hash2 := ComputePriceHash(prices2)

	if hash1 == hash2 {
		t.Errorf("Negative and positive prices should have different hashes")
	}
}

// NEW TEST: Test duplicate items
func TestHashDuplicates(t *testing.T) {
	p1 := ItemPrice{ItemID: "item-1", Price: 100, DiscountPrice: nil}
	p2 := ItemPrice{ItemID: "item-1", Price: 200, DiscountPrice: nil}

	// If sort is stable, these should be deterministic
	listA := []ItemPrice{p1, p2}
	hashA := ComputePriceHash(listA)

	listB := []ItemPrice{p2, p1}
	hashB := ComputePriceHash(listB)

	// Since we sort by ID then Price, order of input should not matter
	// listA sorts to: p1 (100), p2 (200)
	// listB sorts to: p1 (100), p2 (200)
	// So hashes must match

	if hashA != hashB {
		t.Errorf("Order of duplicate items affects hash! \n%s\n%s", hashA, hashB)
	}
}

// Helper function
func intPtr(i int) *int {
	return &i
}
