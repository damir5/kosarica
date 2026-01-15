/**
 * Kaufland Chain Adapter
 *
 * Adapter for parsing Kaufland retail chain price data files.
 * Kaufland uses CSV format with tab delimiter and UTF-8 encoding.
 * Store resolution is based on filename.
 *
 * Kaufland portal: https://www.kaufland.hr/akcije-novosti/popis-mpc.html
 * API endpoint: /akcije-novosti/popis-mpc.assetSearch.id=assetList_1599847924.json
 * Filename format: {StoreType}_{Address}_{City}_{StoreId}_{DDMMYYYY}_{Version}.csv
 */

import type { CsvColumnMapping } from '../parsers/csv'
import type { DiscoveredFile, StoreMetadata } from '../core/types'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * Column mapping for Kaufland CSV files.
 * Maps Kaufland's column names to NormalizedRow fields.
 *
 * Current headers (as of 2026-01):
 * naziv proizvoda, šifra proizvoda, marka proizvoda, neto količina(KG),
 * jedinica mjere, maloprod.cijena(EUR), akc.cijena, A=akcija, kol.jed.mj.,
 * jed.mj. (1 KOM/L/KG), cijena jed.mj.(EUR), MPC poseb.oblik prod,
 * Najniža MPC u 30dana, Sidrena cijena, barkod, kategorija proizvoda
 */
const KAUFLAND_COLUMN_MAPPING: CsvColumnMapping = {
  externalId: 'šifra proizvoda',
  name: 'naziv proizvoda',
  category: 'kategorija proizvoda',
  brand: 'marka proizvoda',
  unit: 'jedinica mjere',
  unitQuantity: 'neto količina(KG)',
  price: 'maloprod.cijena(EUR)',
  discountPrice: 'akc.cijena, A=akcija',
  barcodes: 'barkod',
  // Croatian price transparency fields
  unitPrice: 'cijena jed.mj.(EUR)',
  lowestPrice30d: 'Najniža MPC u 30dana',
  anchorPrice: 'Sidrena cijena',
  unitPriceBaseQuantity: 'kol.jed.mj.',
  unitPriceBaseUnit: 'jed.mj. (1 KOM/L/KG)',
}

/**
 * Alternative column mapping for Kaufland CSV files.
 * Fallback for older format with different column names.
 */
const KAUFLAND_COLUMN_MAPPING_ALT: CsvColumnMapping = {
  externalId: 'Šifra',
  name: 'Naziv',
  category: 'Kategorija',
  brand: 'Marka',
  unit: 'Mjerna jedinica',
  unitQuantity: 'Količina',
  price: 'Cijena',
  discountPrice: 'Akcijska cijena',
  barcodes: 'Barkod',
  // Croatian price transparency fields
  unitPrice: 'Cijena za jedinicu mjere',
  lowestPrice30d: 'Najniža cijena u zadnjih 30 dana',
  anchorPrice: 'Sidrena cijena',
  unitPriceBaseQuantity: 'Količina za jedinicu mjere',
  unitPriceBaseUnit: 'Jedinica mjere za cijenu',
}

/**
 * Kaufland chain adapter implementation.
 * Extends BaseCsvAdapter for common CSV parsing functionality.
 *
 * Supports single-date discovery via setDiscoveryDate() method.
 */
export class KauflandAdapter extends BaseCsvAdapter {
  /** Date to discover files for (YYYY-MM-DD format, set by CLI before discovery) */
  private discoveryDate: string | null = null

