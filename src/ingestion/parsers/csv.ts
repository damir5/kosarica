/**
 * CSV Parser Module
 *
 * Parser for CSV files with configurable delimiter and encoding.
 * Supports mapping CSV columns to NormalizedRow fields.
 */

import type { FileType, NormalizedRow } from '../core/types'
import { Parser, type ParseContext } from './base'

/**
 * Supported CSV delimiters.
 */
export type CsvDelimiter = ',' | ';' | '\t'

/**
 * Supported encodings for CSV files.
 */
export type CsvEncoding = 'utf-8' | 'windows-1250' | 'iso-8859-2'

/**
 * Column mapping configuration.
 * Maps NormalizedRow field names to CSV column indices or header names.
 */
export interface CsvColumnMapping {
  /** Column for store identifier */
  storeIdentifier?: number | string
  /** Column for external ID */
  externalId?: number | string
  /** Column for item name (required) */
  name: number | string
  /** Column for description */
  description?: number | string
  /** Column for category */
  category?: number | string
  /** Column for subcategory */
  subcategory?: number | string
  /** Column for brand */
  brand?: number | string
  /** Column for unit */
  unit?: number | string
  /** Column for unit quantity */
  unitQuantity?: number | string
  /** Column for price (required) */
  price: number | string
  /** Column for discount price */
  discountPrice?: number | string
  /** Column for discount start date */
  discountStart?: number | string
  /** Column for discount end date */
  discountEnd?: number | string
  /** Column for barcodes (can be comma-separated) */
  barcodes?: number | string
  /** Column for image URL */
  imageUrl?: number | string
}

/**
 * CSV parser options.
 */
export interface CsvParserOptions {
  /** CSV delimiter character */
  delimiter?: CsvDelimiter
  /** File encoding */
  encoding?: CsvEncoding
  /** Whether the first row is a header */
  hasHeader?: boolean
  /** Column mapping configuration */
  columnMapping?: CsvColumnMapping
  /** Default store identifier if not in CSV */
  defaultStoreIdentifier?: string
  /** Skip empty rows */
  skipEmptyRows?: boolean
  /** Quote character for field escaping */
  quoteChar?: string
}

/**
 * Default CSV parser options.
 */
const DEFAULT_OPTIONS: Required<Omit<CsvParserOptions, 'columnMapping' | 'defaultStoreIdentifier'>> = {
  delimiter: ',',
  encoding: 'utf-8',
  hasHeader: true,
  skipEmptyRows: true,
  quoteChar: '"',
}

/**
 * CSV Parser implementation.
 * Parses CSV files with configurable delimiter and encoding.
 */
export class CsvParser extends Parser {
  readonly fileType: FileType = 'csv'
  readonly extensions: string[] = ['.csv']

  private options: CsvParserOptions

  constructor(options: CsvParserOptions = {}) {
    super()
    this.options = options
  }

  /**
   * Set parser options.
   * @param options - Options to merge with existing
   */
  setOptions(options: Partial<CsvParserOptions>): void {
    this.options = { ...this.options, ...options }
  }

  /**
   * Parse CSV content into normalized rows.
   */
  protected async parseRows(
    context: ParseContext,
  ): Promise<{ rows: NormalizedRow[]; totalRows: number }> {
    const opts = { ...DEFAULT_OPTIONS, ...this.options }

    // Decode content with specified encoding
    const content = this.decodeContent(context.content, opts.encoding)

    // Parse CSV into raw rows
    const rawRows = this.parseCSV(content, opts.delimiter, opts.quoteChar)

    if (rawRows.length === 0) {
      context.addWarning({ field: null, message: 'CSV file is empty' })
      return { rows: [], totalRows: 0 }
    }

    // Extract headers if present
    let headers: string[] = []
    let dataStartRow = 0

    if (opts.hasHeader) {
      headers = rawRows[0]
      dataStartRow = 1
    }

    // Build column index mapping
    const columnIndices = this.buildColumnIndices(headers, opts.columnMapping, context)

    // No column mapping provided - cannot map to NormalizedRow
    if (!columnIndices) {
      context.addError({
        field: null,
        message: 'No column mapping provided. Cannot map CSV columns to normalized fields.',
        originalValue: null,
      })
      return { rows: [], totalRows: rawRows.length - dataStartRow }
    }

    const rows: NormalizedRow[] = []
    const totalRows = rawRows.length - dataStartRow

    for (let i = dataStartRow; i < rawRows.length; i++) {
      const rawRow = rawRows[i]
      const rowNumber = i + 1 // 1-based for user-facing

      // Skip empty rows
      if (opts.skipEmptyRows && rawRow.every((cell) => cell.trim() === '')) {
        continue
      }

      const normalizedRow = this.mapRowToNormalized(
        rawRow,
        rowNumber,
        columnIndices,
        opts.defaultStoreIdentifier ?? '',
        context,
      )

      if (normalizedRow) {
        // Validate required fields
        const validationErrors = this.validateRequiredFields(normalizedRow)
        if (validationErrors.length > 0) {
          for (const error of validationErrors) {
            context.addError({
              rowNumber,
              field: null,
              message: error,
              originalValue: JSON.stringify(rawRow),
            })
          }
          if (context.options.skipInvalid) {
            continue
          }
        }
        rows.push(normalizedRow)
      }
    }

    return { rows, totalRows }
  }

