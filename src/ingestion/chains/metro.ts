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
import type { StoreMetadata } from '../core/types'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * Column mapping for Metro CSV files.
 * Maps Metro's column names to NormalizedRow fields.
 *
 * Current Metro format (as of 2026-01):
 * NAZIV,SIFRA,MARKA,NETO_KOLICINA,JED_MJERE,MPC,CIJENA_PO_MJERI,POSEBNA_PRODAJA,NAJNIZA_30_DANA,SIDRENA_XX_XX,BARKOD,KATEGORIJA
 *
 * Note: SIDRENA column has a date suffix (e.g., SIDRENA_02_05) that changes.
 * We use a regex pattern to match it dynamically in preprocessing.
 */
const METRO_COLUMN_MAPPING: CsvColumnMapping = {
  externalId: 'SIFRA',
  name: 'NAZIV',
  category: 'KATEGORIJA',
  brand: 'MARKA',
  unit: 'JED_MJERE',
  unitQuantity: 'NETO_KOLICINA',
  price: 'MPC',
  discountPrice: 'POSEBNA_PRODAJA',
  barcodes: 'BARKOD',
  // Croatian price transparency fields
  unitPrice: 'CIJENA_PO_MJERI',
  lowestPrice30d: 'NAJNIZA_30_DANA',
  anchorPrice: 'SIDRENA', // Will be matched with prefix in preprocessing
}

/**
 * Legacy column mapping for older Metro CSV files.
 * Some older exports may use different column names.
 */
const METRO_COLUMN_MAPPING_ALT: CsvColumnMapping = {
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
  unitPrice: 'Cijena za jedinicu mjere',
  lowestPrice30d: 'Najniža cijena u zadnjih 30 dana',
  anchorPrice: 'Sidrena cijena',
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

  /**
   * Preprocess Metro CSV content to normalize column headers.
   * The SIDRENA column has a date suffix (e.g., SIDRENA_02_05) that changes.
   * We normalize it to just SIDRENA for consistent mapping.
   */
  protected override preprocessContent(content: ArrayBuffer): ArrayBuffer {
    const decoder = new TextDecoder('utf-8')
    let text = decoder.decode(content)

    // Normalize SIDRENA_XX_XX to SIDRENA (date suffix varies)
    text = text.replace(/SIDRENA_\d{2}_\d{2}/g, 'SIDRENA')

    const encoder = new TextEncoder()
    return encoder.encode(text).buffer as ArrayBuffer
  }

  /**
   * Extract date from Metro filename.
   * Metro filenames have pattern: ..._METRO_YYYYMMDDTHHM_...
   * Example: cash_and_carry_prodavaonica_METRO_20251127T0633_S23_...csv
   */
  private extractDateFromFilename(filename: string): Date | null {
    // Match YYYYMMDD pattern after METRO_
    const match = filename.match(/METRO_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/i)
    if (!match) return null

    const [, year, month, day, hour, minute] = match
    return new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10),
    )
  }

  /**
   * Override discover to extract dates from Metro filenames.
   * Metro portal lists files with embedded timestamps in filenames.
   */
  override async discover(): Promise<import('../core/types').DiscoveredFile[]> {
    const files = await super.discover()

    // Enrich files with lastModified extracted from filename
    return files.map(file => {
      const date = this.extractDateFromFilename(file.filename)
      return {
        ...file,
        lastModified: date,
      }
    })
  }

  /**
   * Extract store identifier from Metro filename.
   * Metro filenames have store codes like S10, S11, S14, etc.
   * Example: cash_and_carry_prodavaonica_METRO_20260105T0630_S10_JANKOMIR_31,ZAGREB.csv
   */
  override extractStoreIdentifier(file: import('../core/types').DiscoveredFile): import('../core/types').StoreIdentifier | null {
    const storeCode = this.extractStoreCodeFromFilename(file.filename)
    if (!storeCode) return null

    return {
      type: 'portal_id',
      value: storeCode,
    }
  }

  /**
   * Extract store code (S10, S11, etc.) from filename.
   */
  private extractStoreCodeFromFilename(filename: string): string | null {
    const match = filename.match(/_S(\d+)_/i)
    return match ? `S${match[1]}` : null
  }

  /**
   * Override to use correct store identifier for parsed rows.
   */
  protected override getParserOptions(storeIdentifier: string): import('../parsers/csv').CsvParserOptions {
    // The storeIdentifier passed here is from extractStoreIdentifierFromFilename (base class)
    // which gives the full filename. We need to extract just the store code.
    const storeCode = this.extractStoreCodeFromFilename(storeIdentifier) || storeIdentifier
    return {
      defaultStoreIdentifier: storeCode,
    }
  }

  /**
   * Extract store metadata from Metro filename.
   * Metro filenames have pattern: ..._METRO_YYYYMMDDTHHM_S{code}_{LOCATION},{CITY}.csv
   * Example: cash_and_carry_prodavaonica_METRO_20260105T0630_S10_JANKOMIR_31,ZAGREB.csv
   */
  override extractStoreMetadata(file: import('../core/types').DiscoveredFile): StoreMetadata | null {
    // Extract everything after S{code}_
    const match = file.filename.match(/_S(\d+)_(.+)\.csv$/i)
    if (!match) return super.extractStoreMetadata(file)

    // match[1] contains store code (e.g., "10"), but we use location/city for naming
    const locationPart = match[2] // "JANKOMIR_31,ZAGREB"

    // Split by comma to separate location and city
    const commaIdx = locationPart.lastIndexOf(',')
    if (commaIdx === -1) {
      return {
        name: `Metro ${this.titleCase(locationPart.replace(/_/g, ' '))}`,
        address: this.titleCase(locationPart.replace(/_/g, ' ')),
      }
    }

    const address = locationPart.substring(0, commaIdx).replace(/_/g, ' ')
    const city = locationPart.substring(commaIdx + 1)

    return {
      name: `Metro ${this.titleCase(city)}`,
      address: this.titleCase(address),
      city: this.titleCase(city),
    }
  }

  /**
   * Convert string to title case.
   * @param str Input string to convert
   * @returns Title cased string (e.g., "hello world" -> "Hello World")
   */
  private titleCase(str: string): string {
    return str.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  }
}

/**
 * Create a Metro adapter instance.
 */
export function createMetroAdapter(): MetroAdapter {
  return new MetroAdapter()
}
