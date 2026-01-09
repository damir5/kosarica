/**
 * DM Chain Adapter
 *
 * Adapter for parsing DM retail chain price data files.
 * DM uses XLSX format and has national (uniform) pricing across all stores.
 *
 * Discovery fetches the current price list directly from DM's content server.
 * The file URL is embedded in the DM portal page and updated periodically.
 *
 * DM portal: https://www.dm.hr/novo/promocije/nove-oznake-cijena-i-vazeci-cjenik-u-dm-u-2906632
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  DiscoveredFile,
  ParseOptions,
  ParseResult,
  StoreIdentifier,
} from '../core/types'
import { XlsxParser, type XlsxColumnMapping } from '../parsers/xlsx'
import { BaseChainAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * DM web portal URL where the price list is published.
 */
const DM_PORTAL_URL =
  'https://www.dm.hr/novo/promocije/nove-oznake-cijena-i-vazeci-cjenik-u-dm-u-2906632'

/**
 * Direct URL to the DM price list Excel file on their content server.
 * This URL is embedded in the portal page and may change periodically.
 */
const DM_PRICE_LIST_URL =
  'https://content.services.dmtech.com/rootpage-dm-shop-hr-hr/resource/blob/3245770/0a2d2d47073cad06c1f3a8d4fbba2e50/vlada-oznacavanje-cijena-cijenik-236-data.xlsx'

/**
 * Column mapping for DM web XLSX files (from content.services.dmtech.com).
 * Uses numeric indices because the web format has:
 * - Row 0: Title row
 * - Row 1: Empty row
 * - Row 2: Headers (with one null/empty header for šifra column)
 * - Row 3+: Data
 *
 * Web format columns:
 * 0: naziv (name)
 * 1: šifra (product code) - column header is null/empty
 * 2: marka (brand)
 * 3: barkod (barcode)
 * 4: kategorija proizvoda (category)
 * 5: neto količina (quantity)
 * 6: Jedinica mjere (unit)
 * 7: Cijena za jedinicu mjere (unit price)
 * 8: dostupno samo online (online only flag - ignored)
 * 9: MPC (regular price)
 * 10: MPC za vrijeme posebnog oblika prodaje (discount/clearance price)
 * 11: Najniža cijena u posljednjih 30 dana (lowest price in 30 days)
 * 12: sidrena cijena (anchor price)
 */
const DM_WEB_COLUMN_MAPPING: XlsxColumnMapping = {
  name: 0,
  externalId: 1,
  brand: 2,
  barcodes: 3,
  category: 4,
  unitQuantity: 5,
  unit: 6,
  unitPrice: 7,
  // Column 8 is "dostupno samo online" - ignored
  price: 9,
  discountPrice: 10,
  lowestPrice30d: 11,
  anchorPrice: 12,
}

/**
 * Column mapping for local DM XLSX files (legacy/test format).
 * Maps DM's Croatian column names to NormalizedRow fields.
 */
