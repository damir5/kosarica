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
  unitPriceBaseQuantity: 'Količina za jedinicu mjere',
  unitPriceBaseUnit: 'Jedinica mjere za cijenu',
  anchorPriceAsOf: 'Datum sidrene cijene',
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
  // Croatian price transparency fields
  unitPrice: 'Cijena za jedinicu mjere',
  lowestPrice30d: 'Najniza cijena u zadnjih 30 dana',
  anchorPrice: 'Sidrena cijena',
  unitPriceBaseQuantity: 'Kolicina za JM',
  unitPriceBaseUnit: 'JM za cijenu',
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
   * Interspar's portal uses a date query parameter and pagination:
   * - URL format: /cjenik?date=YYYY-MM-DD&page=N
   * - Download links: /cjenik/download?file=FILENAME
   *
   * Fetches all pages until no more download links are found.
   *
   * @returns Array of discovered files for the specified date
   */
  async discover(): Promise<DiscoveredFile[]> {
    const discoveredFiles: DiscoveredFile[] = []
    const seenUrls = new Set<string>()

    // Use provided date or default to today
    const date = this.discoveryDate || new Date().toISOString().split('T')[0]

    let page = 1
    const maxPages = 50 // Safety limit to prevent infinite loops

    while (page <= maxPages) {
      const pageUrl = `${this.config.baseUrl}?date=${date}&page=${page}`
      console.log(`[DEBUG] Fetching Interspar page ${page}: ${pageUrl}`)

      try {
        const response = await fetch(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PriceTracker/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        })

        if (!response.ok) {
          console.error(`Failed to fetch Interspar portal page ${page}: ${response.status} ${response.statusText}`)
          console.error(`  URL: ${pageUrl}`)
          break
        }

        const html = await response.text()

        // Extract download links: href="/cjenik/download?file=..."
        const downloadPattern = /href=["'](\/cjenik\/download\?file=([^"'&]+)[^"']*)["']/gi

        let foundNewFiles = false
        let match: RegExpExecArray | null
        while ((match = downloadPattern.exec(html)) !== null) {
          const href = match[1]
          const encodedFilename = match[2]

          // Build full download URL
          const fileUrl = new URL(href, this.config.baseUrl).toString()

          // Skip duplicates (same URL might appear in pagination)
          if (seenUrls.has(fileUrl)) {
            continue
          }
          seenUrls.add(fileUrl)

          // Decode the filename from URL encoding
          const filename = decodeURIComponent(encodedFilename)

          discoveredFiles.push({
            url: fileUrl,
            filename: filename.endsWith('.CSV') || filename.endsWith('.csv') ? filename : `${filename}.csv`,
            type: 'csv',
            size: null,
            lastModified: new Date(date),
            metadata: {
              source: 'interspar_portal',
              discoveredAt: new Date().toISOString(),
              portalDate: date,
              page: String(page),
            },
          })

          foundNewFiles = true
        }

        // Stop if no new files found on this page (end of pagination)
        if (!foundNewFiles) {
          break
        }

        page++
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`Error discovering Interspar files on page ${page}: ${errorMessage}`)
        console.error(`  URL: ${pageUrl}`)
        break
      }
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
