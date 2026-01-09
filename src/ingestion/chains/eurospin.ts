/**
 * Eurospin Chain Adapter
 *
 * Adapter for parsing Eurospin retail chain price data files.
 * Eurospin uses CSV format with semicolon delimiter and UTF-8 encoding.
 * Store resolution is based on filename.
 *
 * Supports single-date discovery via setDiscoveryDate() method.
 * Discovery fetches ZIP files from the Eurospin portal containing CSV data.
 *
 * Eurospin portal: https://www.eurospin.hr/cjenik/
 * URL format: https://www.eurospin.hr/wp-content/themes/eurospin/documenti-prezzi/cjenik_DD.MM.YYYY-7.30.zip
 */

import type { CsvColumnMapping } from '../parsers/csv'
import type { DiscoveredFile } from '../core/types'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * Column mapping for Eurospin CSV files.
 * Maps Eurospin's column names to NormalizedRow fields.
 *
 * Eurospin uses uppercase column names with underscores:
 * NAZIV_PROIZVODA, ŠIFRA_PROIZVODA, MARKA_PROIZVODA, etc.
 */
const EUROSPIN_COLUMN_MAPPING: CsvColumnMapping = {
  externalId: 'ŠIFRA_PROIZVODA',
  name: 'NAZIV_PROIZVODA',
  category: 'KATEGORIJA_PROIZVODA',
  brand: 'MARKA_PROIZVODA',
  unit: 'JEDINICA_MJERE',
  unitQuantity: 'NETO_KOLIČINA',
  price: 'MALOPROD.CIJENA(EUR)',
  discountPrice: 'MPC_POSEB.OBLIK_PROD',
  discountStart: 'POČETAK_AKCIJE',
  discountEnd: 'KRAJ_AKCIJE',
  barcodes: 'BARKOD',
  // Croatian price transparency fields
  unitPrice: 'CIJENA_ZA_JEDINICU_MJERE',
  lowestPrice30d: 'NAJNIŽA_MPC_U_30DANA',
  anchorPrice: 'SIDRENA_CIJENA',
  unitPriceBaseQuantity: 'KOLIČINA_ZA_JEDINICU_MJERE',
  unitPriceBaseUnit: 'JEDINICA_MJERE_ZA_CIJENU',
  anchorPriceAsOf: 'DATUM_SIDRENE_CIJENE',
}

/**
 * Alternative column mapping for Eurospin CSV files.
 * Some Eurospin exports may use abbreviated or different column names.
 */
const EUROSPIN_COLUMN_MAPPING_ALT: CsvColumnMapping = {
  externalId: 'SIFRA_PROIZVODA',
  name: 'NAZIV_PROIZVODA',
  category: 'KATEGORIJA',
  brand: 'MARKA',
  unit: 'JM',
  unitQuantity: 'NETO_KOLICINA',
  price: 'MALOPROD_CIJENA',
  discountPrice: 'MPC_POSEB_OBLIK_PROD',
  discountStart: 'Pocetak_akcije',
  discountEnd: 'Kraj_akcije',
  barcodes: 'BARKOD',
  // Croatian price transparency fields
  unitPrice: 'CIJENA_ZA_JEDINICU_MJERE',
  lowestPrice30d: 'NAJNIZA_MPC_U_30DANA',
  anchorPrice: 'SIDRENA_CIJENA',
  unitPriceBaseQuantity: 'KOLICINA_ZA_JM',
  unitPriceBaseUnit: 'JM_ZA_CIJENU',
  anchorPriceAsOf: 'DATUM_SIDRENE_CIJENE',
}

/**
 * Eurospin chain adapter implementation.
 * Extends BaseCsvAdapter for common CSV parsing functionality.
 *
 * Supports date-based web discovery via setDiscoveryDate() method.
 * Downloads ZIP files from the Eurospin portal.
 */
export class EurospinAdapter extends BaseCsvAdapter {
  /** Date to discover files for (YYYY-MM-DD format, set by CLI before discovery) */
  private discoveryDate: string | null = null

  constructor() {
    super({
      slug: 'eurospin',
      name: 'Eurospin',
      supportedTypes: ['csv', 'zip'],
      chainConfig: CHAIN_CONFIGS.eurospin,
      columnMapping: EUROSPIN_COLUMN_MAPPING,
      alternativeColumnMapping: EUROSPIN_COLUMN_MAPPING_ALT,
      filenamePrefixPatterns: [
        /^Eurospin[_-]?/i,
        /^cjenik[_-]?/i,
        /^diskontna[_-]?/i,
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
   * Discover available Eurospin price files from the portal.
   *
   * Eurospin's portal provides ZIP files in a dropdown with format:
   * - cjenik_DD.MM.YYYY-7.30.zip
   * URL: https://www.eurospin.hr/wp-content/themes/eurospin/documenti-prezzi/cjenik_DD.MM.YYYY-7.30.zip
   *
   * @returns Array of discovered files (filtered by date if setDiscoveryDate was called)
   */
  async discover(): Promise<DiscoveredFile[]> {
    const discoveredFiles: DiscoveredFile[] = []

    // Use provided date or default to today
    const date = this.discoveryDate || new Date().toISOString().split('T')[0]

    console.log(`[DEBUG] Fetching Eurospin portal for date: ${date}`)

    try {
      const response = await fetch(this.config.baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'hr-HR,hr;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      })

      if (!response.ok) {
        console.error(`Failed to fetch Eurospin portal: ${response.status} ${response.statusText}`)
        return []
      }

      const html = await response.text()

      // Extract download links from the dropdown: <option value="URL">filename</option>
      const optionPattern = /<option[^>]*value=["']([^"']*cjenik_[^"']*\.zip)["'][^>]*>([^<]*)<\/option>/gi
      const seenUrls = new Set<string>()

      let match: RegExpExecArray | null
      while ((match = optionPattern.exec(html)) !== null) {
        const url = match[1]
        const filename = match[2].trim()

        // Skip duplicates
        if (seenUrls.has(url)) {
          continue
        }
        seenUrls.add(url)

        // Extract date from filename (format: cjenik_DD.MM.YYYY-7.30.zip)
        const dateMatch = filename.match(/cjenik_(\d{2})\.(\d{2})\.(\d{4})/)
        let fileDate: string | undefined
        if (dateMatch) {
          const [, day, month, year] = dateMatch
          fileDate = `${year}-${month}-${day}`
        }

        // Filter by discovery date if set
        if (date && fileDate && fileDate !== date) {
          continue
        }

        // If we're filtering by date and found a match, or we're not filtering
        if (!date || (fileDate && fileDate === date)) {
          discoveredFiles.push({
            url,
            filename,
            type: 'zip',
            size: null,
            lastModified: fileDate ? new Date(fileDate) : new Date(),
            metadata: {
              source: 'eurospin_portal',
              discoveredAt: new Date().toISOString(),
              ...(fileDate && { portalDate: fileDate }),
            },
          })
        }
      }

      console.log(`[DEBUG] Found ${discoveredFiles.length} file(s) for date ${date}`)
      return discoveredFiles
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Error discovering Eurospin files: ${errorMessage}`)
      return []
    }
  }
}

/**
 * Create a Eurospin adapter instance.
 */
export function createEurospinAdapter(): EurospinAdapter {
  return new EurospinAdapter()
}
