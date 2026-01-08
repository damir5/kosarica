/**
 * DM Chain Adapter
 *
 * Adapter for parsing DM retail chain price data files.
 * DM uses XLSX format and has national (uniform) pricing across all stores.
 *
 * Supports single-date discovery via setDiscoveryDate() method.
 * Discovery looks for local files in the data directory matching the date pattern.
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
 * Column mapping for DM XLSX files.
 * Maps DM's Croatian column names to NormalizedRow fields.
 */
const DM_COLUMN_MAPPING: XlsxColumnMapping = {
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
 * Alternative column mapping for DM XLSX files.
 * Some DM exports may use abbreviated or different column names.
 */
const DM_COLUMN_MAPPING_ALT: XlsxColumnMapping = {
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
 * Supports date-based local file discovery via setDiscoveryDate() method.
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
      ],
      fileExtensionPattern: /\.(xlsx|xls|XLSX|XLS)$/,
      rateLimitConfig: {
        requestsPerSecond: 2,
        maxRetries: 3,
      },
    })

    this.xlsxParser = new XlsxParser({
      columnMapping: DM_COLUMN_MAPPING,
      hasHeader: true,
      skipEmptyRows: true,
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
   * DM files are stored locally with naming pattern: dm_YYYY-MM-DD.xlsx
   * Discovery searches the local data directory for matching files.
   *
   * @returns Array of discovered files (filtered by date if setDiscoveryDate was called)
   */
  async discover(): Promise<DiscoveredFile[]> {
    const discoveredFiles: DiscoveredFile[] = []

    // Use provided date or default to today
    const date = this.discoveryDate || new Date().toISOString().split('T')[0]

    // Look for local files in ./data/ingestion/dm/ directory
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
        const match = filename.match(/^(dm|DM)[_-](\d{4}-\d{2}-\d{2})\.(xlsx|xls)$/i)
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
   */
  async parse(
    content: ArrayBuffer,
    filename: string,
    options?: ParseOptions,
  ): Promise<ParseResult> {
    // DM has national pricing, always use the national store identifier
    const storeIdentifier = DM_NATIONAL_STORE_IDENTIFIER

    // Try parsing with primary column mapping first
    this.xlsxParser.setOptions({
      columnMapping: DM_COLUMN_MAPPING,
      defaultStoreIdentifier: storeIdentifier,
    })

    let result = await this.xlsxParser.parse(content, filename, options)

    // If no valid rows, try alternative column mapping
    if (result.validRows === 0 && result.errors.length > 0) {
      this.xlsxParser.setOptions({
        columnMapping: DM_COLUMN_MAPPING_ALT,
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
