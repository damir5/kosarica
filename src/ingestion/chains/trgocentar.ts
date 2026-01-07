/**
 * Trgocentar Chain Adapter
 *
 * Adapter for parsing Trgocentar retail chain price data files.
 * Trgocentar uses CSV format with semicolon delimiter and Windows-1250 encoding.
 * Store resolution is based on filename.
 */

import type { CsvColumnMapping } from '../parsers/csv'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * Column mapping for Trgocentar CSV files.
 * Maps Trgocentar's column names to NormalizedRow fields.
 */
const TRGOCENTAR_COLUMN_MAPPING: CsvColumnMapping = {
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
 * Alternative column mapping for Trgocentar CSV files.
 * Some Trgocentar exports may use abbreviated or different column names without diacritics.
 */
const TRGOCENTAR_COLUMN_MAPPING_ALT: CsvColumnMapping = {
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
 * Trgocentar chain adapter implementation.
 * Extends BaseCsvAdapter for common CSV parsing functionality.
 */
export class TrgocentarAdapter extends BaseCsvAdapter {
  constructor() {
    super({
      slug: 'trgocentar',
      name: 'Trgocentar',
      supportedTypes: ['csv'],
      chainConfig: CHAIN_CONFIGS.trgocentar,
      columnMapping: TRGOCENTAR_COLUMN_MAPPING,
      alternativeColumnMapping: TRGOCENTAR_COLUMN_MAPPING_ALT,
      filenamePrefixPatterns: [
        /^Trgocentar[_-]?/i,
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
 * Create a Trgocentar adapter instance.
 */
export function createTrgocentarAdapter(): TrgocentarAdapter {
  return new TrgocentarAdapter()
}
