/**
 * Eurospin Chain Adapter
 *
 * Adapter for parsing Eurospin retail chain price data files.
 * Eurospin uses CSV format with semicolon delimiter and UTF-8 encoding.
 * Store resolution is based on filename.
 */

import type { CsvColumnMapping } from '../parsers/csv'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * Column mapping for Eurospin CSV files.
 * Maps Eurospin's column names to NormalizedRow fields.
 */
const EUROSPIN_COLUMN_MAPPING: CsvColumnMapping = {
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
 * Alternative column mapping for Eurospin CSV files.
 * Some Eurospin exports may use abbreviated or different column names.
 */
const EUROSPIN_COLUMN_MAPPING_ALT: CsvColumnMapping = {
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
 * Eurospin chain adapter implementation.
 * Extends BaseCsvAdapter for common CSV parsing functionality.
 */
export class EurospinAdapter extends BaseCsvAdapter {
  constructor() {
    super({
      slug: 'eurospin',
      name: 'Eurospin',
      supportedTypes: ['csv'],
      chainConfig: CHAIN_CONFIGS.eurospin,
      columnMapping: EUROSPIN_COLUMN_MAPPING,
      alternativeColumnMapping: EUROSPIN_COLUMN_MAPPING_ALT,
      filenamePrefixPatterns: [
        /^Eurospin[_-]?/i,
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
 * Create a Eurospin adapter instance.
 */
export function createEurospinAdapter(): EurospinAdapter {
  return new EurospinAdapter()
}
