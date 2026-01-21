package matching

import (
	"testing"
)

func TestNormalizeBarcode(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"Valid EAN-13", "3850012345678", "3850012345678"},
		{"UPC-A to EAN-13", "123456789012", "0123456789012"},
		{"Strip hyphens", "385-001-234-5678", "3850012345678"},
		{"Strip spaces", "385 001 234 5678", "3850012345678"},
		{"All zeros placeholder", "0000000000000", ""},
		{"Variable weight code", "2123456789012", ""},
		{"Invalid check digit", "3850012345679", ""},
		{"Short code (internal)", "12345", "12345"},
		{"Empty string", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := NormalizeBarcode(tt.input)
			if result != tt.expected {
				t.Errorf("NormalizeBarcode(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestValidateEAN13CheckDigit(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"3850012345678", true},  // Valid
		{"3850012345679", false}, // Invalid check digit
		{"1234567890128", true},  // Valid
		{"123", false},           // Too short
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := validateEAN13CheckDigit(tt.input)
			if result != tt.expected {
				t.Errorf("validateEAN13CheckDigit(%q) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestRemoveDiacritics(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Čokolada", "Cokolada"},
		{"Špagete", "Spagete"},
		{"Žličnjak", "Zlicnjak"},
		{"Đumbir", "Djumbir"},
		{"Ćevapi", "Cevapi"},
		{"Mixed ČŠŽĐĆ", "Mixed CSZDjC"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := RemoveDiacritics(tt.input)
			if result != tt.expected {
				t.Errorf("RemoveDiacritics(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestNormalizeUnit(t *testing.T) {
	tests := []struct {
		name     string
		unit     string
		quantity string
		expected string
	}{
		{"Liters", "l", "1", "1l"},
		{"Milliliters", "ml", "500", "500ml"},
		{"1000ml to liters", "ml", "1000", "1l"},
		{"Kilograms", "kg", "1", "1kg"},
		{"Grams", "g", "500", "500g"},
		{"1000g to kg", "g", "1000", "1kg"},
		{"Pieces", "kom", "10", "10kom"},
		{"Pcs to kom", "pcs", "5", "5kom"},
		{"Empty quantity", "kg", "", "kg"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := NormalizeUnit(tt.unit, tt.quantity)
			if result != tt.expected {
				t.Errorf("NormalizeUnit(%q, %q) = %q, want %q", tt.unit, tt.quantity, result, tt.expected)
			}
		})
	}
}

func TestNormalizeForEmbedding(t *testing.T) {
	tests := []struct {
		name     string
		input    struct{ name, brand, category, unit string }
		expected string
	}{
		{
			"Full product",
			struct{ name, brand, category, unit string }{"Čokolada", "Kras", "Slastice", "100g"},
			"cokolada kras slastice 100g",
		},
		{
			"Generic brand",
			struct{ name, brand, category, unit string }{"Mlijeko", "n/a", "Mliječni", "1l"},
			"mlijeko mlijecni 1l",
		},
		{
			"No brand",
			struct{ name, brand, category, unit string }{"Kruh", "", "Pekarski", "500g"},
			"kruh pekarski 500g",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := NormalizeForEmbedding(tt.input.name, tt.input.brand, tt.input.category, tt.input.unit)
			if result != tt.expected {
				t.Errorf("NormalizeForEmbedding() = %q, want %q", result, tt.expected)
			}
		})
	}
}

func TestIsGenericBrand(t *testing.T) {
	tests := []struct {
		brand    string
		expected bool
	}{
		{"n/a", true},
		{"nepoznato", true},
		{"unknown", true},
		{"-", true},
		{"", true},
		{"Kras", false},
		{"Podravka", false},
	}

	for _, tt := range tests {
		t.Run(tt.brand, func(t *testing.T) {
			result := isGenericBrand(tt.brand)
			if result != tt.expected {
				t.Errorf("isGenericBrand(%q) = %v, want %v", tt.brand, result, tt.expected)
			}
		})
	}
}
