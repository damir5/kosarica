/**
 * Normalization Utilities
 *
 * Utilities for normalizing Croatian retail data formats.
 * Handles decimal formats, quantities, pack notations, and barcodes.
 */

// ============================================================================
// Decimal Normalization
// ============================================================================

/**
 * Normalizes a Croatian-style decimal string to a number.
 * Handles formats like:
 * - "3,69" → 3.69
 * - ",69" → 0.69
 * - "1.234,56" → 1234.56 (thousand separator)
 * - "3.69" → 3.69 (already normalized)
 *
 * @param value - The string value to normalize
 * @returns The parsed number, or null if invalid
 */
export function normalizeDecimal(value: string | null | undefined): number | null {
  if (value == null || value === '') return null

  let normalized = value.trim()

  // Handle leading comma: ",69" → "0.69"
  if (normalized.startsWith(',')) {
    normalized = '0' + normalized
  }

  // Check if this looks like Croatian format (comma as decimal separator)
  // Pattern: optional digits, optional thousand separators (.), comma, decimal digits
  const croatianPattern = /^-?[\d.]*,\d+$/

  if (croatianPattern.test(normalized)) {
    // Croatian format: remove thousand separators (.), replace comma with dot
    normalized = normalized.replace(/\./g, '').replace(',', '.')
  }

  const result = parseFloat(normalized)
  return isNaN(result) ? null : result
}

/**
 * Converts a decimal price to cents/lipa (integer).
 *
 * @param value - The price string to convert
 * @returns Price in cents/lipa, or null if invalid
 */
export function priceToCents(value: string | null | undefined): number | null {
  const decimal = normalizeDecimal(value)
  if (decimal === null) return null
  return Math.round(decimal * 100)
}

// ============================================================================
// Quantity Parsing
// ============================================================================

/**
 * Parsed quantity with value and unit.
 */
export interface ParsedQuantity {
  value: number
  unit: string
}

/**
 * Common unit aliases to normalize.
 */
const UNIT_ALIASES: Record<string, string> = {
  g: 'G',
  gr: 'G',
  gram: 'G',
  grama: 'G',
  kg: 'KG',
  kilogram: 'KG',
  kilograma: 'KG',
  ml: 'ML',
  l: 'L',
  lit: 'L',
  litra: 'L',
  litre: 'L',
  liter: 'L',
  kom: 'KOM',
  komad: 'KOM',
  komada: 'KOM',
  pcs: 'KOM',
  pc: 'KOM',
  piece: 'KOM',
  pieces: 'KOM',
  pak: 'PAK',
  pack: 'PAK',
  m: 'M',
  cm: 'CM',
  mm: 'MM',
}

/**
 * Normalizes a unit string to standard format.
 *
 * @param unit - The unit to normalize
 * @returns Normalized unit string
 */
export function normalizeUnit(unit: string): string {
  const lower = unit.toLowerCase().trim()
  return UNIT_ALIASES[lower] ?? unit.toUpperCase().trim()
}

/**
 * Parses a quantity string into value and unit.
 * Handles formats like:
 * - "315 G" → {value: 315, unit: 'G'}
 * - "1.5 kg" → {value: 1.5, unit: 'KG'}
 * - "500ml" → {value: 500, unit: 'ML'}
 * - "0,5 L" → {value: 0.5, unit: 'L'}
 *
 * @param value - The quantity string to parse
 * @returns Parsed quantity or null if invalid
 */
export function parseQuantity(value: string | null | undefined): ParsedQuantity | null {
  if (value == null || value === '') return null

  const normalized = value.trim()

  // Pattern: number (with possible comma decimal) followed by optional space and unit
  // Supports: "315 G", "1,5 kg", "500ml", "0.5L"
  const pattern = /^(-?[\d.,]+)\s*([a-zA-Z]+)$/

  const match = normalized.match(pattern)
  if (!match) return null

  const numericValue = normalizeDecimal(match[1])
  if (numericValue === null) return null

  return {
    value: numericValue,
    unit: normalizeUnit(match[2]),
  }
}

// ============================================================================
// Pack Notation Parsing
// ============================================================================

/**
 * Parsed pack notation.
 */
