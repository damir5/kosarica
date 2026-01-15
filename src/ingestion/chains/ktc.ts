/**
 * KTC Chain Adapter
 *
 * Adapter for parsing KTC retail chain price data files.
 * KTC uses CSV format with semicolon delimiter and Windows-1250 encoding.
 * Store resolution is based on filename.
 *
 * KTC portal: https://www.ktc.hr/cjenici
 *
 * Portal structure:
 * 1. Main page lists all stores/regions (poslovnica)
 * 2. Each store page lists CSV files by date
 * 3. CSV files are at /ktcftp/Cjenici/STORE_NAME/FILENAME.csv
 *
 * Filename format: TRGOVINA-ADDRESS-STORE_ID-DATE-TIME.csv
 * Example: TRGOVINA-PAKRACKA ULICA 1 BJELOVAR-PJ50-1-20260105-071001.csv
 */

import type { DiscoveredFile, StoreMetadata } from '../core/types'
import type { CsvColumnMapping } from '../parsers/csv'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * Column mapping for KTC CSV files.
 * Maps KTC's column names to NormalizedRow fields.
 *
 * Actual KTC CSV headers (Windows-1250 encoded):
 * - Naziv proizvoda
 * - Šifra proizvoda
 * - Marka proizvoda
 * - Neto količina
 * - Jedinica mjere
 * - Maloprodajna cijena
 * - Cijena za jedinicu mjere
 * - Barkod
 * - Kategorija
 * - Najniža cijena u posljednjih 30 dana
 * - MPC za vrijeme posebnog oblika prodaje
 */
const KTC_COLUMN_MAPPING: CsvColumnMapping = {
  name: 'Naziv proizvoda',
  externalId: 'Šifra proizvoda',
  brand: 'Marka proizvoda',
  unitQuantity: 'Neto količina',
  unit: 'Jedinica mjere',
  price: 'Maloprodajna cijena',
  unitPrice: 'Cijena za jedinicu mjere',
  barcodes: 'Barkod',
  category: 'Kategorija',
  lowestPrice30d: 'Najniža cijena u posljednjih 30 dana',
  discountPrice: 'MPC za vrijeme posebnog oblika prodaje',
}

/**
 * Alternative column mapping for KTC CSV files (without diacritics).
 * Some systems may strip diacritics when decoding Windows-1250.
 */
const KTC_COLUMN_MAPPING_ALT: CsvColumnMapping = {
  name: 'Naziv proizvoda',
  externalId: 'Sifra proizvoda',
  brand: 'Marka proizvoda',
  unitQuantity: 'Neto kolicina',
  unit: 'Jedinica mjere',
  price: 'Maloprodajna cijena',
  unitPrice: 'Cijena za jedinicu mjere',
  barcodes: 'Barkod',
  category: 'Kategorija',
  lowestPrice30d: 'Najniza cijena u posljednjih 30 dana',
  discountPrice: 'MPC za vrijeme posebnog oblika prodaje',
}

/**
 * KTC chain adapter implementation.
 * Extends BaseCsvAdapter for common CSV parsing functionality.
 *
 * KTC uses a two-level portal structure:
 * 1. Main page lists all stores (poslovnica)
 * 2. Each store page lists downloadable CSV files by date
 */
export class KtcAdapter extends BaseCsvAdapter {
  /** Date to discover files for (YYYY-MM-DD format, set by CLI before discovery) */
  private discoveryDate: string | null = null