  /**
   * Parse CSV string into array of rows.
   */
  private parseCSV(content: string, delimiter: string, quoteChar: string): string[][] {
    const rows: string[][] = []
    const lines = this.splitLines(content)

    for (const line of lines) {
      if (line.trim() === '') {
        rows.push([])
        continue
      }

      const row = this.parseLine(line, delimiter, quoteChar)
      rows.push(row)
    }

    return rows
  }

  /**
   * Split content into lines, handling different line endings.
   */
  private splitLines(content: string): string[] {
    // Normalize line endings
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  }

  /**
   * Parse a single CSV line into fields, handling quoted values.
   */
  private parseLine(line: string, delimiter: string, quoteChar: string): string[] {
    const fields: string[] = []
    let current = ''
    let inQuotes = false
    let i = 0

    while (i < line.length) {
      const char = line[i]

      if (inQuotes) {
        if (char === quoteChar) {
          // Check for escaped quote (double quote)
          if (i + 1 < line.length && line[i + 1] === quoteChar) {
            current += quoteChar
            i += 2
            continue
          }
          // End of quoted field
          inQuotes = false
          i++
          continue
        }
        current += char
        i++
      } else {
        if (char === quoteChar) {
          inQuotes = true
          i++
          continue
        }
        if (char === delimiter) {
          fields.push(current.trim())
          current = ''
          i++
          continue
        }
        current += char
        i++
      }
    }

    // Add last field
    fields.push(current.trim())

    return fields
  }

  /**
   * Build column indices from headers or numeric indices.
   */
  private buildColumnIndices(
    headers: string[],
    mapping: CsvColumnMapping | undefined,
    context: ParseContext,
  ): Map<string, number> | null {
    if (!mapping) {
      return null
    }

    const indices = new Map<string, number>()

    const resolveIndex = (
      field: string,
      value: number | string | undefined,
    ): number | undefined => {
      if (value === undefined) {
        return undefined
      }

      if (typeof value === 'number') {
        return value
      }

      // It's a header name - find the index
      const idx = headers.findIndex(
        (h) => h.toLowerCase().trim() === value.toLowerCase().trim(),
      )
      if (idx === -1) {
        context.addWarning({
          field: null,
          message: `Column "${value}" for field "${field}" not found in headers`,
        })
        return undefined
      }
      return idx
    }

    // Map all fields
    const fields: (keyof CsvColumnMapping)[] = [
      'storeIdentifier',
      'externalId',
      'name',
      'description',
      'category',
      'subcategory',
      'brand',
      'unit',
      'unitQuantity',
      'price',
      'discountPrice',
      'discountStart',
      'discountEnd',
      'barcodes',
      'imageUrl',
    ]

    for (const field of fields) {
      const idx = resolveIndex(field, mapping[field])
      if (idx !== undefined) {
        indices.set(field, idx)
      }
    }

    // Check required fields
    if (!indices.has('name')) {
      context.addError({
        field: 'name',
        message: 'Column mapping missing required field: name',
        originalValue: null,
      })
      return null
    }
    if (!indices.has('price')) {
      context.addError({
        field: 'price',
        message: 'Column mapping missing required field: price',
        originalValue: null,
      })
      return null
    }

    return indices
  }

  /**
   * Map a raw CSV row to NormalizedRow.
   */
  private mapRowToNormalized(
    rawRow: string[],
    rowNumber: number,
    columnIndices: Map<string, number>,
    defaultStoreIdentifier: string,
    context: ParseContext,
  ): NormalizedRow | null {
    const getValue = (field: string): string | null => {
      const idx = columnIndices.get(field)
      if (idx === undefined || idx >= rawRow.length) {
        return null
      }
      const value = rawRow[idx].trim()
      return value === '' ? null : value
    }

    // Parse price
    const priceStr = getValue('price')
    let price = 0
    if (priceStr) {
      price = this.parsePrice(priceStr)
      if (isNaN(price)) {
        context.addError({
          rowNumber,
          field: 'price',
          message: 'Invalid price value',
          originalValue: priceStr,
        })
        price = 0
      }
    }

    // Parse discount price
    let discountPrice: number | null = null
    const discountPriceStr = getValue('discountPrice')
    if (discountPriceStr) {
      discountPrice = this.parsePrice(discountPriceStr)
      if (isNaN(discountPrice)) {
        context.addWarning({
          rowNumber,
          field: 'discountPrice',
          message: 'Invalid discount price value, ignoring',
        })
        discountPrice = null
      }
    }

    // Parse dates
    const discountStart = this.parseDate(getValue('discountStart'))
    const discountEnd = this.parseDate(getValue('discountEnd'))

    // Parse barcodes
    const barcodesStr = getValue('barcodes')
    const barcodes = barcodesStr
      ? barcodesStr.split(',').map((b) => b.trim()).filter((b) => b !== '')
      : []

    // Get store identifier
    const storeIdentifier = getValue('storeIdentifier') ?? defaultStoreIdentifier

    const row: NormalizedRow = {
      storeIdentifier,
      externalId: getValue('externalId'),
      name: getValue('name') ?? '',
      description: getValue('description'),
      category: getValue('category'),
      subcategory: getValue('subcategory'),
      brand: getValue('brand'),
      unit: getValue('unit'),
      unitQuantity: getValue('unitQuantity'),
      price,
      discountPrice,
      discountStart,
      discountEnd,
      barcodes,
      imageUrl: getValue('imageUrl'),
      rowNumber,
      rawData: JSON.stringify(rawRow),
    }

    return row
  }

