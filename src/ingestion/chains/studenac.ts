/**
 * Studenac Chain Adapter
 *
 * Adapter for parsing Studenac retail chain price data files.
 * Studenac uses XML format with store information embedded in the XML structure.
 * Store resolution is based on portal ID within the XML content.
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
import { XmlParser, type XmlFieldMapping } from '../parsers/xml'

/**
 * XML field mapping for Studenac files.
 * Maps Studenac's XML elements to NormalizedRow fields.
 * Studenac XML structure typically has store info and product data nested.
 */
const STUDENAC_FIELD_MAPPING: XmlFieldMapping = {
  storeIdentifier: (item) => {
    // Extract store ID from item or parent store block
    const storeId =
      (item['store_id'] as string) ??
      (item['storeId'] as string) ??
      (item['Store'] as Record<string, unknown>)?.['Id'] as string ??
      null
    return storeId ? String(storeId) : null
  },
  externalId: 'code',
  name: 'name',
  description: 'description',
  category: 'category',
  subcategory: 'subcategory',
  brand: 'brand',
  unit: 'unit',
  unitQuantity: 'quantity',
  price: 'price',
  discountPrice: 'discount_price',
  discountStart: 'discount_start',
  discountEnd: 'discount_end',
  barcodes: 'barcode',
  imageUrl: 'image_url',
}

/**
 * Alternative field mapping for Studenac XML files (uppercase/different naming).
 */
const STUDENAC_FIELD_MAPPING_ALT: XmlFieldMapping = {
  storeIdentifier: (item) => {
    const storeId =
      (item['StoreId'] as string) ??
      (item['STORE_ID'] as string) ??
      (item['Poslovnica'] as Record<string, unknown>)?.['Id'] as string ??
      null
    return storeId ? String(storeId) : null
  },
  externalId: 'Sifra',
  name: 'Naziv',
  description: 'Opis',
  category: 'Kategorija',
  subcategory: 'Podkategorija',
  brand: 'Marka',
  unit: 'Jedinica',
  unitQuantity: 'Kolicina',
  price: 'Cijena',
  discountPrice: 'AkcijskaCijena',
  discountStart: 'PocetakAkcije',
  discountEnd: 'KrajAkcije',
  barcodes: 'Barkod',
  imageUrl: 'Slika',
}

/**
 * Studenac chain adapter implementation.
 */
export class StudenacAdapter implements ChainAdapter {
  readonly slug = 'studenac'
  readonly name = 'Studenac'
  readonly supportedTypes: FileType[] = ['xml']

  private xmlParser: XmlParser

  constructor() {
    this.xmlParser = new XmlParser({
      itemsPath: 'products.product',
      fieldMapping: STUDENAC_FIELD_MAPPING,
    })
  }

  /**
   * Discover available Studenac price files.
   * In production, this would scrape the Studenac price portal.
   */
  async discover(): Promise<DiscoveredFile[]> {
    // TODO: Implement actual discovery from Studenac's price portal
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
   * Parse Studenac XML content into normalized rows.
   */
  async parse(
    content: ArrayBuffer,
    filename: string,
    options?: ParseOptions,
  ): Promise<ParseResult> {
    // Try common XML item paths
    const itemPaths = [
      'products.product',
      'Products.Product',
      'items.item',
      'Items.Item',
      'data.product',
      'Data.Product',
      'Cjenik.Proizvod',
      'cjenik.proizvod',
    ]

    // Try with primary field mapping first
    for (const itemsPath of itemPaths) {
      this.xmlParser.setOptions({
        itemsPath,
        fieldMapping: STUDENAC_FIELD_MAPPING,
      })

      const result = await this.xmlParser.parse(content, filename, options)

      if (result.validRows > 0) {
        return result
      }
    }

    // Try alternative field mapping
    for (const itemsPath of itemPaths) {
      this.xmlParser.setOptions({
        itemsPath,
        fieldMapping: STUDENAC_FIELD_MAPPING_ALT,
      })

      const result = await this.xmlParser.parse(content, filename, options)

      if (result.validRows > 0) {
        return result
      }
    }

    // Return last attempt result (will contain errors)
    return this.xmlParser.parse(content, filename, options)
  }

  /**
   * Extract store identifier from Studenac file.
   * For XML files, the store identifier is typically embedded in the content,
   * but we can also try to extract from filename as fallback.
   */
  extractStoreIdentifier(file: DiscoveredFile): StoreIdentifier | null {
    // Try to extract from metadata if set during discovery
    if (file.metadata['storeId']) {
      return {
        type: 'portal_id',
        value: file.metadata['storeId'],
      }
    }

    // Try to extract from filename as fallback
    const identifier = this.extractStoreIdentifierFromFilename(file.filename)
    if (identifier) {
      return {
        type: 'filename_code',
        value: identifier,
      }
    }

    return null
  }

  /**
   * Extract store identifier string from filename.
   */
  private extractStoreIdentifierFromFilename(filename: string): string | null {
    // Remove file extension
    const baseName = filename.replace(/\.(xml|XML)$/, '')

    // Remove common prefixes
    const cleanName = baseName
      .replace(/^Studenac[_-]?/i, '')
      .replace(/^cjenik[_-]?/i, '')
      .trim()

    // Try to extract store ID from patterns like "store_123" or "poslovnica_456"
    const storeIdMatch = cleanName.match(/(?:store|poslovnica|trgovina)[_-]?(\d+)/i)
    if (storeIdMatch) {
      return storeIdMatch[1]
    }

    // If nothing matches, use the clean name
    return cleanName || null
  }

  /**
   * Validate a normalized row according to Studenac-specific rules.
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

    // Studenac-specific validations
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
 * Create a Studenac adapter instance.
 */
export function createStudenacAdapter(): StudenacAdapter {
  return new StudenacAdapter()
}
