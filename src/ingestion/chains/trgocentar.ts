/**
 * Trgocentar Chain Adapter
 *
 * Adapter for parsing Trgocentar retail chain price data files.
 * Trgocentar uses CSV format with semicolon delimiter.
 * Store resolution is based on filename.
 *
 * Trgocentar portal: https://trgocentar.com/Trgovine-cjenik/
 *
 * CSV format:
 * Šifra;Naziv;Kategorija;Marka;Mjerna jedinica;Količina;Cijena;Akcijska cijena;
 * Početak akcije;Kraj akcije;Barkod;Cijena za jedinicu mjere;
 * Najniža cijena u zadnjih 30 dana;Sidrena cijena;Količina za jedinicu mjere;
 * Jedinica mjere za cijenu;Datum sidrene cijene
 */

import type { DiscoveredFile } from '../core/types'
import type { CsvColumnMapping } from '../parsers/csv'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * CSV column mapping for Trgocentar files.
 * Maps Trgocentar's CSV columns to NormalizedRow fields.
 */
const TRGOCENTAR_COLUMN_MAPPING: CsvColumnMapping = {
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
 * Alternative column mapping for Trgocentar CSV files (ASCII/English).
 */
const TRGOCENTAR_COLUMN_MAPPING_ALT: CsvColumnMapping = {
  externalId: 'Sifra',
  name: 'Naziv',
  category: 'Kategorija',
  brand: 'Marka',
  unit: 'Mjerna jedinica',
  unitQuantity: 'Kolicina',
  price: 'Cijena',
  discountPrice: 'Akcijska cijena',
  discountStart: 'Pocetak akcije',
  discountEnd: 'Kraj akcije',
  barcodes: 'Barkod',
  // Croatian price transparency fields
  unitPrice: 'Cijena za jedinicu mjere',
  lowestPrice30d: 'Najniza cijena u zadnjih 30 dana',
  anchorPrice: 'Sidrena cijena',
  unitPriceBaseQuantity: 'Kolicina za jedinicu mjere',
  unitPriceBaseUnit: 'Jedinica mjere za cijenu',
  anchorPriceAsOf: 'Datum sidrene cijene',
}

/**
 * Trgocentar chain adapter implementation.
 * Extends BaseCsvAdapter for common CSV parsing functionality.
 *
 * Supports date-based discovery via setDiscoveryDate() method.
 */
export class TrgocentarAdapter extends BaseCsvAdapter {
  /** Date to discover files for (YYYY-MM-DD format, set by CLI before discovery) */
  private discoveryDate: string | null = null

  constructor() {
    super({
      slug: 'trgocentar',
      name: 'Trgocentar',
      supportedTypes: ['csv'],
      chainConfig: CHAIN_CONFIGS.trgocentar,
      columnMapping: TRGOCENTAR_COLUMN_MAPPING,
      alternativeColumnMapping: TRGOCENTAR_COLUMN_MAPPING_ALT,
      filenamePrefixPatterns: [
        /^Trgocentar[_-]?/i,
        /^cjenik[_-]?/i,
        /^SUPERMARKET[_-]?/i,
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
   * Extract date from Trgocentar filename.
   * Trgocentar filenames often contain dates in format: YYYY-MM-DD or DD-MM-YYYY
   */
  private extractDateFromFilename(filename: string): string | null {
    // Try YYYY-MM-DD pattern
    const isoMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})/)
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
    }

    // Try DD-MM-YYYY pattern
    const euMatch = filename.match(/(\d{2})-(\d{2})-(\d{4})/)
    if (euMatch) {
      return `${euMatch[3]}-${euMatch[2]}-${euMatch[1]}`
    }

    // Try DDMMYYYY pattern (compact)
    const compactMatch = filename.match(/(\d{2})(\d{2})(\d{4})/)
    if (compactMatch) {
      return `${compactMatch[3]}-${compactMatch[2]}-${compactMatch[1]}`
    }

    return null
  }

  /**
   * Discover available Trgocentar price files.
   *
   * Trgocentar's portal structure may vary. This implementation:
   * - Fetches the portal HTML
   * - Extracts CSV file links
   * - Filters by date if setDiscoveryDate was called
   *
   * @returns Array of discovered files (filtered by date if setDiscoveryDate was called)
   */
  async discover(): Promise<DiscoveredFile[]> {
    const discoveredFiles: DiscoveredFile[] = []
    const seenUrls = new Set<string>()

    console.log(`[DEBUG] Fetching Trgocentar portal: ${this.config.baseUrl}`)

    try {
      const response = await fetch(this.config.baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PriceTracker/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })

      if (!response.ok) {
        console.error(`Failed to fetch Trgocentar portal: ${response.status} ${response.statusText}`)
        console.error(`  URL: ${this.config.baseUrl}`)
        return []
      }

      const html = await response.text()

      // Extract CSV file links
      const csvPattern = /href=["']([^"']*\.csv(?:\?[^"']*)?)["']/gi

      let match: RegExpExecArray | null
      while ((match = csvPattern.exec(html)) !== null) {
        const href = match[1]
        const fileUrl = href.startsWith('http') ? href : new URL(href, this.config.baseUrl).toString()

        // Skip duplicates
        if (seenUrls.has(fileUrl)) {
          continue
        }
        seenUrls.add(fileUrl)

        // Extract filename from URL
        const filename = this.extractFilenameFromUrl(fileUrl)
        const fileDate = this.extractDateFromFilename(filename)

        // Filter by date if discoveryDate is set
        if (this.discoveryDate && fileDate && fileDate !== this.discoveryDate) {
          continue
        }

        discoveredFiles.push({
          url: fileUrl,
          filename,
          type: 'csv',
          size: null,
          lastModified: fileDate ? new Date(fileDate) : null,
          metadata: {
            source: 'trgocentar_portal',
            discoveredAt: new Date().toISOString(),
            ...(fileDate && { portalDate: fileDate }),
          },
        })
      }

      return discoveredFiles
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Error discovering Trgocentar files: ${errorMessage}`)
      console.error(`  URL: ${this.config.baseUrl}`)
      return []
    }
  }
}

/**
 * Create a Trgocentar adapter instance.
 */
export function createTrgocentarAdapter(): TrgocentarAdapter {
  return new TrgocentarAdapter()
}
