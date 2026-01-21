package pricegroups

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

const (
	// HashVersion is the current version of the hash algorithm
	HashVersion = 1

	// nullDiscountSentinel is the string used to represent NULL discount prices
	// This is CRITICAL: NULL discount must produce different hash than 0 discount!
	nullDiscountSentinel = "N"
)

// ItemPrice represents a single item's price for hashing
type ItemPrice struct {
	ItemID        string  // UUID (will be normalized to lowercase for hashing)
	Price         int     // cents, NOT NULL
	DiscountPrice *int    // cents, nullable (NULL ≠ 0!)
}

// ComputePriceHash computes a deterministic hash of a set of item prices
// The hash is based on sorted item IDs and their prices, ensuring that:
// - Same prices = same hash (determinism)
// - Different order = same hash (order independence)
// - NULL discount ≠ 0 discount (distinct hashes)
// - Any price difference = different hash (sensitivity)
// - UUIDs are normalized to lowercase for consistency
// - Duplicates with different prices are consistently ordered
func ComputePriceHash(prices []ItemPrice) string {
	// Step 1: Sort by ItemID (lexicographic for UUIDs)
	// IMPORTANT: Sort must be stable or handle duplicates deterministically.
	// Since we can have duplicate ItemIDs (though unlikely in valid data, possible in input),
	// we must include price and discount in sort key to ensure full determinism.
	sortedPrices := make([]ItemPrice, len(prices))
	copy(sortedPrices, prices)
	
	sort.Slice(sortedPrices, func(i, j int) bool {
		// Primary sort key: ItemID (case-insensitive/normalized)
		idI := strings.ToLower(sortedPrices[i].ItemID)
		idJ := strings.ToLower(sortedPrices[j].ItemID)
		if idI != idJ {
			return idI < idJ
		}
		
		// Secondary sort key: Price
		if sortedPrices[i].Price != sortedPrices[j].Price {
			return sortedPrices[i].Price < sortedPrices[j].Price
		}
		
		// Tertiary sort key: DiscountPrice
		// Handle nil comparisons
		discI := sortedPrices[i].DiscountPrice
		discJ := sortedPrices[j].DiscountPrice
		
		if discI == nil && discJ == nil {
			return false // equal
		}
		if discI == nil {
			return true // nil comes first
		}
		if discJ == nil {
			return false // non-nil comes after
		}
		return *discI < *discJ
	})

	// Step 2: Build canonical string: "item_id:price:discount\n"
	// CRITICAL: Use "N" for NULL discount, integer for actual value
	// CRITICAL: Normalize UUIDs to lowercase for consistency
	var buf bytes.Buffer
	for _, p := range sortedPrices {
		var discountStr string
		if p.DiscountPrice == nil {
			discountStr = nullDiscountSentinel // NULL sentinel
		} else {
			discountStr = strconv.Itoa(*p.DiscountPrice)
		}
		// Normalize ItemID to lowercase for consistent hashing
		fmt.Fprintf(&buf, "%s:%d:%s\n", strings.ToLower(p.ItemID), p.Price, discountStr)
	}

	// Step 3: SHA256, hex-encoded (lowercase)
	hash := sha256.Sum256(buf.Bytes())
	return hex.EncodeToString(hash[:])
}

// ComputeItemHashString is a convenience function that converts individual item data to ItemPrice
// and computes the hash
func ComputeItemHashString(itemID string, price int, discountPrice *int) string {
	prices := []ItemPrice{
		{
			ItemID:        itemID,
			Price:         price,
			DiscountPrice: discountPrice,
		},
	}
	return ComputePriceHash(prices)
}

// HashVersion returns the current hash version
func GetHashVersion() int {
	return HashVersion
}
