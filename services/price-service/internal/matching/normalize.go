package matching

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

var (
	nonDigitRe       = regexp.MustCompile(`[^0-9]`)
	placeholderRe    = regexp.MustCompile(`^0+$`)
	variableWeightRe = regexp.MustCompile(`^2[0-9]`) // EAN-13 prefix 20-29
)

// NormalizeBarcode handles UPC-A vs EAN-13, leading zeros, invalid codes
// Returns empty string for invalid/placeholder barcodes that should be skipped
func NormalizeBarcode(barcode string) string {
	// Strip non-digits
	bc := nonDigitRe.ReplaceAllString(barcode, "")
	if bc == "" {
		return ""
	}

	// Skip placeholder barcodes (all zeros)
	if placeholderRe.MatchString(bc) {
		return ""
	}

	// Skip variable-weight item codes (20-29 prefix in EAN-13)
	if len(bc) == 13 && variableWeightRe.MatchString(bc) {
		return ""
	}

	// UPC-A (12 digits) -> EAN-13 (add leading 0)
	if len(bc) == 12 {
		bc = "0" + bc
	}

	// Validate length (must be EAN-13 after normalization)
	if len(bc) != 13 {
		// Could be internal code - return as-is but flagged
		return bc
	}

	// Validate check digit
	if !validateEAN13CheckDigit(bc) {
		return "" // Invalid barcode
	}

	return bc
}

// validateEAN13CheckDigit validates the EAN-13 check digit
func validateEAN13CheckDigit(bc string) bool {
	if len(bc) != 13 {
		return false
	}
	sum := 0
	for i := 0; i < 12; i++ {
		d := int(bc[i] - '0')
		if i%2 == 0 {
			sum += d
		} else {
			sum += d * 3
		}
	}
	checkDigit := (10 - (sum % 10)) % 10
	return int(bc[12]-'0') == checkDigit
}

// RemoveDiacritics handles Croatian characters properly
// Converts č, ć, đ, š, ž to c, c, d, s, z
func RemoveDiacritics(s string) string {
	// Croatian-specific mappings
	replacer := strings.NewReplacer(
		"č", "c", "Č", "C",
		"ć", "c", "Ć", "C",
		"đ", "dj", "Đ", "Dj",
		"š", "s", "Š", "S",
		"ž", "z", "Ž", "Z",
	)
	s = replacer.Replace(s)

	// General NFD normalization + strip combining marks
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	result, _, _ := transform.String(t, s)
	return result
}

// NormalizeUnit converts units to canonical form for comparison
// Returns normalized unit string (e.g., "1kg", "500ml", "10kom")
func NormalizeUnit(unit, quantity string) string {
	u := strings.ToLower(strings.TrimSpace(unit))
	q := strings.TrimSpace(quantity)

	// Common unit conversions
	conversions := map[string]string{
		"l":    "l",
		"ltr":  "l",
		"lit":  "l",
		"ml":   "ml",
		"kg":   "kg",
		"g":    "g",
		"gr":   "g",
		"kom":  "kom",
		"pcs":  "kom",
		"pack": "kom",
	}

	if canonical, ok := conversions[u]; ok {
		u = canonical
	}

	// Try to convert to base units for comparison
	// 1000ml -> 1l, 1000g -> 1kg
	if u == "ml" && q != "" {
		if val, err := strconv.ParseFloat(q, 64); err == nil && val >= 1000 {
			return strconv.FormatFloat(val/1000, 'f', -1, 64) + "l"
		}
	}
	if u == "g" && q != "" {
		if val, err := strconv.ParseFloat(q, 64); err == nil && val >= 1000 {
			return strconv.FormatFloat(val/1000, 'f', -1, 64) + "kg"
		}
	}

	// Return quantity + unit for comparison
	if q != "" {
		return q + u
	}
	return u
}

// NormalizeForEmbedding normalizes text for AI embedding generation
// Includes diacritic removal, lowercasing, and extra whitespace cleanup
func NormalizeForEmbedding(name, brand, category, unit string) string {
	parts := []string{}

	if name != "" {
		parts = append(parts, RemoveDiacritics(name))
	}
	if brand != "" && !isGenericBrand(brand) {
		parts = append(parts, RemoveDiacritics(brand))
	}
	if category != "" {
		parts = append(parts, RemoveDiacritics(category))
	}
	if unit != "" {
		parts = append(parts, unit)
	}

	text := strings.Join(parts, " ")
	text = strings.ToLower(text)
	text = strings.Join(strings.Fields(text), " ") // Normalize whitespace
	return text
}

// isGenericBrand checks if a brand is generic/unbranded
func isGenericBrand(brand string) bool {
	generic := []string{"n/a", "nepoznato", "unknown", "-", "", "private label", "own brand"}
	b := strings.ToLower(strings.TrimSpace(brand))
	for _, g := range generic {
		if b == g {
			return true
		}
	}
	return false
}
