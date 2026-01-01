/**
 * KTC Chain Adapter
 *
 * Adapter for parsing KTC retail chain price data files.
 * KTC uses CSV format with semicolon delimiter and Windows-1250 encoding.
 * Store resolution is based on filename.
 */

import type { CsvColumnMapping } from '../parsers/csv'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * Column mapping for KTC CSV files.
 * Maps KTC's column names to NormalizedRow fields.
 */
const KTC_COLUMN_MAPPING: CsvColumnMapping = {
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
 * Alternative column mapping for KTC CSV files.
 * Some KTC exports may use abbreviated or different column names without diacritics.
 */
const KTC_COLUMN_MAPPING_ALT: CsvColumnMapping = {
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
 * KTC chain adapter implementation.
 * Extends BaseCsvAdapter for common CSV parsing functionality.
 */
export class KtcAdapter extends BaseCsvAdapter {
  constructor() {
    super({
      slug: 'ktc',
      name: 'KTC',
      supportedTypes: ['csv'],
      chainConfig: CHAIN_CONFIGS.ktc,
      columnMapping: KTC_COLUMN_MAPPING,
      alternativeColumnMapping: KTC_COLUMN_MAPPING_ALT,
      filenamePrefixPatterns: [
        /^KTC[_-]?/i,
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
 * Create a KTC adapter instance.
 */
export function createKtcAdapter(): KtcAdapter {
  return new KtcAdapter()
}
