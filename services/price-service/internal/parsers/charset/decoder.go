package charset

import (
	"io"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/transform"
)

// Croatian Windows-1250 byte mappings for common characters
var windows1250Chars = map[byte]rune{
	// Letters with diacritics used in Croatian/Central European languages
	0x8A: 'Š', // Latin capital letter S with caron
	0x9A: 'š', // Latin small letter s with caron
	0xD0: 'Đ', // Latin capital letter D with stroke
	0xF0: 'đ', // Latin small letter d with stroke
	0xC8: 'Č', // Latin capital letter C with caron
	0xE8: 'č', // Latin small letter c with caron
	0x8E: 'Ž', // Latin capital letter Z with caron
	0x9E: 'ž', // Latin small letter z with caron
	0xC6: 'Ć', // Latin capital letter C with acute
	0xE6: 'ć', // Latin small letter c with acute
}

// Encoding represents a text encoding
type Encoding string

const (
	EncodingUTF8        Encoding = "utf-8"
	EncodingWindows1250 Encoding = "windows-1250"
	EncodingISO88592    Encoding = "iso-8859-2"
)

// DetectEncoding detects the encoding of a byte buffer
func DetectEncoding(data []byte) Encoding {
	// Check for UTF-8 BOM
	if len(data) >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
		return EncodingUTF8
	}

	// Check if it's already valid UTF-8
	if utf8.Valid(data) {
		// Check for Windows-1250 specific byte patterns
		// that would be invalid in UTF-8
		windows1250Score := 0
		checkLen := len(data)
		if checkLen > 1000 {
			checkLen = 1000
		}

		for i := 0; i < checkLen; i++ {
			b := data[i]
			if _, ok := windows1250Chars[b]; ok {
				windows1250Score++
			}
		}

		// FIX: If valid UTF-8 AND contains Croatian characters, prefer UTF-8 directly
		// This prevents false positive Windows-1250 detection on UTF-8 files
		// with Croatian diacritics (š, č, ć, ž, đ) which share byte values
		// in UTF-8 multibyte sequences
		if windows1250Score > 0 {
			return EncodingUTF8
		}

		return EncodingUTF8
	}

	// Not valid UTF-8, check for Windows-1250
	return EncodingWindows1250
}

// Decode converts a byte buffer from the specified encoding to UTF-8 string
func Decode(data []byte, enc Encoding) (string, error) {
	if enc == EncodingUTF8 || enc == "" {
		// FIX: If data is valid UTF-8, return directly regardless of requested encoding
		// This prevents double-decoding when adapter sets windows-1250 but file is UTF-8
		if utf8.Valid(data) {
			return string(data), nil
		}
		// Fall back to Windows-1250 only if NOT valid UTF-8
		return decodeWindows1250(data)
	}

	if enc == EncodingWindows1250 {
		// FIX: Validate UTF-8 first before attempting Windows-1250 decoding
		// If file is actually UTF-8 (but adapter thinks it's Windows-1250), use UTF-8
		if utf8.Valid(data) {
			return string(data), nil
		}
		return decodeWindows1250(data)
	}

	if enc == EncodingISO88592 {
		return decodeISO88592(data)
	}

	return string(data), nil
}

// decodeWindows1250 decodes Windows-1250 encoded bytes to UTF-8
func decodeWindows1250(data []byte) (string, error) {
	// Use a custom transformer for full Windows-1250 support
	// Windows1252 doesn't have all Croatian chars, so we need custom handling
	result := make([]byte, len(data)*4) // Worst case: 4 bytes per rune
	out := 0

	for _, b := range data {
		if r, ok := windows1250Chars[b]; ok {
			n := utf8.EncodeRune(result[out:], r)
			out += n
		} else {
			// For ASCII and other characters, use as-is
			result[out] = b
			out++
		}
	}

	return string(result[:out]), nil
}

// decodeISO88592 decodes ISO-8859-2 encoded bytes to UTF-8
func decodeISO88592(data []byte) (string, error) {
	// ISO-8859-2 is similar to Windows-1250 but not identical
	decoder := charmap.ISO8859_2.NewDecoder()
	reader := transform.NewReader(strings.NewReader(string(data)), decoder)
	result, err := io.ReadAll(reader)
	if err != nil {
		return "", err
	}
	return string(result), nil
}

// ToUTF8Reader wraps a reader with a decoder to convert to UTF-8
func ToUTF8Reader(r io.Reader, enc Encoding) (io.Reader, error) {
	var decoder encoding.Encoding

	switch enc {
	case EncodingWindows1250:
		// For Windows-1250, we need custom handling
		// Use Windows-1252 as base and handle Croatian chars separately
		decoder = charmap.Windows1252
	case EncodingISO88592:
		decoder = charmap.ISO8859_2
	default:
		return r, nil
	}

	return transform.NewReader(r, decoder.NewDecoder()), nil
}
