/**
 * Lidl Chain Adapter
 *
 * Adapter for parsing Lidl retail chain price data files.
 * Lidl uses CSV format with comma delimiter and UTF-8 encoding.
 * Store resolution is based on filename (daily ZIP files → fanout).
 * Handles multiple GTINs per SKU.
 */

import type {
  ChainAdapter,
  DiscoveredFile,
  FetchedFile,
  FileType,
  NormalizedRow,
  NormalizedRowValidation,
  ParseOptions,
  ParseResult,
  StoreIdentifier,
} from '../core/types'
import { computeSha256 } from '../core/storage'
import { CsvParser, type CsvColumnMapping } from '../parsers/csv'
import { CHAIN_CONFIGS } from './index'

/**
 * Column mapping for Lidl CSV files (Croatian headers).
 * Maps Lidl's column names to NormalizedRow fields.
 * Lidl may include multiple GTINs separated by semicolon in the barcode field.
 */
const LIDL_COLUMN_MAPPING: CsvColumnMapping = {
  externalId: 'Artikl',
  name: 'Naziv artikla',
  category: 'Kategorija',
  brand: 'Robna marka',
  unit: 'Jedinica mjere',
  unitQuantity: 'Količina',
  price: 'Cijena',
  discountPrice: 'Akcijska cijena',
  discountStart: 'Početak akcije',
  discountEnd: 'Završetak akcije',
  barcodes: 'GTIN',
}

/**
 * Alternative column mapping for Lidl CSV files (abbreviated headers).
 * Some Lidl exports may use abbreviated column names.
 */
const LIDL_COLUMN_MAPPING_ALT: CsvColumnMapping = {
  externalId: 'Art.br.',
  name: 'Naziv',
  category: 'Kat.',
  brand: 'Marka',
  unit: 'JM',
  unitQuantity: 'Kol.',
  price: 'Cijena',
  discountPrice: 'Akc. cijena',
  discountStart: 'Akc. od',
  discountEnd: 'Akc. do',
  barcodes: 'GTIN',
}

/**
 * Lidl chain adapter implementation.
 */
export class LidlAdapter implements ChainAdapter {
  readonly slug = 'lidl'
  readonly name = 'Lidl'
  readonly supportedTypes: FileType[] = ['csv', 'zip']

  private config = CHAIN_CONFIGS.lidl
  private csvParser: CsvParser

  constructor() {
    this.csvParser = new CsvParser({
      delimiter: this.config.csv!.delimiter,
      encoding: this.config.csv!.encoding,
      hasHeader: this.config.csv!.hasHeader,
      columnMapping: LIDL_COLUMN_MAPPING,
      skipEmptyRows: true,
    })
  }

  /**
   * Discover available Lidl price files.
   * In production, this would scrape the Lidl price portal.
   */
  async discover(): Promise<DiscoveredFile[]> {
    // TODO: Implement actual discovery from Lidl's price portal
    // Lidl typically publishes daily ZIP files with per-store CSVs
    return []
  }

