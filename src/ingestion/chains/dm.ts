/**
 * DM Chain Adapter
 *
 * Adapter for parsing DM retail chain price data files.
 * DM uses XLSX format and has national (uniform) pricing across all stores.
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
import { XlsxParser, type XlsxColumnMapping } from '../parsers/xlsx'

/**
 * Column mapping for DM XLSX files.
 * Maps DM's Croatian column names to NormalizedRow fields.
 */
const DM_COLUMN_MAPPING: XlsxColumnMapping = {
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
 * Alternative column mapping for DM XLSX files.
 * Some DM exports may use abbreviated or different column names.
 */
const DM_COLUMN_MAPPING_ALT: XlsxColumnMapping = {
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
 * Default store identifier for DM (national pricing).
 * DM has uniform pricing across all stores in Croatia.
 */
const DM_NATIONAL_STORE_IDENTIFIER = 'dm_national'

/**
 * DM chain adapter implementation.
 */
export class DmAdapter implements ChainAdapter {
  readonly slug = 'dm'
  readonly name = 'DM'
  readonly supportedTypes: FileType[] = ['xlsx']

  private xlsxParser: XlsxParser

  constructor() {
    this.xlsxParser = new XlsxParser({
      columnMapping: DM_COLUMN_MAPPING,
      hasHeader: true,
      skipEmptyRows: true,
      defaultStoreIdentifier: DM_NATIONAL_STORE_IDENTIFIER,
    })
  }

  /**
   * Discover available DM price files.
   * In production, this would scrape the DM price portal.
   */
  async discover(): Promise<DiscoveredFile[]> {
    // TODO: Implement actual discovery from DM's price portal
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
   * Parse DM XLSX content into normalized rows.
   */
  async parse(
    content: ArrayBuffer,
    filename: string,
    options?: ParseOptions,
  ): Promise<ParseResult> {
    // DM has national pricing, always use the national store identifier
    const storeIdentifier = DM_NATIONAL_STORE_IDENTIFIER

    // Try parsing with primary column mapping first
    this.xlsxParser.setOptions({
      columnMapping: DM_COLUMN_MAPPING,
      defaultStoreIdentifier: storeIdentifier,
    })

    let result = await this.xlsxParser.parse(content, filename, options)

    // If no valid rows, try alternative column mapping
    if (result.validRows === 0 && result.errors.length > 0) {
      this.xlsxParser.setOptions({
        columnMapping: DM_COLUMN_MAPPING_ALT,
        defaultStoreIdentifier: storeIdentifier,
      })
      result = await this.xlsxParser.parse(content, filename, options)
    }

    return result
  }

  /**
   * Extract store identifier for DM.
   * DM has national pricing, so always returns the national identifier.
   */
  extractStoreIdentifier(_file: DiscoveredFile): StoreIdentifier | null {
    // DM has uniform national pricing - no per-store variation
    return {
      type: 'national',
      value: DM_NATIONAL_STORE_IDENTIFIER,
    }
  }

  /**
   * Validate a normalized row according to DM-specific rules.
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

    // DM-specific validations
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
 * Create a DM adapter instance.
 */
export function createDmAdapter(): DmAdapter {
  return new DmAdapter()
}