export interface ParsedPack {
  packCount: number
  packUnitValue: number
  packUnitUnit: string
}

/**
 * Parses pack notation strings.
 * Handles formats like:
 * - "6x500ml" → {packCount: 6, packUnitValue: 500, packUnitUnit: 'ML'}
 * - "4 x 1,5L" → {packCount: 4, packUnitValue: 1.5, packUnitUnit: 'L'}
 * - "12x0.33l" → {packCount: 12, packUnitValue: 0.33, packUnitUnit: 'L'}
 *
 * @param value - The pack notation string to parse
 * @returns Parsed pack or null if invalid
 */
export function parsePackNotation(value: string | null | undefined): ParsedPack | null {
  if (value == null || value === '') return null

  const normalized = value.trim()

  // Pattern: count "x" or "X" value unit
  // Supports: "6x500ml", "4 x 1,5L", "12 X 0.33 l"
  const pattern = /^(\d+)\s*[xX]\s*([\d.,]+)\s*([a-zA-Z]+)$/

  const match = normalized.match(pattern)
  if (!match) return null

  const packCount = parseInt(match[1], 10)
  const packUnitValue = normalizeDecimal(match[2])

  if (isNaN(packCount) || packCount <= 0 || packUnitValue === null) {
    return null
  }

  return {
    packCount,
    packUnitValue,
    packUnitUnit: normalizeUnit(match[3]),
  }
}

// ============================================================================
// Barcode Cleanup
// ============================================================================

/**
 * Cleans up a barcode string.
 * Handles:
 * - Removes spaces
 * - Removes quotes (single and double)
 * - Removes Excel quoting (="123456")
 * - Trims whitespace
 *
 * @param value - The barcode to clean
 * @returns Cleaned barcode or null if empty/invalid
 */
export function cleanBarcode(value: string | null | undefined): string | null {
  if (value == null || value === '') return null

  let cleaned = value.trim()

  // Remove Excel formula quoting: ="1234567890123"
  if (cleaned.startsWith('="') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(2, -1)
  }

  // Remove surrounding quotes
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1)
  }

  // Remove all spaces
  cleaned = cleaned.replace(/\s/g, '')

  // Remove any remaining quotes
  cleaned = cleaned.replace(/["']/g, '')

  // Validate: barcodes should only contain digits (and possibly leading zeros)
  if (!/^\d+$/.test(cleaned)) {
    return null
  }

  return cleaned.length > 0 ? cleaned : null
}

/**
 * Parses a barcode field that may contain multiple barcodes.
 * Handles:
 * - Comma-separated: "1234567890123,9876543210987"
 * - Semicolon-separated: "1234567890123;9876543210987"
 * - Pipe-separated: "1234567890123|9876543210987"
 *
 * @param value - The barcode field to parse
 * @returns Array of cleaned barcodes (empty if none valid)
 */
export function parseBarcodes(value: string | null | undefined): string[] {
  if (value == null || value === '') return []

  // Split by common separators
  const parts = value.split(/[,;|]/)

  const barcodes: string[] = []
  for (const part of parts) {
    const cleaned = cleanBarcode(part)
    if (cleaned !== null) {
      barcodes.push(cleaned)
    }
  }

  return barcodes
}

// ============================================================================
// String Cleanup Utilities
// ============================================================================

/**
 * Cleans and normalizes a string value.
 * - Trims whitespace
 * - Collapses multiple spaces
 * - Returns null for empty strings
 *
 * @param value - The string to clean
 * @returns Cleaned string or null if empty
 */
export function cleanString(value: string | null | undefined): string | null {
  if (value == null || value === '') return null

  const cleaned = value.trim().replace(/\s+/g, ' ')
  return cleaned.length > 0 ? cleaned : null
}

/**
 * Cleans and normalizes a name string.
 * Same as cleanString but also normalizes case (title case).
 *
 * @param value - The name to clean
 * @returns Cleaned name or null if empty
 */
export function cleanName(value: string | null | undefined): string | null {
  const cleaned = cleanString(value)
  if (cleaned === null) return null

  // Don't change case - preserve original retailer formatting
  return cleaned
}
