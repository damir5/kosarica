/**
 * Trgocentar Chain Adapter
 *
 * Adapter for parsing Trgocentar retail chain price data files.
 * Trgocentar uses XML format with store information embedded.
 * Store resolution is based on filename.
 *
 * Trgocentar portal: https://trgocentar.com/Trgovine-cjenik/
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
  storeIdentifier: (item) => {
    // Extract store ID from item or parent store block
    const storeId =
      (item['store_id'] as string) ??
      (item['storeId'] as string) ??
      (item['Store'] as Record<string, unknown>)?.['Id'] as string ??
      null
    return storeId ? String(storeId) : null
  },
  externalId: 'code',
  name: 'name',
  description: 'description',
  category: 'category',
  subcategory: 'subcategory',
  brand: 'brand',
  unit: 'unit',
  unitQuantity: 'quantity',
  price: 'price',
  discountPrice: 'discount_price',
  discountStart: 'discount_start',
  discountEnd: 'discount_end',
  barcodes: 'barcode',
  imageUrl: 'image_url',
  // Croatian price transparency fields
  unitPrice: 'unit_price',
  unitPriceBaseQuantity: 'unit_price_quantity',
  unitPriceBaseUnit: 'unit_price_unit',
  lowestPrice30d: 'lowest_price_30d',
  anchorPrice: 'anchor_price',
  anchorPriceAsOf: 'anchor_price_date',
}

/**
 * Alternative field mapping for Trgocentar XML files (Croatian naming).
 */
const TRGOCENTAR_FIELD_MAPPING_ALT: XmlFieldMapping = {
  storeIdentifier: (item) => {
    const storeId =
      (item['StoreId'] as string) ??
      (item['STORE_ID'] as string) ??
      (item['Poslovnica'] as Record<string, unknown>)?.['Id'] as string ??
      null
    return storeId ? String(storeId) : null
  },
  externalId: 'Sifra',
  name: 'Naziv',
  description: 'Opis',
  category: 'Kategorija',
  subcategory: 'Podkategorija',
  brand: 'Marka',
  unit: 'Jedinica',
  unitQuantity: 'Kolicina',
  price: 'Cijena',
  discountPrice: 'AkcijskaCijena',
  discountStart: 'PocetakAkcije',
  discountEnd: 'KrajAkcije',
  barcodes: 'Barkod',
  imageUrl: 'Slika',
  // Croatian price transparency fields
  unitPrice: 'CijenaZaJedinicuMjere',
  unitPriceBaseQuantity: 'JedinicaMjereKolicina',
  unitPriceBaseUnit: 'JedinicaMjereOznaka',
  lowestPrice30d: 'NajnizaCijena30Dana',
  anchorPrice: 'SidrenaCijena',
  anchorPriceAsOf: 'SidrenaCijenaDatum',
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
      alternativeFieldMapping: TRGOCENTAR_FIELD_MAPPING_ALT,
      defaultItemsPath: 'products.product',
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
