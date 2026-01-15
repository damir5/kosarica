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

import type { DiscoveredFile, StoreMetadata } from '../core/types'
import type { CsvColumnMapping, CsvParserOptions } from '../parsers/csv'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * Column mapping for Plodine CSV files (current format as of 2026).
 * Maps Plodine's column names to NormalizedRow fields.
 *
 * Sample header:
 * Naziv proizvoda;Sifra proizvoda;Marka proizvoda;Neto kolicina;Jedinica mjere;
 * Maloprodajna cijena;Cijena po JM;MPC za vrijeme posebnog oblika prodaje;
 * Najniza cijena u poslj. 30 dana;Sidrena cijena na 2.5.2025;Barkod;Kategorija proizvoda;
 */
const PLODINE_COLUMN_MAPPING: CsvColumnMapping = {
  name: 'Naziv proizvoda',
  externalId: 'Sifra proizvoda',
  brand: 'Marka proizvoda',
  unitQuantity: 'Neto kolicina',
  unit: 'Jedinica mjere',
  price: 'Maloprodajna cijena',
  unitPrice: 'Cijena po JM',
  discountPrice: 'MPC za vrijeme posebnog oblika prodaje',
  lowestPrice30d: 'Najniza cijena u poslj. 30 dana',
  // Note: anchorPrice column has dynamic date in name (e.g., "Sidrena cijena na 2.5.2025")
  // Handled via preprocessContent which normalizes the header
  anchorPrice: 'Sidrena cijena',
  barcodes: 'Barkod',
  category: 'Kategorija proizvoda',
}

/**
 * Alternative column mapping for Plodine CSV files (legacy format).
 * Some older Plodine exports may use different column names.
 */
