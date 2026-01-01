/**
 * Konzum Chain Adapter
 *
 * Adapter for parsing Konzum retail chain price data files.
 * Konzum uses CSV format with comma delimiter and UTF-8 encoding.
 * Store resolution is based on filename (address + store ID pattern).
 */

import type { CsvColumnMapping } from '../parsers/csv'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

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
 * Extends BaseCsvAdapter for common CSV parsing functionality.
 */
export class KonzumAdapter extends BaseCsvAdapter {
  constructor() {
    super({
      slug: 'konzum',
      name: 'Konzum',
      supportedTypes: ['csv'],
      chainConfig: CHAIN_CONFIGS.konzum,
      columnMapping: KONZUM_COLUMN_MAPPING,
      alternativeColumnMapping: KONZUM_COLUMN_MAPPING_EN,
      filenamePrefixPatterns: [
        /^Konzum[_-]?/i,
        /^cjenik[_-]?/i,
      ],
      rateLimitConfig: {
        requestsPerSecond: 2,
        maxRetries: 3,
      },
    })
  }
}

/**
 * Create a Konzum adapter instance.
 */
export function createKonzumAdapter(): KonzumAdapter {
  return new KonzumAdapter()
}