  /**
   * Fetch a discovered file.
   */
  async fetch(file: DiscoveredFile): Promise<FetchedFile> {
    const response = await fetch(file.url)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${file.url}: ${response.status} ${response.statusText}`)
    }

    const content = await response.arrayBuffer()
    const hash = await computeSha256(content)

    return {
      discovered: file,
      content,
      hash,
    }
  }

  /**
   * Parse Lidl CSV content into normalized rows.
   * Handles multiple GTINs per SKU by splitting on semicolon.
   */
  async parse(
    content: ArrayBuffer,
    filename: string,
    options?: ParseOptions,
  ): Promise<ParseResult> {
    // Extract store identifier from filename to use as default
    const storeIdentifier = this.extractStoreIdentifierFromFilename(filename)

    // Try parsing with standard Croatian headers first
    this.csvParser.setOptions({
      columnMapping: LIDL_COLUMN_MAPPING,
      defaultStoreIdentifier: storeIdentifier,
    })

    let result = await this.csvParser.parse(content, filename, options)

    // If no valid rows, try abbreviated headers
    if (result.validRows === 0 && result.errors.length > 0) {
      this.csvParser.setOptions({
        columnMapping: LIDL_COLUMN_MAPPING_ALT,
        defaultStoreIdentifier: storeIdentifier,
      })
      result = await this.csvParser.parse(content, filename, options)
    }

    // Post-process to handle multiple GTINs
    result.rows = result.rows.map((row) => this.normalizeMultipleGtins(row))

    return result
  }

  /**
   * Normalize multiple GTINs in a row.
   * Lidl may list multiple GTINs separated by semicolon or pipe.
   */
  private normalizeMultipleGtins(row: NormalizedRow): NormalizedRow {
    if (row.barcodes.length === 1) {
      // Check if single barcode contains multiple GTINs
      const barcode = row.barcodes[0]
      if (barcode.includes(';') || barcode.includes('|')) {
        const gtins = barcode
          .split(/[;|]/)
          .map((g) => g.trim())
          .filter((g) => g.length > 0)
        return { ...row, barcodes: gtins }
      }
    }
    return row
  }

  /**
   * Extract store identifier from Lidl filename.
   * Lidl filenames typically follow pattern: LIDL_DATE_STOREID.csv
   * or from ZIP: Lidl_Poslovnica_123_Zagreb.csv
   * Example: "Lidl_2024-01-15_42.csv" -> "42"
   * Example: "Lidl_Poslovnica_Zagreb_Ilica_123.csv" -> "Zagreb_Ilica_123"
   */
  extractStoreIdentifier(file: DiscoveredFile): StoreIdentifier | null {
    const identifier = this.extractStoreIdentifierFromFilename(file.filename)
    if (!identifier) {
      return null
    }

    return {
      type: 'filename_code',
      value: identifier,
    }
  }

  /**
   * Extract store identifier string from filename.
   */
  private extractStoreIdentifierFromFilename(filename: string): string {
    // Remove file extension
    const baseName = filename.replace(/\.(csv|CSV)$/, '')

    // Try to extract store ID from various Lidl filename patterns
    // Pattern 1: Lidl_DATE_STOREID (e.g., "Lidl_2024-01-15_42")
    const dateStoreMatch = baseName.match(/^Lidl[_-]?\d{4}[_-]\d{2}[_-]\d{2}[_-](.+)$/i)
    if (dateStoreMatch) {
      return dateStoreMatch[1]
    }

    // Pattern 2: Lidl_Poslovnica_LOCATION (e.g., "Lidl_Poslovnica_Zagreb_Ilica_123")
    const locationMatch = baseName.match(/^Lidl[_-]?Poslovnica[_-]?(.+)$/i)
    if (locationMatch) {
      return locationMatch[1]
    }

    // Pattern 3: Just Lidl_STOREID (e.g., "Lidl_42")
    const simpleMatch = baseName.match(/^Lidl[_-]?(\d+)$/i)
    if (simpleMatch) {
      return simpleMatch[1]
    }

    // Remove common prefixes
    const cleanName = baseName
      .replace(/^Lidl[_-]?/i, '')
      .replace(/^cjenik[_-]?/i, '')
      .replace(/^\d{4}[_-]\d{2}[_-]\d{2}[_-]?/, '') // Remove date prefix
      .trim()

    // If nothing left, use full basename
    return cleanName || baseName
  }

  /**
   * Validate a normalized row according to Lidl-specific rules.
   */
  validateRow(row: NormalizedRow): NormalizedRowValidation {
    const errors: string[] = []
    const warnings: string[] = []

    // Required field validation
    if (!row.name || row.name.trim() === '') {
      errors.push('Missing product name')
    }

    if (row.price <= 0) {
      errors.push('Price must be positive')
    }

    // Lidl-specific validations
    if (row.price > 100000000) {
      // > 1,000,000 EUR seems unlikely
      warnings.push('Price seems unusually high')
    }

    if (row.discountPrice !== null && row.discountPrice >= row.price) {
      warnings.push('Discount price is not less than regular price')
    }

    // GTIN validation - Lidl uses EAN-13 and EAN-8
    for (const barcode of row.barcodes) {
      if (!/^\d{8}$|^\d{13}$|^\d{14}$/.test(barcode)) {
        warnings.push(`Invalid GTIN format: ${barcode} (expected EAN-8, EAN-13, or GTIN-14)`)
      }
    }

    // Lidl products should typically have at least one GTIN
    if (row.barcodes.length === 0) {
      warnings.push('No GTIN/barcode found for product')
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    }
  }
}

/**
 * Create a Lidl adapter instance.
 */
export function createLidlAdapter(): LidlAdapter {
  return new LidlAdapter()
}
