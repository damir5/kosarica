/**
 * Metro Chain Adapter
 *
 * Adapter for parsing Metro retail chain price data files.
 * Metro uses CSV format with semicolon delimiter.
 * Store resolution is based on portal ID within the content.
 *
 * Metro portal: https://metrocjenik.com.hr/
 */

import type { CsvColumnMapping } from '../parsers/csv'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * Column mapping for Metro CSV files.
 * Maps Metro's column names to NormalizedRow fields.
 */
const METRO_COLUMN_MAPPING: CsvColumnMapping = {
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
  unitPriceBaseQuantity: 'Količina za jedinicu mjere',
  unitPriceBaseUnit: 'Jedinica mjere za cijenu',
  anchorPriceAsOf: 'Datum sidrene cijene',
}

/**
 * Alternative column mapping for Metro CSV files.
 * Some Metro exports may use abbreviated or different column names.
 */
const METRO_COLUMN_MAPPING_ALT: CsvColumnMapping = {
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
  // Croatian price transparency fields
  unitPrice: 'Cijena za jedinicu mjere',
  lowestPrice30d: 'Najniza cijena u zadnjih 30 dana',
  anchorPrice: 'Sidrena cijena',
  unitPriceBaseQuantity: 'Kolicina za JM',
  unitPriceBaseUnit: 'JM za cijenu',
  anchorPriceAsOf: 'Datum sidrene cijene',
}

/**
 * Metro chain adapter implementation.
 * Extends BaseCsvAdapter for common CSV parsing functionality.
 */
export class MetroAdapter extends BaseCsvAdapter {
  constructor() {
    super({
      slug: 'metro',
      name: 'Metro',
      supportedTypes: ['csv'],
      chainConfig: CHAIN_CONFIGS.metro,
      columnMapping: METRO_COLUMN_MAPPING,
      alternativeColumnMapping: METRO_COLUMN_MAPPING_ALT,
      filenamePrefixPatterns: [
        /^Metro[_-]?/i,
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
 * Create a Metro adapter instance.
 */
export function createMetroAdapter(): MetroAdapter {
  return new MetroAdapter()
}
