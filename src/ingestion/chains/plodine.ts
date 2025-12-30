/**
 * Plodine Chain Adapter
 *
 * Adapter for parsing Plodine retail chain price data files.
 * Plodine uses CSV format with semicolon delimiter and Windows-1250 encoding.
 * Store resolution is based on filename.
 *
 * Special handling: Plodine files may contain prices with missing leading zero
 * (e.g., ",69" instead of "0,69"), which this adapter handles via preprocessing.
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
 * Column mapping for Plodine CSV files.
 * Maps Plodine's column names to NormalizedRow fields.
 */
const PLODINE_COLUMN_MAPPING: CsvColumnMapping = {
  externalId: 'Šifra',
  name: 'Naziv',
  category: 'Kategorija',
  brand: 'Marka',
  unit: 'Mjerna jedinica',
  unitQuantity: 'Količina',
  price: 'Cijena',
  discountPrice: 'Akcijska cijena',
  discountStart: 'Početak akcije',
  discountEnd: 'Kraj akcije',
  barcodes: 'Barkod',
}

/**
 * Alternative column mapping for Plodine CSV files.
 * Some Plodine exports may use abbreviated or different column names.
 */
const PLODINE_COLUMN_MAPPING_ALT: CsvColumnMapping = {
  externalId: 'Sifra',
  name: 'Naziv artikla',
  category: 'Kategorija',
  brand: 'Marka',
  unit: 'JM',
  unitQuantity: 'Kolicina',
  price: 'Cijena',
  discountPrice: 'Akcija',
  discountStart: 'Pocetak akcije',
  discountEnd: 'Kraj akcije',
  barcodes: 'EAN',
}

/**
 * Plodine chain adapter implementation.
 */
export class PlodineAdapter implements ChainAdapter {
  readonly slug = 'plodine'
  readonly name = 'Plodine'
  readonly supportedTypes: FileType[] = ['csv']

  private config = CHAIN_CONFIGS.plodine
  private csvParser: CsvParser

  constructor() {
    this.csvParser = new CsvParser({
      delimiter: this.config.csv!.delimiter,
      encoding: this.config.csv!.encoding,
      hasHeader: this.config.csv!.hasHeader,
      columnMapping: PLODINE_COLUMN_MAPPING,
      skipEmptyRows: true,
    })
  }

  /**
   * Discover available Plodine price files.
   * In production, this would scrape the Plodine price portal.
   */
  async discover(): Promise<DiscoveredFile[]> {
    // TODO: Implement actual discovery from Plodine's price portal
    // For now, return empty array - files will be provided directly
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
   * Preprocess CSV content to fix Plodine-specific formatting issues.
   * Handles missing leading zeros in decimal values (e.g., ",69" -> "0,69").
   */
  private preprocessContent(content: ArrayBuffer): ArrayBuffer {
    // Decode with Windows-1250 encoding
    const decoder = new TextDecoder(this.config.csv!.encoding)
    let text = decoder.decode(content)

    // Fix missing leading zeros in prices
    // Pattern matches: semicolon followed by comma and digits (;,69)
    // or start of value that's just comma and digits
    // We use semicolon as Plodine uses semicolon delimiter
    text = text.replace(/;,(\d)/g, ';0,$1')

    // Also handle case where value might be at start or in quotes
    text = text.replace(/^,(\d)/gm, '0,$1')
    text = text.replace(/",(\d)/g, '"0,$1')

    // Re-encode
    const encoder = new TextEncoder()
    return encoder.encode(text).buffer as ArrayBuffer
  }

  /**
   * Parse Plodine CSV content into normalized rows.
   */
  async parse(
    content: ArrayBuffer,
    filename: string,
    options?: ParseOptions,
  ): Promise<ParseResult> {
    // Preprocess content to fix price format issues
    const processedContent = this.preprocessContent(content)

    // Extract store identifier from filename to use as default
    const storeIdentifier = this.extractStoreIdentifierFromFilename(filename)

    // Try parsing with primary column mapping first
    this.csvParser.setOptions({
      columnMapping: PLODINE_COLUMN_MAPPING,
      defaultStoreIdentifier: storeIdentifier,
      encoding: 'utf-8', // After preprocessing, content is UTF-8
    })

    let result = await this.csvParser.parse(processedContent, filename, options)

    // If no valid rows, try alternative column mapping
    if (result.validRows === 0 && result.errors.length > 0) {
      this.csvParser.setOptions({
        columnMapping: PLODINE_COLUMN_MAPPING_ALT,
        defaultStoreIdentifier: storeIdentifier,
        encoding: 'utf-8',
      })
      result = await this.csvParser.parse(processedContent, filename, options)
    }

    return result
  }

  /**
   * Extract store identifier from Plodine filename.
   * Plodine filenames typically follow pattern: STORE_LOCATION_ID.csv
   * Example: "Plodine_Zagreb_Dubrava_123.csv" -> "Zagreb_Dubrava_123"
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

    // Remove common prefixes
    const cleanName = baseName
      .replace(/^Plodine[_-]?/i, '')
      .replace(/^cjenik[_-]?/i, '')
      .trim()

    // If nothing left, use full basename
    return cleanName || baseName
  }

  /**
   * Validate a normalized row according to Plodine-specific rules.
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

    // Plodine-specific validations
    if (row.price > 100000000) {
      // > 1,000,000 HRK/EUR seems unlikely
      warnings.push('Price seems unusually high')
    }

    if (row.discountPrice !== null && row.discountPrice >= row.price) {
      warnings.push('Discount price is not less than regular price')
    }

    // Barcode validation
    for (const barcode of row.barcodes) {
      if (!/^\d{8,14}$/.test(barcode)) {
        warnings.push(`Invalid barcode format: ${barcode}`)
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    }
  }
}

/**
 * Create a Plodine adapter instance.
 */
export function createPlodineAdapter(): PlodineAdapter {
  return new PlodineAdapter()
}
