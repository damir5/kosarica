/**
 * Plodine Chain Adapter
 *
 * Adapter for parsing Plodine retail chain price data files.
 * Plodine uses CSV format with semicolon delimiter and Windows-1250 encoding.
 * Store resolution is based on filename.
 *
 * Special handling: Plodine files may contain prices with missing leading zero
 * (e.g., ",69" instead of "0,69"), which this adapter handles via preprocessing.
 *
 * Plodine portal: https://www.plodine.hr/info-o-cijenama
 * URL format: https://www.plodine.hr/info-o-cijenama?date=YYYY-MM-DD
 * Download links: /cjenik/download?file=FILENAME
 */

import type { DiscoveredFile } from '../core/types'
import type { CsvColumnMapping, CsvParserOptions } from '../parsers/csv'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * Column mapping for Plodine CSV files.
 * Maps Plodine's column names to NormalizedRow fields.
 */
const PLODINE_COLUMN_MAPPING: CsvColumnMapping = {
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
 * Alternative column mapping for Plodine CSV files.
 * Some Plodine exports may use abbreviated or different column names.
 */
const PLODINE_COLUMN_MAPPING_ALT: CsvColumnMapping = {
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
 * Plodine chain adapter implementation.
 * Extends BaseCsvAdapter with custom preprocessing for price formatting issues.
 *
 * Supports single-date discovery via setDiscoveryDate() method.
 */
export class PlodineAdapter extends BaseCsvAdapter {
  /** Date to discover files for (YYYY-MM-DD format, set by CLI before discovery) */
  private discoveryDate: string | null = null

  constructor() {
    super({
      slug: 'plodine',
      name: 'Plodine',
      supportedTypes: ['csv'],
      chainConfig: CHAIN_CONFIGS.plodine,
      columnMapping: PLODINE_COLUMN_MAPPING,
      alternativeColumnMapping: PLODINE_COLUMN_MAPPING_ALT,
      filenamePrefixPatterns: [
        /^Plodine[_-]?/i,
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
   * Discover available price files from Plodine portal.
   *
   * Plodine's portal uses a date query parameter and pagination:
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
      console.log(`[DEBUG] Fetching Plodine page ${page}: ${pageUrl}`)

      try {
        const response = await fetch(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PriceTracker/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        })

        if (!response.ok) {
          console.error(`Failed to fetch Plodine portal page ${page}: ${response.status} ${response.statusText}`)
          console.error(`  URL: ${pageUrl}`)
          break
        }

        const html = await response.text()

        // Extract download links: href="/cjenik/download?file=..."
        // Pattern matches both /cjenik/download?file= and ?file= formats
        const downloadPattern = /href=["']((?:\/cjenik)?\/download\?file=([^"'&]+)[^"']*)["']/gi

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
              source: 'plodine_portal',
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
        console.error(`Error discovering Plodine files on page ${page}: ${errorMessage}`)
        console.error(`  URL: ${pageUrl}`)
        break
      }
    }

    return discoveredFiles
  }

  /**
   * Preprocess CSV content to fix Plodine-specific formatting issues.
   * Handles missing leading zeros in decimal values (e.g., ",69" -> "0,69").
   */
  protected preprocessContent(content: ArrayBuffer): ArrayBuffer {
    // Decode with Windows-1250 encoding
    const decoder = new TextDecoder(this.csvConfig.encoding)
    let text = decoder.decode(content)

    // Fix missing leading zeros in prices
    // Pattern matches: semicolon followed by comma and digits (;,69)
    // or start of value that's just comma and digits
    // We use semicolon as Plodine uses semicolon delimiter
    text = text.replace(/;,(\d)/g, ';0,$1')

    // Also handle case where value might be at start or in quotes
    text = text.replace(/^,(\d)/gm, '0,$1')
    text = text.replace(/",(\d)/g, '"0,$1')

    // Re-encode
    const encoder = new TextEncoder()
    return encoder.encode(text).buffer as ArrayBuffer
  }

  /**
   * Get parser options with encoding override.
   * After preprocessing, content is UTF-8.
   */
  protected getParserOptions(storeIdentifier: string): Partial<CsvParserOptions> {
    return {
      defaultStoreIdentifier: storeIdentifier,
      encoding: 'utf-8', // After preprocessing, content is UTF-8
    }
  }
}

/**
 * Create a Plodine adapter instance.
 */
export function createPlodineAdapter(): PlodineAdapter {
  return new PlodineAdapter()
}