  /** API endpoint for asset list */
  private static readonly ASSET_API_URL = 'https://www.kaufland.hr/akcije-novosti/popis-mpc.assetSearch.id=assetList_1599847924.json'

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
        /^Hipermarket[_-]?/i,
        /^Supermarket[_-]?/i,
      ],
      rateLimitConfig: {
        requestsPerSecond: 2,
        maxRetries: 3,
      },
    })
  }

  /**
   * Set the date to use for discovery.
   * @param date - Date in YYYY-MM-DD format
   */
  setDiscoveryDate(date: string): void {
    this.discoveryDate = date
  }

  /**
   * Discover available price files from Kaufland portal.
   *
   * Kaufland uses a JSON API to serve file listings:
   * - API endpoint: /akcije-novosti/popis-mpc.assetSearch.id=assetList_1599847924.json
   * - Each entry has: label (filename), path (relative URL)
   * - Filename format: {StoreType}_{Address}_{City}_{StoreId}_{DDMMYYYY}_{Version}.csv
   *
   * @returns Array of discovered files for the specified date
   */
  async discover(): Promise<DiscoveredFile[]> {
    const discoveredFiles: DiscoveredFile[] = []

    // Use provided date or default to today
    const date = this.discoveryDate || new Date().toISOString().split('T')[0]

    // Convert YYYY-MM-DD to DDMMYYYY format used in Kaufland filenames
    const [year, month, day] = date.split('-')
    const targetDatePattern = `${day}${month}${year}`

    console.log(`[DEBUG] Fetching Kaufland asset API: ${KauflandAdapter.ASSET_API_URL}`)
    console.log(`[DEBUG] Looking for date pattern: ${targetDatePattern}`)

    try {
      const response = await fetch(KauflandAdapter.ASSET_API_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PriceTracker/1.0)',
          'Accept': 'application/json',
        },
      })

      if (!response.ok) {
        console.error(`Failed to fetch Kaufland asset API: ${response.status} ${response.statusText}`)
        return []
      }

      const assets = await response.json() as Array<{ label: string; path: string; filters: unknown }>

      for (const asset of assets) {
        const filename = asset.label
        const path = asset.path

        // Extract date from filename (format: ..._{DDMMYYYY}_...)
        const dateMatch = filename.match(/_(\d{8})_/)
        if (!dateMatch) {
          continue
        }

        const fileDate = dateMatch[1]

        // Filter by target date
        if (fileDate !== targetDatePattern) {
          continue
        }

        // Build full download URL
        const fileUrl = `https://www.kaufland.hr${path}`

        discoveredFiles.push({
          url: fileUrl,
          filename,
          type: 'csv',
          size: null,
          lastModified: new Date(date),
          metadata: {
            source: 'kaufland_api',
            discoveredAt: new Date().toISOString(),
            portalDate: date,
            fileDatePattern: fileDate,
          },
        })
      }

      if (discoveredFiles.length === 0) {
        console.log(`[DEBUG] No CSV files found for date ${date} (pattern: ${targetDatePattern})`)
      } else {
        console.log(`[DEBUG] Found ${discoveredFiles.length} CSV file(s) for date ${date}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Error discovering Kaufland files: ${errorMessage}`)
    }

    return discoveredFiles
  }

  /**
   * Extract store identifier from Kaufland filename.
   *
   * Kaufland filenames follow the pattern:
   * {StoreType}_{Address}_{City}_{StoreId}_{DDMMYYYY}_{Version}.csv
   *
   * Store ID is a 4-digit code (e.g., 3330).
   *
   * @param filename - The CSV filename
   * @returns Store identifier string (4-digit code)
   */
  protected override extractStoreIdentifierFromFilename(filename: string): string {
    // Match 4-digit store code before date pattern
    // Pattern: _{NNNN}_{DDMMYYYY}
    const match = filename.match(/_(\d{4})_\d{8}_/)
    if (match) {
      return match[1]
    }

    // Fallback: try to find any 4-digit sequence
    const fallbackMatch = filename.match(/_(\d{4})_/)
    if (fallbackMatch) {
      return fallbackMatch[1]
    }

    // Last resort: use base class method
    return super.extractStoreIdentifierFromFilename(filename)
  }

  /**
   * Extract store metadata from Kaufland filename.
   *
   * Kaufland filenames follow the pattern:
   * {StoreType}_{Address...}_{PostalCode}_{City}_{StoreId}_{DATE}_{Ver}.csv
   *
   * Example: Hipermarket_Kralja_Petra_Krešimira_IV_11_10000_Zagreb_3330_01012026_1.csv
   *
   * @param file - The discovered file
   * @returns Store metadata including name, address, city, postal code
   */
  extractStoreMetadata(file: DiscoveredFile): StoreMetadata | null {
    const parts = file.filename.replace(/\.csv$/i, '').split('_')
    if (parts.length < 6) return super.extractStoreMetadata(file)

    const storeType = parts[0] // Hipermarket

    // Find postal code (5-digit pattern) working backwards
    let postalIdx = -1
    for (let i = parts.length - 4; i > 0; i--) {
      if (/^\d{5}$/.test(parts[i])) {
        postalIdx = i
        break
      }
    }

    if (postalIdx === -1) return super.extractStoreMetadata(file)

    const address = parts.slice(1, postalIdx).join(' ')
    const postalCode = parts[postalIdx]
    const city = parts[postalIdx + 1]

    return {
      name: `${storeType} ${this.titleCase(city)}`,
      address: this.titleCase(address),
      city: this.titleCase(city),
      postalCode,
      storeType,
    }
  }

  /**
   * Convert a string to title case.
   * @param str - The string to convert
   * @returns Title-cased string
   */
  private titleCase(str: string): string {
    return str.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  }
}

/**
 * Create a Kaufland adapter instance.
 */
export function createKauflandAdapter(): KauflandAdapter {
  return new KauflandAdapter()
}
