/**
 * Trgocentar Chain Adapter
 *
 * Adapter for parsing Trgocentar retail chain price data files.
 * Trgocentar uses XML format with Croatian field names.
 * Store resolution is based on filename.
 *
 * Trgocentar portal: https://trgocentar.com/Trgovine-cjenik/
 *
 * XML structure:
 * <DocumentElement>
 *   <cjenik>
 *     <naziv_art>...</naziv_art>  (naziv artikla = product name)
 *     <sif_art>...</sif_art>       (sifra artikla = product code)
 *     <marka>...</marka>           (brand)
 *     <net_kol>...</net_kol>       (neto kolicina = quantity)
 *     <jmj>...</jmj>               (jedinica mjere = unit)
 *     <mpc>...</mpc>               (maloprodajna cijena = retail price)
 *     <c_jmj>...</c_jmj>           (cijena po jedinici mjere = unit price)
 *     <mpc_pop>...</mpc_pop>       (mpc popust = discount price)
 *     <c_najniza_30 />             (cijena najniza 30 dana = lowest price 30 days)
 *     <c_020525>...</c_020525>     (anchor price as of specific date)
 *     <ean_kod>...</ean_kod>       (EAN barcode)
 *     <naz_kat>...</naz_kat>       (naziv kategorije = category name)
 *   </cjenik>
 * </DocumentElement>
 */

import type { DiscoveredFile } from '../core/types'
import type { XmlFieldMapping } from '../parsers/xml'
import { BaseXmlAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * XML field mapping for Trgocentar files.
 * Maps Trgocentar's XML elements to NormalizedRow fields.
 */
const TRGOCENTAR_FIELD_MAPPING: XmlFieldMapping = {
  externalId: 'sif_art',
  name: 'naziv_art',
  category: 'naz_kat',
  brand: 'marka',
  unit: 'jmj',
  unitQuantity: 'net_kol',
  price: (item) => {
    // Try regular price (mpc) first
    const mpc = item['mpc']
    if (typeof mpc === 'string' && mpc.trim() !== '') {
      return mpc.trim()
    }
    // If regular price is empty, try discount price (mpc_pop)
    // Some items only have discount price during special sales
    const mpcPop = item['mpc_pop']
    if (typeof mpcPop === 'string' && mpcPop.trim() !== '') {
      return mpcPop.trim()
    }
    return null
  },
  discountPrice: 'mpc_pop',
  barcodes: 'ean_kod',
  // Croatian price transparency fields
  unitPrice: 'c_jmj',
  lowestPrice30d: 'c_najniza_30',
  anchorPrice: (item) => {
    // The anchor price field has a dynamic name based on date (e.g., c_020525 for 2025-05-02)
    // Try to find any field starting with 'c_' followed by 6 digits
    const keys = Object.keys(item)
    for (const key of keys) {
      if (key.startsWith('c_') && /^\d{6}$/.test(key.slice(2))) {
        const value = item[key]
        if (typeof value === 'string' && value.trim() !== '') {
          return value.trim()
        }
      }
    }
    return null
  },
}

/**
 * Trgocentar chain adapter implementation.
 * Extends BaseXmlAdapter for common XML parsing functionality.
 *
 * Supports date-based discovery via setDiscoveryDate() method.
 */
export class TrgocentarAdapter extends BaseXmlAdapter {
  /** Date to discover files for (YYYY-MM-DD format, set by CLI before discovery) */
  private discoveryDate: string | null = null

  constructor() {
    super({
      slug: 'trgocentar',
      name: 'Trgocentar',
      supportedTypes: ['xml'],
      chainConfig: CHAIN_CONFIGS.trgocentar,
      fieldMapping: TRGOCENTAR_FIELD_MAPPING,
      defaultItemsPath: 'DocumentElement.cjenik',
      itemPaths: ['DocumentElement.cjenik'],
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
   * Trgocentar filenames contain dates in format: DDMMYYYYHHMM
   * Example: SUPERMARKET_HUM_NA_SUTLI_185_P220_005_050120260747.xml
   *                                                ^^^^^^^^^^
   *                                                DD = 05, MM = 01, YYYY = 2026
   */
  private extractDateFromFilename(filename: string): string | null {
    // Try DDMMYYYYHHMM pattern (Trgocentar specific format)
    // The date appears at the end before .xml
    const trgocentarMatch = filename.match(/(\d{2})(\d{2})(\d{4})\d{4}\.xml$/i)
    if (trgocentarMatch) {
      const day = trgocentarMatch[1]
      const month = trgocentarMatch[2]
      const year = trgocentarMatch[3]
      return `${year}-${month}-${day}`
    }

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

    return null
  }

  /**
   * Discover available Trgocentar price files.
   *
   * Trgocentar's portal structure:
   * - Fetches the portal HTML
   * - Extracts XML file links
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

      // Extract XML file links
      const xmlPattern = /href=["']([^"']*\.xml(?:\?[^"']*)?)["']/gi

      let match: RegExpExecArray | null
      while ((match = xmlPattern.exec(html)) !== null) {
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
          type: 'xml',
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
