package chains

// ValidChains returns the list of supported chain slugs
func ValidChains() []string {
	return []string{
		"konzum",
		"lidl",
		"plodine",
		"interspar",
		"studenac",
		"kaufland",
		"eurospin",
		"dm",
		"ktc",
		"metro",
		"trgocentar",
	}
}

// IsValidChain checks if a chain slug is valid
func IsValidChain(chainID string) bool {
	validChains := make(map[string]bool, len(ValidChains()))
	for _, c := range ValidChains() {
		validChains[c] = true
	}
	return validChains[chainID]
}
