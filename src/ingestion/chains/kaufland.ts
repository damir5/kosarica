/**
 * Kaufland Chain Adapter
 *
 * Adapter for parsing Kaufland retail chain price data files.
 * Kaufland uses CSV format with tab delimiter and UTF-8 encoding.
 * Store resolution is based on filename.
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
 * Column mapping for Kaufland CSV files.
 * Maps Kaufland's column names to NormalizedRow fields.
 */
const KAUFLAND_COLUMN_MAPPING: CsvColumnMapping = {
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
 * Alternative column mapping for Kaufland CSV files.
 * Some Kaufland exports may use abbreviated or different column names.
 */
const KAUFLAND_COLUMN_MAPPING_ALT: CsvColumnMapping = {
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
 * Kaufland chain adapter implementation.
 */
export class KauflandAdapter implements ChainAdapter {
  readonly slug = 'kaufland'
  readonly name = 'Kaufland'
  readonly supportedTypes: FileType[] = ['csv']

  private config = CHAIN_CONFIGS.kaufland
  private csvParser: CsvParser

  constructor() {
    this.csvParser = new CsvParser({
      delimiter: this.config.csv!.delimiter,
      encoding: this.config.csv!.encoding,
      hasHeader: this.config.csv!.hasHeader,
      columnMapping: KAUFLAND_COLUMN_MAPPING,
      skipEmptyRows: true,
    })
  }

  /**
   * Discover available Kaufland price files.
   * In production, this would scrape the Kaufland price portal.
   */
  async discover(): Promise<DiscoveredFile[]> {
    // TODO: Implement actual discovery from Kaufland's price portal
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
   * Parse Kaufland CSV content into normalized rows.
   */
  async parse(
    content: ArrayBuffer,
    filename: string,
    options?: ParseOptions,
  ): Promise<ParseResult> {
    // Extract store identifier from filename to use as default
    const storeIdentifier = this.extractStoreIdentifierFromFilename(filename)

    // Try parsing with primary column mapping first
    this.csvParser.setOptions({
      columnMapping: KAUFLAND_COLUMN_MAPPING,
      defaultStoreIdentifier: storeIdentifier,
    })

    let result = await this.csvParser.parse(content, filename, options)

    // If no valid rows, try alternative column mapping
    if (result.validRows === 0 && result.errors.length > 0) {
      this.csvParser.setOptions({
        columnMapping: KAUFLAND_COLUMN_MAPPING_ALT,
        defaultStoreIdentifier: storeIdentifier,
      })
      result = await this.csvParser.parse(content, filename, options)
    }

    return result
  }

  /**
   * Extract store identifier from Kaufland filename.
   * Kaufland filenames typically follow pattern: STORE_LOCATION_ID.csv
   * Example: "Kaufland_Zagreb_123.csv" -> "Zagreb_123"
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
      .replace(/^Kaufland[_-]?/i, '')
      .replace(/^cjenik[_-]?/i, '')
      .trim()

    // If nothing left, use full basename
    return cleanName || baseName
  }

  /**
   * Validate a normalized row according to Kaufland-specific rules.
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

    // Kaufland-specific validations
    if (row.price > 100000000) {
      // > 1,000,000 EUR seems unlikely
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
 * Create a Kaufland adapter instance.
 */
export function createKauflandAdapter(): KauflandAdapter {
  return new KauflandAdapter()
}