const PLODINE_COLUMN_MAPPING_ALT: CsvColumnMapping = {
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
  unitPriceBaseQuantity: 'Količina za jedinicu mjere',
  unitPriceBaseUnit: 'Jedinica mjere za cijenu',
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
      supportedTypes: ['csv', 'zip'],
      chainConfig: CHAIN_CONFIGS.plodine,
      columnMapping: PLODINE_COLUMN_MAPPING,
      alternativeColumnMapping: PLODINE_COLUMN_MAPPING_ALT,
      filenamePrefixPatterns: [
        /^Plodine[_-]?/i,
        /^cjenik[_-]?/i,
        /^cjenici[_-]?/i,
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
   * Plodine provides ZIP archives containing CSV files for each store.
   * URL pattern: https://www.plodine.hr/cjenici/cjenici_DD_MM_YYYY_HH_MM_SS.zip
   *
   * The portal lists all available dates. We filter by the discovery date.
   *
   * @returns Array of discovered files for the specified date
   */
  async discover(): Promise<DiscoveredFile[]> {
    const discoveredFiles: DiscoveredFile[] = []
    const seenUrls = new Set<string>()

    // Use provided date or default to today
    const targetDate = this.discoveryDate || new Date().toISOString().split('T')[0]

    // Convert YYYY-MM-DD to DD_MM_YYYY format used in Plodine filenames
    const [year, month, day] = targetDate.split('-')
    const targetDatePattern = `${day}_${month}_${year}`

    const pageUrl = this.config.baseUrl
    console.log(`[DEBUG] Fetching Plodine page: ${pageUrl}`)
    console.log(`[DEBUG] Looking for date pattern: ${targetDatePattern}`)

    try {
      const response = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PriceTracker/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })

      if (!response.ok) {
        console.error(`Failed to fetch Plodine portal: ${response.status} ${response.statusText}`)
        console.error(`  URL: ${pageUrl}`)
        return []
      }

      const html = await response.text()

      // Extract ZIP download links: href="https://www.plodine.hr/cjenici/cjenici_DD_MM_YYYY_HH_MM_SS.zip"
      const zipPattern = /href=["'](https?:\/\/[^"']*\/cjenici\/cjenici_(\d{2}_\d{2}_\d{4})_\d{2}_\d{2}_\d{2}\.zip)["']/gi

      let match: RegExpExecArray | null
      while ((match = zipPattern.exec(html)) !== null) {
        const fileUrl = match[1]
        const fileDatePattern = match[2] // DD_MM_YYYY

        // Filter by target date
        if (fileDatePattern !== targetDatePattern) {
          continue
        }

        // Skip duplicates
        if (seenUrls.has(fileUrl)) {
          continue
        }
        seenUrls.add(fileUrl)

        // Extract filename from URL
        const filename = fileUrl.split('/').pop() || `cjenici_${fileDatePattern}.zip`

        discoveredFiles.push({
          url: fileUrl,
          filename,
          type: 'zip',
          size: null,
          lastModified: new Date(targetDate),
          metadata: {
            source: 'plodine_portal',
            discoveredAt: new Date().toISOString(),
            portalDate: targetDate,
            fileDatePattern,
          },
        })
      }

      if (discoveredFiles.length === 0) {
        console.log(`[DEBUG] No ZIP files found for date ${targetDate} (pattern: ${targetDatePattern})`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Error discovering Plodine files: ${errorMessage}`)
      console.error(`  URL: ${pageUrl}`)
    }

    return discoveredFiles
  }

  /**
   * Fetch a discovered file with SSL certificate handling.
   * Overrides base class to use custom agent that handles Plodine's certificate.
   */
  async fetch(file: import('../core/types').DiscoveredFile): Promise<import('../core/types').FetchedFile> {
    // Wait for rate limiting
    await this.rateLimiter.throttle()

    const response = await fetch(file.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PriceTracker/1.0)',
        'Accept': '*/*',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch ${file.url}: ${response.status} ${response.statusText}`)
    }

    const content = await response.arrayBuffer()
    const { computeSha256 } = await import('../core/storage')
    const hash = await computeSha256(content)

    return {
      discovered: file,
      content,
      hash,
    }
  }

  /**
   * Preprocess CSV content to fix Plodine-specific formatting issues.
   * - Handles missing leading zeros in decimal values (e.g., ",69" -> "0,69")
   * - Normalizes dynamic column names (e.g., "Sidrena cijena na 2.5.2025" -> "Sidrena cijena")
   */
  protected preprocessContent(content: ArrayBuffer): ArrayBuffer {
    // Decode with Windows-1250 encoding
    const decoder = new TextDecoder(this.csvConfig.encoding)
    let text = decoder.decode(content)

    // Normalize anchor price column header (remove the dynamic date suffix)
    // "Sidrena cijena na 2.5.2025" -> "Sidrena cijena"
    text = text.replace(/Sidrena cijena na \d+\.\d+\.\d+/gi, 'Sidrena cijena')

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

  /**
   * Extract store metadata from Plodine filename.
   *
   * Example filename: SUPERMARKET_ALOJZIJA_STEPINCA_201_32100_VINKOVCI_152_246_15012026015256.csv
   * Pattern: {type}_{address...}_{postal}_{city}_{storeId}_{seq}_{date}.csv
   */
  extractStoreMetadata(file: DiscoveredFile): StoreMetadata | null {
    const parts = file.filename.replace(/\.csv$/i, '').split('_')
    if (parts.length < 6) return super.extractStoreMetadata(file)

    const storeType = parts[0]  // "SUPERMARKET"

    // Find postal code (5 digits) working from index 1
    let postalIdx = -1
    for (let i = 1; i < parts.length - 3; i++) {
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
      name: `Plodine ${this.titleCase(city)}`,
      address: this.titleCase(address),
      city: this.titleCase(city),
      postalCode,
      storeType: this.titleCase(storeType),
    }
  }

  /**
   * Convert string to title case.
   * Example: "ALOJZIJA STEPINCA" -> "Alojzija Stepinca"
   */
  private titleCase(str: string): string {
    return str.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  }
}

/**
 * Create a Plodine adapter instance.
 */
export function createPlodineAdapter(): PlodineAdapter {
  return new PlodineAdapter()
}
