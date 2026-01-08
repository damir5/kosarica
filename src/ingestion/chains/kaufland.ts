/**
 * Kaufland Chain Adapter
 *
 * Adapter for parsing Kaufland retail chain price data files.
 * Kaufland uses CSV format with tab delimiter and UTF-8 encoding.
 * Store resolution is based on filename.
 *
 * Kaufland portal: https://www.kaufland.hr/akcije-novosti/popis-mpc.html
 */

import type { CsvColumnMapping } from '../parsers/csv'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

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
  // Croatian price transparency fields
  unitPrice: 'Cijena za jedinicu mjere',
  lowestPrice30d: 'Najniža cijena u zadnjih 30 dana',
  anchorPrice: 'Sidrena cijena',
  unitPriceBaseQuantity: 'Količina za jedinicu mjere',
  unitPriceBaseUnit: 'Jedinica mjere za cijenu',
  anchorPriceAsOf: 'Datum sidrene cijene',
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
  // Croatian price transparency fields
  unitPrice: 'Cijena za JM',
  lowestPrice30d: 'Najniza cijena 30 dana',
  anchorPrice: 'Sidrena cijena',
  unitPriceBaseQuantity: 'Kolicina za JM',
  unitPriceBaseUnit: 'JM za cijenu',
  anchorPriceAsOf: 'Datum sidrene cijene',
}

/**
 * Kaufland chain adapter implementation.
 * Extends BaseCsvAdapter for common CSV parsing functionality.
 */
export class KauflandAdapter extends BaseCsvAdapter {
  constructor() {
    super({
      slug: 'kaufland',
      name: 'Kaufland',
      supportedTypes: ['csv'],
      chainConfig: CHAIN_CONFIGS.kaufland,
      columnMapping: KAUFLAND_COLUMN_MAPPING,
      alternativeColumnMapping: KAUFLAND_COLUMN_MAPPING_ALT,
      filenamePrefixPatterns: [
        /^Kaufland[_-]?/i,
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
 * Create a Kaufland adapter instance.
 */
export function createKauflandAdapter(): KauflandAdapter {
  return new KauflandAdapter()
}
