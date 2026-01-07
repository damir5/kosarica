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

import type { CsvColumnMapping, CsvParserOptions } from '../parsers/csv'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

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
  // Croatian price transparency fields
  unitPrice: 'Cijena za jedinicu mjere',
  lowestPrice30d: 'Najniža cijena u zadnjih 30 dana',
  anchorPrice: 'Sidrena cijena',
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
 * Extends BaseCsvAdapter with custom preprocessing for price formatting issues.
 */
export class PlodineAdapter extends BaseCsvAdapter {
  constructor() {
    super({
      slug: 'plodine',
      name: 'Plodine',
      supportedTypes: ['csv'],
      chainConfig: CHAIN_CONFIGS.plodine,
      columnMapping: PLODINE_COLUMN_MAPPING,
      alternativeColumnMapping: PLODINE_COLUMN_MAPPING_ALT,
      filenamePrefixPatterns: [
        /^Plodine[_-]?/i,
        /^cjenik[_-]?/i,
      ],
      rateLimitConfig: {
        requestsPerSecond: 2,
        maxRetries: 3,
      },
    })
  }

  /**
   * Preprocess CSV content to fix Plodine-specific formatting issues.
   * Handles missing leading zeros in decimal values (e.g., ",69" -> "0,69").
   */
  protected preprocessContent(content: ArrayBuffer): ArrayBuffer {
    // Decode with Windows-1250 encoding
    const decoder = new TextDecoder(this.csvConfig.encoding)
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
   * Get parser options with encoding override.
   * After preprocessing, content is UTF-8.
   */
  protected getParserOptions(storeIdentifier: string): Partial<CsvParserOptions> {
    return {
      defaultStoreIdentifier: storeIdentifier,
      encoding: 'utf-8', // After preprocessing, content is UTF-8
    }
  }
}

/**
 * Create a Plodine adapter instance.
 */
export function createPlodineAdapter(): PlodineAdapter {
  return new PlodineAdapter()
}
