/**
 * Interspar Chain Adapter
 *
 * Adapter for parsing Interspar retail chain price data files.
 * Interspar uses CSV format with semicolon delimiter and UTF-8 encoding.
 * Store resolution is based on filename.
 *
 * Interspar portal: https://www.spar.hr/usluge/cjenici
 * URL format: https://www.spar.hr/usluge/cjenici?date=YYYY-MM-DD
 * Download links: /cjenik/download?file=FILENAME
 */

import type { DiscoveredFile } from '../core/types'
import type { CsvColumnMapping } from '../parsers/csv'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * Interspar JSON API response structure.
 * The API endpoint returns a list of available price files.
 */
interface IntersparJsonResponse {
  files: Array<{
    name: string
    URL: string
    SHA: string
  }>
}

/**
 * Column mapping for Interspar CSV files.
 * Maps Interspar's column names to NormalizedRow fields.
 *
 * Based on actual Interspar CSV format:
 * naziv;šifra;marka;neto količina;jedinica mjere;MPC (EUR);cijena za jedinicu mjere (EUR);
 * MPC za vrijeme posebnog oblika prodaje (EUR);Najniža cijena u posljednjih 30 dana (EUR);
 * sidrena cijena na DATE. (EUR);barkod;kategorija proizvoda
 */
const INTERSPAR_COLUMN_MAPPING: CsvColumnMapping = {
  externalId: 'šifra',
  name: 'naziv',
  category: 'kategorija proizvoda',
  brand: 'marka',
  unit: 'jedinica mjere',
  unitQuantity: 'neto količina',
  price: 'MPC (EUR)',
  discountPrice: 'MPC za vrijeme posebnog oblika prodaje (EUR)',
  barcodes: 'barkod',
  // Croatian price transparency fields
  unitPrice: 'cijena za jedinicu mjere (EUR)',
  lowestPrice30d: 'Najniža cijena u posljednjih 30 dana (EUR)',
  anchorPrice: 'sidrena cijena na 2.5.2025. (EUR)',
}

/**
 * Alternative column mapping for Interspar CSV files.
 * Some Interspar exports may use abbreviated or different column names.
 */
const INTERSPAR_COLUMN_MAPPING_ALT: CsvColumnMapping = {
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
 * Interspar chain adapter implementation.
 * Extends BaseCsvAdapter for common CSV parsing functionality.
 *
 * Supports single-date discovery via setDiscoveryDate() method.
 */
export class IntersparAdapter extends BaseCsvAdapter {
  /** Date to discover files for (YYYY-MM-DD format, set by CLI before discovery) */
  private discoveryDate: string | null = null

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

  /**
   * Set the date to use for discovery.
   * @param date - Date in YYYY-MM-DD format
   */
  setDiscoveryDate(date: string): void {
    this.discoveryDate = date
  }

  /**
   * Discover available price files from Interspar portal.
   *
   * Interspar provides a JSON API endpoint that returns all available files:
   * - API URL: /datoteke_cjenici/Cjenik{YYYYMMDD}.json
   * - Returns: { "files": [{ "name": "...", "URL": "...", "SHA": "..." }] }
   *
   * This is much more efficient than scraping the HTML page.
   *
   * @returns Array of discovered files for the specified date
   */
  async discover(): Promise<DiscoveredFile[]> {
    const discoveredFiles: DiscoveredFile[] = []

    // Use provided date or default to today
    const date = this.discoveryDate || new Date().toISOString().split('T')[0]

    // Convert date from YYYY-MM-DD to YYYYMMDD format for the API
    const dateForApi = date.replace(/-/g, '')

    // Construct the JSON API URL
    const apiUrl = `https://www.spar.hr/datoteke_cjenici/Cjenik${dateForApi}.json`
    console.log(`[DEBUG] Fetching Interspar JSON API: ${apiUrl}`)

    try {
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PriceTracker/1.0)',
          'Accept': 'application/json',
        },
      })

      if (!response.ok) {
        console.error(`Failed to fetch Interspar JSON API: ${response.status} ${response.statusText}`)
        console.error(`  URL: ${apiUrl}`)
        return []
      }

      const data = await response.json() as IntersparJsonResponse

      if (!data.files || data.files.length === 0) {
        console.log(`[INFO] No files found in JSON response for date ${date}`)
        return []
      }

      console.log(`[DEBUG] Found ${data.files.length} file(s) in JSON response`)

      for (const file of data.files) {
        discoveredFiles.push({
          url: file.URL,
          filename: file.name,
          type: 'csv',
          size: null,
          lastModified: new Date(date),
          metadata: {
            source: 'interspar_json_api',
            discoveredAt: new Date().toISOString(),
            portalDate: date,
            sha: file.SHA,
          },
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Error discovering Interspar files: ${errorMessage}`)
      console.error(`  URL: ${apiUrl}`)
    }

    return discoveredFiles
  }

  /**
   * Extract store identifier from Interspar filename.
   *
   * Interspar filenames may follow patterns like:
   * - INTERSPAR_STORE_ID_DATE.csv
   * - Cjenik_Interspar_LOCATION_DATE.csv
   *
   * @param filename - The CSV filename
   * @returns Store identifier string
   */
  protected override extractStoreIdentifierFromFilename(filename: string): string {
    // Remove file extension
    const baseName = filename.replace(/\.(csv|CSV)$/, '')

    // Try to extract store ID from various Interspar filename patterns
    // Pattern 1: Contains a 4-digit store code
    const storeCodeMatch = baseName.match(/[_-](\d{4})[_-]/)
    if (storeCodeMatch) {
      return storeCodeMatch[1]
    }

    // Pattern 2: Store location name after Interspar prefix
    const locationMatch = baseName.match(/^(?:Interspar|Spar)[_-]?(.+?)(?:[_-]\d{4}[_-]\d{2}[_-]\d{2})?$/i)
    if (locationMatch) {
      return locationMatch[1]
    }

    // Fall back to base class implementation
    return super.extractStoreIdentifierFromFilename(filename)
  }
}

/**
 * Create an Interspar adapter instance.
 */
export function createIntersparAdapter(): IntersparAdapter {
  return new IntersparAdapter()
}