const DM_LOCAL_COLUMN_MAPPING: XlsxColumnMapping = {
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
 * Alternative column mapping for local DM XLSX files.
 * Some DM exports may use abbreviated or different column names.
 */
const DM_LOCAL_COLUMN_MAPPING_ALT: XlsxColumnMapping = {
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
 * Default store identifier for DM (national pricing).
 * DM has uniform pricing across all stores in Croatia.
 */
const DM_NATIONAL_STORE_IDENTIFIER = 'dm_national'

/**
 * DM chain adapter implementation.
 * Extends BaseChainAdapter with XLSX-specific parsing logic.
 * DM is unique in using XLSX format with national pricing.
 *
 * Primary discovery fetches from the DM web portal.
 * Falls back to local files if web fetch fails.
 */
export class DmAdapter extends BaseChainAdapter {
  private xlsxParser: XlsxParser
  /** Date to discover files for (YYYY-MM-DD format, set by CLI before discovery) */
  private discoveryDate: string | null = null

  constructor() {
    super({
      slug: 'dm',
      name: 'DM',
      supportedTypes: ['xlsx'],
      chainConfig: CHAIN_CONFIGS.dm,
      filenamePrefixPatterns: [
        /^DM[_-]?/i,
        /^dm[_-]?/i,
        /^cjenik[_-]?/i,
        /^vlada-oznacavanje/i,
      ],
      fileExtensionPattern: /\.(xlsx|xls|XLSX|XLS)$/,
      rateLimitConfig: {
        requestsPerSecond: 2,
        maxRetries: 3,
      },
    })

    this.xlsxParser = new XlsxParser({
      columnMapping: DM_WEB_COLUMN_MAPPING,
      hasHeader: false, // Web format uses index-based mapping, skip header detection
      skipEmptyRows: true,
      headerRowCount: 3, // Skip title row, empty row, and header row
      defaultStoreIdentifier: DM_NATIONAL_STORE_IDENTIFIER,
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
   * Discover available DM price files.
   *
   * Primary: Fetches current price list from DM web portal.
   * Fallback: Searches local data directory for files matching date pattern.
   *
   * @returns Array of discovered files
   */
  async discover(): Promise<DiscoveredFile[]> {
    const discoveredFiles: DiscoveredFile[] = []
    const date = this.discoveryDate || new Date().toISOString().split('T')[0]

    // Primary: Try to discover from web
    console.log(`[INFO] Discovering DM price list from web portal...`)
    try {
      // The web file is the current/latest price list
      // We use HEAD request to check if it's accessible and get metadata
      const response = await fetch(DM_PRICE_LIST_URL, { method: 'HEAD' })

      if (response.ok) {
        const contentLength = response.headers.get('content-length')
        const lastModified = response.headers.get('last-modified')

        // Extract filename from URL
        const urlFilename = DM_PRICE_LIST_URL.split('/').pop() || 'dm-cjenik.xlsx'

        discoveredFiles.push({
          url: DM_PRICE_LIST_URL,
          filename: urlFilename,
          type: 'xlsx',
          size: contentLength ? parseInt(contentLength, 10) : null,
          lastModified: lastModified ? new Date(lastModified) : new Date(),
          metadata: {
            source: 'dm_web',
            discoveredAt: new Date().toISOString(),
            portalUrl: DM_PORTAL_URL,
            portalDate: date,
          },
        })

        console.log(`[INFO] Found DM price list: ${urlFilename}`)
        return discoveredFiles
      }

      console.warn(
        `[WARN] DM web portal returned ${response.status}, falling back to local files`,
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.warn(`[WARN] Failed to access DM web portal: ${errorMessage}`)
      console.warn(`[WARN] Falling back to local files...`)
    }

    // Fallback: Look for local files in ./data/ingestion/dm/ directory
    const dataDir = path.resolve('./data/ingestion/dm')
    console.log(`[DEBUG] Scanning DM local directory: ${dataDir}`)

    try {
      if (!fs.existsSync(dataDir)) {
        console.error(`DM data directory not found: ${dataDir}`)
        return []
      }

      const files = fs.readdirSync(dataDir)

      for (const filename of files) {
        // Match DM filename patterns: dm_YYYY-MM-DD.xlsx or DM_YYYY-MM-DD.xlsx
        const match = filename.match(
          /^(dm|DM)[_-](\d{4}-\d{2}-\d{2})\.(xlsx|xls)$/i,
        )
        if (!match) {
          continue
        }

        const fileDate = match[2]

        // Filter by discovery date if set
        if (date && fileDate !== date) {
          continue
        }

        const filePath = path.join(dataDir, filename)
        const stats = fs.statSync(filePath)

        discoveredFiles.push({
          url: `file://${filePath}`,
          filename,
          type: 'xlsx',
          size: stats.size,
          lastModified: new Date(fileDate),
          metadata: {
            source: 'dm_local',
            discoveredAt: new Date().toISOString(),
            portalDate: fileDate,
          },
        })
      }

      return discoveredFiles
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Error discovering DM files: ${errorMessage}`)
      console.error(`  Directory: ${dataDir}`)
      return []
    }
  }

  /**
   * Fetch a discovered DM file.
   * For local files (file:// URLs), reads directly from filesystem.
   */
  async fetch(file: DiscoveredFile): Promise<import('../core/types').FetchedFile> {
    if (file.url.startsWith('file://')) {
      const filePath = file.url.replace('file://', '')
      const buffer = fs.readFileSync(filePath)
      // Extract the actual content from the buffer (Node.js buffers use shared memory pools)
      const content = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer
      const { computeSha256 } = await import('../core/storage')
      const hash = await computeSha256(content)

      return {
        discovered: file,
        content,
        hash,
      }
    }

    // Fall back to base class implementation for remote URLs
    return super.fetch(file)
  }

  /**
   * Parse DM XLSX content into normalized rows.
   * Automatically detects file format (web vs local) based on filename pattern.
   */
  async parse(
    content: ArrayBuffer,
    filename: string,
    options?: ParseOptions,
  ): Promise<ParseResult> {
    const storeIdentifier = DM_NATIONAL_STORE_IDENTIFIER

    // Detect if this is a web format file (from content.services.dmtech.com)
    const isWebFormat =
      filename.includes('vlada-oznacavanje') || filename.includes('cijenik-')

    if (isWebFormat) {
      // Web format: uses numeric column indices, has 3 header rows to skip
      this.xlsxParser.setOptions({
        columnMapping: DM_WEB_COLUMN_MAPPING,
        hasHeader: false,
        headerRowCount: 3, // Skip title row, empty row, and header row
        defaultStoreIdentifier: storeIdentifier,
      })

      return this.xlsxParser.parse(content, filename, options)
    }

    // Local format: uses Croatian column names with standard header
    this.xlsxParser.setOptions({
      columnMapping: DM_LOCAL_COLUMN_MAPPING,
      hasHeader: true,
      headerRowCount: 0,
      defaultStoreIdentifier: storeIdentifier,
    })

    let result = await this.xlsxParser.parse(content, filename, options)

    // If no valid rows, try alternative column mapping
    if (result.validRows === 0 && result.errors.length > 0) {
      this.xlsxParser.setOptions({
        columnMapping: DM_LOCAL_COLUMN_MAPPING_ALT,
        hasHeader: true,
        headerRowCount: 0,
        defaultStoreIdentifier: storeIdentifier,
      })
      result = await this.xlsxParser.parse(content, filename, options)
    }

    return result
  }

  /**
   * Extract store identifier for DM.
   * DM has national pricing, so always returns the national identifier.
   */
  extractStoreIdentifier(_file: DiscoveredFile): StoreIdentifier | null {
    // DM has uniform national pricing - no per-store variation
    return {
      type: 'national',
      value: DM_NATIONAL_STORE_IDENTIFIER,
    }
  }
}

/**
 * Create a DM adapter instance.
 */
export function createDmAdapter(): DmAdapter {
  return new DmAdapter()
}
