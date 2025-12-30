/**
 * Konzum Chain Adapter
 *
 * Adapter for parsing Konzum retail chain price data files.
 * Konzum uses CSV format with comma delimiter and UTF-8 encoding.
 * Store resolution is based on filename (address + store ID pattern).
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
 * Column mapping for Konzum CSV files.
 * Maps Konzum's column names to NormalizedRow fields.
 */
const KONZUM_COLUMN_MAPPING: CsvColumnMapping = {
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
 * Alternative column mapping for Konzum CSV files (English headers).
 * Some Konzum exports may use English column names.
 */
const KONZUM_COLUMN_MAPPING_EN: CsvColumnMapping = {
  externalId: 'Code',
  name: 'Name',
  category: 'Category',
  brand: 'Brand',
  unit: 'Unit',
  unitQuantity: 'Quantity',
  price: 'Price',
  discountPrice: 'Discount Price',
  discountStart: 'Discount Start',
  discountEnd: 'Discount End',
  barcodes: 'Barcode',
}

/**
 * Konzum chain adapter implementation.
 */
export class KonzumAdapter implements ChainAdapter {
  readonly slug = 'konzum'
  readonly name = 'Konzum'
  readonly supportedTypes: FileType[] = ['csv']

  private config = CHAIN_CONFIGS.konzum
  private csvParser: CsvParser

  constructor() {
    this.csvParser = new CsvParser({
      delimiter: this.config.csv!.delimiter,
      encoding: this.config.csv!.encoding,
      hasHeader: this.config.csv!.hasHeader,
      columnMapping: KONZUM_COLUMN_MAPPING,
      skipEmptyRows: true,
    })
  }

  /**
   * Discover available Konzum price files.
   * In production, this would scrape the Konzum price portal.
   */
  async discover(): Promise<DiscoveredFile[]> {
    // TODO: Implement actual discovery from Konzum's price portal
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
   * Parse Konzum CSV content into normalized rows.
   */
  async parse(
    content: ArrayBuffer,
    filename: string,
    options?: ParseOptions,
  ): Promise<ParseResult> {
    // Extract store identifier from filename to use as default
    const storeIdentifier = this.extractStoreIdentifierFromFilename(filename)

    // Try parsing with Croatian headers first
    this.csvParser.setOptions({
      columnMapping: KONZUM_COLUMN_MAPPING,
      defaultStoreIdentifier: storeIdentifier,
    })

    let result = await this.csvParser.parse(content, filename, options)

    // If no valid rows, try English headers
    if (result.validRows === 0 && result.errors.length > 0) {
      this.csvParser.setOptions({
        columnMapping: KONZUM_COLUMN_MAPPING_EN,
        defaultStoreIdentifier: storeIdentifier,
      })
      result = await this.csvParser.parse(content, filename, options)
    }

    return result
  }

  /**
   * Extract store identifier from Konzum filename.
   * Konzum filenames typically follow pattern: STORE_ADDRESS_ID.csv
   * Example: "Konzum_Zagreb_Ilica_123_456.csv" -> "Zagreb_Ilica_123_456"
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
      .replace(/^Konzum[_-]?/i, '')
      .replace(/^cjenik[_-]?/i, '')
      .trim()

    // If nothing left, use full basename
    return cleanName || baseName
  }

  /**
   * Validate a normalized row according to Konzum-specific rules.
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

    // Konzum-specific validations
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
 * Create a Konzum adapter instance.
 */
export function createKonzumAdapter(): KonzumAdapter {
  return new KonzumAdapter()
}