  constructor() {
    super({
      slug: 'ktc',
      name: 'KTC',
      supportedTypes: ['csv'],
      chainConfig: CHAIN_CONFIGS.ktc,
      columnMapping: KTC_COLUMN_MAPPING,
      alternativeColumnMapping: KTC_COLUMN_MAPPING_ALT,
      filenamePrefixPatterns: [
        /^TRGOVINA[_-]?/i,
        /^KTC[_-]?/i,
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
   * Extract date from KTC filename.
   * KTC filenames contain dates in format: YYYYMMDD
   * Example: TRGOVINA-PAKRACKA ULICA 1 BJELOVAR-PJ50-1-20260105-071001.csv
   */
  private extractDateFromFilename(filename: string): string | null {
    // Match 8-digit date pattern (YYYYMMDD)
    const match = filename.match(/(\d{4})(\d{2})(\d{2})-\d{6}\.csv$/i)
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`
    }
    return null
  }

  /**
   * Discover available KTC price files.
   *
   * KTC's portal at /cjenici has a two-level structure:
   * 1. Main page lists stores (e.g., ?poslovnica=RC%20BJELOVAR%20PJ-50)
   * 2. Store pages list CSV files with download links
   *
   * This method:
   * 1. Fetches the main page to get all store names
   * 2. For each store, fetches the store page to get CSV links
   * 3. Filters by date if setDiscoveryDate was called
   *
   * @returns Array of discovered files (filtered by date if set)
   */
  async discover(): Promise<DiscoveredFile[]> {
    const discoveredFiles: DiscoveredFile[] = []
    const seenUrls = new Set<string>()

    console.log(`[DEBUG] Fetching ${this.name} portal: ${this.config.baseUrl}`)

    try {
      // Step 1: Fetch main page to get list of stores
      const mainResponse = await fetch(this.config.baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PriceTracker/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })

      if (!mainResponse.ok) {
        console.error(`[ERROR] Failed to fetch KTC portal: ${mainResponse.status} ${mainResponse.statusText}`)
        return []
      }

      const mainHtml = await mainResponse.text()

      // Extract store names from links like: ?poslovnica=RC BJELOVAR PJ-50
      const storePattern = /poslovnica=([^"&]+)/g
      const stores: string[] = []
      let storeMatch: RegExpExecArray | null

      while ((storeMatch = storePattern.exec(mainHtml)) !== null) {
        const storeName = decodeURIComponent(storeMatch[1])
        if (!stores.includes(storeName)) {
          stores.push(storeName)
        }
      }

      console.log(`[DEBUG] Found ${stores.length} store(s) on KTC portal`)

      // Step 2: For each store, fetch store page and extract CSV links
      for (const storeName of stores) {
        const storeUrl = `${this.config.baseUrl}?poslovnica=${encodeURIComponent(storeName)}`

        try {
          // Rate limit between store requests
          await this.rateLimiter.throttle()

          const storeResponse = await fetch(storeUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; PriceTracker/1.0)',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          })

          if (!storeResponse.ok) {
            console.warn(`[WARN] Failed to fetch store page for ${storeName}: ${storeResponse.status}`)
            continue
          }

          const storeHtml = await storeResponse.text()

          // Extract CSV links like: /ktcftp/Cjenici/STORE_NAME/FILENAME.csv
          const csvPattern = /href="([^"]*\.csv)"/gi
          let csvMatch: RegExpExecArray | null

          while ((csvMatch = csvPattern.exec(storeHtml)) !== null) {
            const href = csvMatch[1]
            const fileUrl = href.startsWith('http') ? href : new URL(href, this.config.baseUrl).toString()

            // Skip duplicates
            if (seenUrls.has(fileUrl)) {
              continue
            }
            seenUrls.add(fileUrl)

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
                source: 'ktc_portal',
                discoveredAt: new Date().toISOString(),
                storeName,
                ...(fileDate && { portalDate: fileDate }),
              },
            })
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          console.warn(`[WARN] Error fetching store ${storeName}: ${errorMessage}`)
        }
      }

      return discoveredFiles
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[ERROR] Error discovering KTC files: ${errorMessage}`)
      return []
    }
  }

  /**
   * Extract store identifier from KTC filename.
   *
   * KTC filenames follow the pattern:
   * TRGOVINA-ADDRESS-STORE_ID-DATE-TIME.csv
   *
   * Example: TRGOVINA-PAKRACKA ULICA 1 BJELOVAR-PJ50-1-20260105-071001.csv
   * Store ID would be: PJ50-1
   *
   * Store IDs can include letters after PJ: PJ06, PJ7B, PJ8A, etc.
   *
   * @param filename - The CSV filename
   * @returns Store identifier string
   */
  protected override extractStoreIdentifierFromFilename(filename: string): string {
    // Decode URL encoding first (filenames may be URL-encoded)
    const decodedFilename = decodeURIComponent(filename)

    // Match pattern like: PJ50-1, PJ7B-1, PJ8A-1 before the date (8 digits)
    // Store IDs are: PJ + alphanumeric + optional dash + digit
    const match = decodedFilename.match(/(PJ[\dA-Z]+-\d+)-\d{8}-\d{6}\.csv$/i)
    if (match) {
      return match[1]
    }

    // Try simpler pattern: PJ followed by alphanumeric characters
    const simpleMatch = decodedFilename.match(/(PJ[\dA-Z]+)-\d+-\d{8}/i)
    if (simpleMatch) {
      // Get the full store ID including the trailing number
      const afterPJ = decodedFilename.substring(decodedFilename.indexOf(simpleMatch[1]))
      const fullMatch = afterPJ.match(/^(PJ[\dA-Z]+-\d+)/i)
      if (fullMatch) {
        return fullMatch[1]
      }
      return simpleMatch[1]
    }

    // Last resort: use base class method
    return super.extractStoreIdentifierFromFilename(decodedFilename)
  }

  /**
   * Extract store metadata from KTC filename.
   *
   * KTC filenames follow the pattern:
   * TRGOVINA-ADDRESS-STORE_ID-DATE-TIME.csv
   *
   * Example: TRGOVINA-PAKRACKA ULICA 1 BJELOVAR-PJ50-1-20260105-071001.csv
   *
   * This method extracts:
   * - Store name: "KTC BJELOVAR" (from city)
   * - Address: "Pakracka Ulica 1" (excluding city)
   * - City: "Bjelovar" (last word of address)
   *
   * @param file - The discovered file
   * @returns Store metadata, or null if not extractable
   */
  extractStoreMetadata(file: DiscoveredFile): StoreMetadata | null {
    const decoded = decodeURIComponent(file.filename)

    // Extract address between TRGOVINA- and -PJ
    const match = decoded.match(/^TRGOVINA-(.+?)-(PJ[\dA-Z]+-\d+)-/i)
    if (!match) return super.extractStoreMetadata(file)

    const addressFull = match[1] // "PAKRACKA ULICA 1 BJELOVAR"
    // match[2] contains store code (e.g., "PJ50-1"), but we use city from address for naming

    // Last word is typically the city
    const words = addressFull.split(' ')
    const city = words.pop()
    const address = words.join(' ')

    return {
      name: `KTC ${this.titleCase(city || addressFull)}`,
      address: this.titleCase(address),
      city: city ? this.titleCase(city) : undefined,
    }
  }

  /**
   * Convert a string to title case.
   * Capitalizes the first letter of each word.
   *
   * @param str - The string to convert
   * @returns Title-cased string
   */
  private titleCase(str: string): string {
    return str
      .toLowerCase()
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  }
}

/**
 * Create a KTC adapter instance.
 */
export function createKtcAdapter(): KtcAdapter {
  return new KtcAdapter()
}
