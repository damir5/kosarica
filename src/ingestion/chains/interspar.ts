/**
 * Interspar Chain Adapter
 *
 * Adapter for parsing Interspar retail chain price data files.
 * Interspar uses CSV format with semicolon delimiter and UTF-8 encoding.
 * Store resolution is based on filename.
 */

import type { CsvColumnMapping } from '../parsers/csv'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * Column mapping for Interspar CSV files.
 * Maps Interspar's column names to NormalizedRow fields.
 */
const INTERSPAR_COLUMN_MAPPING: CsvColumnMapping = {
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
 * Alternative column mapping for Interspar CSV files.
 * Some Interspar exports may use abbreviated or different column names.
 */
const INTERSPAR_COLUMN_MAPPING_ALT: CsvColumnMapping = {
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
 * Interspar chain adapter implementation.
 * Extends BaseCsvAdapter for common CSV parsing functionality.
 */
export class IntersparAdapter extends BaseCsvAdapter {
  constructor() {
    super({
      slug: 'interspar',
      name: 'Interspar',
      supportedTypes: ['csv'],
      chainConfig: CHAIN_CONFIGS.interspar,
      columnMapping: INTERSPAR_COLUMN_MAPPING,
      alternativeColumnMapping: INTERSPAR_COLUMN_MAPPING_ALT,
      filenamePrefixPatterns: [
        /^Interspar[_-]?/i,
        /^Spar[_-]?/i,
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
 * Create an Interspar adapter instance.
 */
export function createIntersparAdapter(): IntersparAdapter {
  return new IntersparAdapter()
}
