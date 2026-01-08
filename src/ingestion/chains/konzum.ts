/**
 * Konzum Chain Adapter
 *
 * Adapter for parsing Konzum retail chain price data files.
 * Konzum uses CSV format with comma delimiter and UTF-8 encoding.
 * Store resolution is based on filename (4-digit store ID in filename).
 *
 * Konzum portal: https://www.konzum.hr/cjenici
 * URL format: https://www.konzum.hr/cjenici?date=YYYY-MM-DD
 * Download links: /cjenici/download?title=FILENAME
 * Filename format: SUPERMARKET,ADDRESS,POSTAL CITY,STORE_ID,DATE,TIME.CSV
 */

import type { CsvColumnMapping } from '../parsers/csv'
import type { DiscoveredFile } from '../core/types'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * Column mapping for Konzum CSV files.
 * Maps Konzum's column names to NormalizedRow fields.
 *
 * Croatian price transparency columns (2026 format):
 * - CIJENA ZA JEDINICU MJERE - unit price
 * - NAJNIŽA CIJENA U ZADNJIH 30 DANA - lowest price in 30 days
 * - SIDRENA CIJENA - anchor price
 */
const KONZUM_COLUMN_MAPPING: CsvColumnMapping = {
  externalId: 'ŠIFRA PROIZVODA',
  name: 'NAZIV PROIZVODA',
  category: 'KATEGORIJA PROIZVODA',
  brand: 'MARKA PROIZVODA',
  unit: 'JEDINICA MJERE',
  unitQuantity: 'NETO KOLIČINA',
  price: 'MALOPRODAJNA CIJENA',
  discountPrice: 'MPC ZA VRIJEME POSEBNOG OBLIKA PRODAJE',
  barcodes: 'BARKOD',
  // Croatian price transparency fields
  unitPrice: 'CIJENA ZA JEDINICU MJERE',
  lowestPrice30d: 'NAJNIŽA CIJENA U ZADNJIH 30 DANA',
  anchorPrice: 'SIDRENA CIJENA',
}

/**
 * Alternative column mapping for Konzum CSV files (English headers).
 * Some Konzum exports may use English column names.
 */
const KONZUM_COLUMN_MAPPING_EN: CsvColumnMapping = {
  externalId: 'Code',
  name: 'Name',
  category: 'Category',
  brand: 'Brand',
  unit: 'Unit',
  unitQuantity: 'Quantity',
  price: 'Price',
  discountPrice: 'Discount Price',
  discountStart: 'Discount Start',
  discountEnd: 'Discount End',
  barcodes: 'Barcode',
}

/**
 * Konzum chain adapter implementation.
 * Extends BaseCsvAdapter for common CSV parsing functionality.
 *
 * Supports single-date discovery via setDiscoveryDate() method.
 */
export class KonzumAdapter extends BaseCsvAdapter {
  /** Date to discover files for (YYYY-MM-DD format, set by CLI before discovery) */
  private discoveryDate: string | null = null

  constructor() {
    super({
      slug: 'konzum',
      name: 'Konzum',
      supportedTypes: ['csv'],
      chainConfig: CHAIN_CONFIGS.konzum,
      columnMapping: KONZUM_COLUMN_MAPPING,
      alternativeColumnMapping: KONZUM_COLUMN_MAPPING_EN,
      filenamePrefixPatterns: [
        /^Konzum[_-]?/i,
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
   * Discover available price files from Konzum portal.
   *
   * Konzum's portal uses a date query parameter and pagination:
   * - URL format: /cjenici?date=YYYY-MM-DD&page=N
   * - Download links: /cjenici/download?title=FILENAME
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
      console.log(`[DEBUG] Fetching Konzum page ${page}: ${pageUrl}`)

      try {
        const response = await fetch(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PriceTracker/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        })

        if (!response.ok) {
          console.error(`Failed to fetch Konzum portal page ${page}: ${response.status} ${response.statusText}`)
          console.error(`  URL: ${pageUrl}`)
          break
        }

        const html = await response.text()

        // Extract download links: href="/cjenici/download?title=..."
        const downloadPattern = /href=["'](\/cjenici\/download\?title=([^"'&]+)[^"']*)["']/gi

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
              source: 'konzum_portal',
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
        console.error(`Error discovering Konzum files on page ${page}: ${errorMessage}`)
        console.error(`  URL: ${pageUrl}`)
        break
      }
    }

    return discoveredFiles
  }

  /**
   * Extract store identifier from Konzum filename.
   *
   * Konzum filenames follow the pattern:
   * SUPERMARKET,ADDRESS,POSTAL CITY,STORE_ID,DATE,TIME.CSV
   *
   * Store ID is a 4-digit code (e.g., 0204).
   *
   * @param filename - The CSV filename
   * @returns Store identifier string (4-digit code) or null
   */
  protected override extractStoreIdentifierFromFilename(filename: string): string {
    // Match 4-digit store code pattern in comma-separated filename
    // Pattern looks for: ,NNNN, where N is a digit
    const match = filename.match(/,(\d{4}),/)
    if (match) {
      return match[1]
    }

    // Fallback: try to find any 4-digit sequence
    const fallbackMatch = filename.match(/\b(\d{4})\b/)
    if (fallbackMatch) {
      return fallbackMatch[1]
    }

    // Last resort: use base class method
    return super.extractStoreIdentifierFromFilename(filename)
  }
}

/**
 * Create a Konzum adapter instance.
 */
export function createKonzumAdapter(): KonzumAdapter {
  return new KonzumAdapter()
}
