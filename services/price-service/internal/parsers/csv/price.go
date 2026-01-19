package csv

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode"
)

// ParsePrice parses a price string to cents (integer)
// Handles various formats: "12.99", "12,99", "1.299,00", "1 299,00 kn"
func ParsePrice(value string) (int, error) {
	if value == "" {
		return 0, fmt.Errorf("empty price value")
	}

	// Remove currency symbols and whitespace
	cleaned := strings.TrimSpace(value)
	cleaned = strings.Map(func(r rune) rune {
		// Remove currency symbols and thousands separators (space)
		if r == '€' || r == '$' || r == '£' || r == '₹' ||
		   r == '¥' || r == '¢' || r == '\u00A0' { // non-breaking space
			return -1
		}
		// Keep other characters
		return r
	}, cleaned)

	// Remove common currency text (kn, KUNA, etc.)
	cleaned = strings.ToUpper(cleaned)
	cleaned = regexp.MustCompile(`\s*(KN|KUNA|HRK|EUR|USD)\s*$`).ReplaceAllString(cleaned, "")

	cleaned = strings.TrimSpace(cleaned)
	if cleaned == "" {
		return 0, fmt.Errorf("no numeric value found")
	}

	// Determine decimal separator
	// If there's a comma after a dot, comma is decimal separator (European)
	// If there's a dot after a comma, dot is decimal separator (US)
	lastDot := strings.LastIndex(cleaned, ".")
	lastComma := strings.LastIndex(cleaned, ",")

	var result float64

	if lastComma > lastDot {
		// European format: 1.234,56 -> comma is decimal
		// Remove dots (thousands separators)
		cleaned = strings.ReplaceAll(cleaned, ".", "")
		cleaned = strings.ReplaceAll(cleaned, ",", ".")
	} else if lastDot > lastComma {
		// US format: 1,234.56 -> just remove commas
		cleaned = strings.ReplaceAll(cleaned, ",", "")
	}
	// else: no separators found, use as-is

	// Parse the float
	result, err := parseFloat(cleaned)
	if err != nil {
		return 0, fmt.Errorf("invalid price format: %w", err)
	}

	// Convert to cents
	cents := math.Round(result * 100)
	return int(cents), nil
}

// parseFloat safely parses a float with better error handling
func parseFloat(s string) (float64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("empty string")
	}

	// Check for valid numeric format
	hasDigit := false
	for _, r := range s {
		if unicode.IsDigit(r) {
			hasDigit = true
			break
		}
	}
	if !hasDigit {
		return 0, fmt.Errorf("no digits found")
	}

	var result float64
	_, err := fmt.Sscanf(s, "%f", &result)
	if err != nil {
		return 0, err
	}

	return result, nil
}

// FormatCents formats cents as a decimal string (e.g., 1299 -> "12.99")
func FormatCents(cents int) string {
	euros := float64(cents) / 100.0
	return fmt.Sprintf("%.2f", euros)
}

// FormatCentsEuropean formats cents as a European decimal string (e.g., 1299 -> "12,99")
func FormatCentsEuropean(cents int) string {
	euros := float64(cents) / 100.0
	str := fmt.Sprintf("%.2f", euros)
	return strings.ReplaceAll(str, ".", ",")
}
