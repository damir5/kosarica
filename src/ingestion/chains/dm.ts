/**
 * DM Chain Adapter
 *
 * Adapter for parsing DM retail chain price data files.
 * DM uses XLSX format and has national (uniform) pricing across all stores.
 */

import type {
  DiscoveredFile,
  ParseOptions,
  ParseResult,
  StoreIdentifier,
} from '../core/types'
import { XlsxParser, type XlsxColumnMapping } from '../parsers/xlsx'
import { BaseChainAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

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
 * Extends BaseChainAdapter with XLSX-specific parsing logic.
 * DM is unique in using XLSX format with national pricing.
 */
export class DmAdapter extends BaseChainAdapter {
  private xlsxParser: XlsxParser

  constructor() {
    super({
      slug: 'dm',
      name: 'DM',
      supportedTypes: ['xlsx'],
      chainConfig: CHAIN_CONFIGS.dm,
      filenamePrefixPatterns: [
        /^DM[_-]?/i,
        /^dm[_-]?/i,
        /^cjenik[_-]?/i,
      ],
      fileExtensionPattern: /\.(xlsx|xls|XLSX|XLS)$/,
      rateLimitConfig: {
        requestsPerSecond: 2,
        maxRetries: 3,
      },
    })

    this.xlsxParser = new XlsxParser({
      columnMapping: DM_COLUMN_MAPPING,
      hasHeader: true,
      skipEmptyRows: true,
      defaultStoreIdentifier: DM_NATIONAL_STORE_IDENTIFIER,
    })
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
}

/**
 * Create a DM adapter instance.
 */
export function createDmAdapter(): DmAdapter {
  return new DmAdapter()
}