  /**
   * Parse a price string to cents (integer).
   * Handles various formats: "12.99", "12,99", "1.299,00"
   */
  private parsePrice(value: string): number {
    // Remove currency symbols and whitespace
    let cleaned = value.replace(/[€$£\s]/g, '')

    // Determine decimal separator
    // If there's a comma after a dot, comma is decimal separator (European)
    // If there's a dot after a comma, dot is decimal separator (US)
    const lastDot = cleaned.lastIndexOf('.')
    const lastComma = cleaned.lastIndexOf(',')

    if (lastComma > lastDot) {
      // European format: 1.234,56 -> comma is decimal
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    } else if (lastDot > lastComma) {
      // US format: 1,234.56 -> just remove commas
      cleaned = cleaned.replace(/,/g, '')
    }

    const parsed = parseFloat(cleaned)
    if (isNaN(parsed)) {
      return NaN
    }

    // Convert to cents
    return Math.round(parsed * 100)
  }

  /**
   * Parse a date string to Date object.
   * Supports various formats: YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY
   */
  private parseDate(value: string | null): Date | null {
    if (!value) {
      return null
    }

    // Try ISO format first (YYYY-MM-DD)
    const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (isoMatch) {
      const date = new Date(
        parseInt(isoMatch[1]),
        parseInt(isoMatch[2]) - 1,
        parseInt(isoMatch[3]),
      )
      return isNaN(date.getTime()) ? null : date
    }

    // European format (DD.MM.YYYY or DD/MM/YYYY)
    const euMatch = value.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/)
    if (euMatch) {
      const date = new Date(
        parseInt(euMatch[3]),
        parseInt(euMatch[2]) - 1,
        parseInt(euMatch[1]),
      )
      return isNaN(date.getTime()) ? null : date
    }

    return null
  }
}

/**
 * Detect delimiter by analyzing the first few lines.
 * @param content - CSV content as string
 * @returns Detected delimiter
 */
export function detectDelimiter(content: string): CsvDelimiter {
  const lines = content.split('\n').slice(0, 5)
  const delimiters: CsvDelimiter[] = [',', ';', '\t']

  let bestDelimiter: CsvDelimiter = ','
  let maxConsistency = 0

  for (const delimiter of delimiters) {
    const counts = lines
      .filter((l) => l.trim() !== '')
      .map((line) => (line.match(new RegExp(delimiter === '\t' ? '\\t' : delimiter, 'g')) || []).length)

    if (counts.length === 0) continue

    // Check consistency - all lines should have similar counts
    const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length
    const variance = counts.reduce((sum, c) => sum + Math.pow(c - avgCount, 2), 0) / counts.length
    const consistency = avgCount > 0 ? avgCount / (1 + variance) : 0

    if (consistency > maxConsistency) {
      maxConsistency = consistency
      bestDelimiter = delimiter
    }
  }

  return bestDelimiter
}

/**
 * Detect encoding by checking for common patterns.
 * @param buffer - File content as ArrayBuffer
 * @returns Detected encoding
 */
export function detectEncoding(buffer: ArrayBuffer): CsvEncoding {
  const bytes = new Uint8Array(buffer)

  // Check for UTF-8 BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8'
  }

  // Check for Windows-1250 specific characters
  // Common Croatian/Central European chars in Windows-1250
  let windows1250Score = 0
  for (let i = 0; i < Math.min(bytes.length, 1000); i++) {
    const byte = bytes[i]
    // Characters like Š (0x8A), š (0x9A), Đ (0xD0), đ (0xF0), Č (0xC8), č (0xE8)
    // Ž (0x8E), ž (0x9E), Ć (0xC6), ć (0xE6)
    if (
      byte === 0x8a || byte === 0x9a || // Š, š
      byte === 0xd0 || byte === 0xf0 || // Đ, đ
      byte === 0xc8 || byte === 0xe8 || // Č, č
      byte === 0x8e || byte === 0x9e || // Ž, ž
      byte === 0xc6 || byte === 0xe6    // Ć, ć
    ) {
      windows1250Score++
    }
  }

  if (windows1250Score > 2) {
    return 'windows-1250'
  }

  // Default to UTF-8
  return 'utf-8'
}
