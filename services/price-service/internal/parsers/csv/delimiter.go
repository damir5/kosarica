package csv

import (
	"strings"
	"unicode"
)

// DetectDelimiter detects the CSV delimiter by analyzing the first few lines
func DetectDelimiter(content string) CsvDelimiter {
	lines := strings.Split(content, "\n")
	if len(lines) == 0 {
		return DelimiterComma
	}

	// Take first 5 non-empty lines
	sampleLines := make([]string, 0, 5)
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			sampleLines = append(sampleLines, trimmed)
			if len(sampleLines) >= 5 {
				break
			}
		}
	}

	if len(sampleLines) == 0 {
		return DelimiterComma
	}

	delimiters := []CsvDelimiter{DelimiterComma, DelimiterSemicolon, DelimiterTab}
	bestDelimiter := DelimiterComma
	maxConsistency := 0.0

	for _, delim := range delimiters {
		delimStr := string(delim)
		counts := make([]int, 0, len(sampleLines))

		for _, line := range sampleLines {
			count := strings.Count(line, delimStr)
			counts = append(counts, count)
		}

		// Check consistency - all lines should have similar counts
		sum := 0
		for _, c := range counts {
			sum += c
		}
		avgCount := float64(sum) / float64(len(counts))

		if avgCount == 0 {
			continue
		}

		variance := 0.0
		for _, c := range counts {
			diff := float64(c) - avgCount
			variance += diff * diff
		}
		variance /= float64(len(counts))

		consistency := avgCount / (1.0 + variance)
		if consistency > maxConsistency {
			maxConsistency = consistency
			bestDelimiter = delim
		}
	}

	return bestDelimiter
}

// DetectDelimiterFromBytes detects delimiter from raw bytes
func DetectDelimiterFromBytes(data []byte) CsvDelimiter {
	// Convert first portion to string for analysis
	sampleSize := len(data)
	if sampleSize > 2000 {
		sampleSize = 2000
	}
	content := string(data[:sampleSize])
	return DetectDelimiter(content)
}

// SplitCSVLine splits a CSV line handling quoted fields
func SplitCSVLine(line string, delimiter rune, quoteChar rune) []string {
	fields := make([]string, 0, 10)
	var current strings.Builder
	inQuotes := false

	for i := 0; i < len(line); i++ {
		r, width := utf8.DecodeRuneInString(line[i:])
		i += width - 1

		if inQuotes {
			if r == quoteChar {
				// Check for escaped quote (double quote)
				if i+1 < len(line) {
					nextR, _ := utf8.DecodeRuneInString(line[i+1:])
					if nextR == quoteChar {
						current.WriteRune(quoteChar)
						i++
						continue
					}
				}
				// End of quoted field
				inQuotes = false
				continue
			}
			current.WriteRune(r)
			continue
		}

		if r == quoteChar {
			inQuotes = true
			continue
		}

		if r == delimiter {
			fields = append(fields, current.String())
			current.Reset()
			continue
		}

		current.WriteRune(r)
	}

	// Add last field
	fields = append(fields, current.String())

	return fields
}

// utf8.DecodeRuneInString is a helper for UTF-8 decoding from string
import "unicode/utf8"
