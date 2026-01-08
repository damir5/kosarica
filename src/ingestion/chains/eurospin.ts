/**
 * Eurospin Chain Adapter
 *
 * Adapter for parsing Eurospin retail chain price data files.
 * Eurospin uses CSV format with semicolon delimiter and UTF-8 encoding.
 * Store resolution is based on filename.
 *
 * Supports single-date discovery via setDiscoveryDate() method.
 * Discovery looks for local files in the data directory matching the date pattern.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CsvColumnMapping } from '../parsers/csv'
import type { DiscoveredFile, FetchedFile } from '../core/types'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * Column mapping for Eurospin CSV files.
 * Maps Eurospin's column names to NormalizedRow fields.
 */
const EUROSPIN_COLUMN_MAPPING: CsvColumnMapping = {
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
 * Alternative column mapping for Eurospin CSV files.
 * Some Eurospin exports may use abbreviated or different column names.
 */
const EUROSPIN_COLUMN_MAPPING_ALT: CsvColumnMapping = {
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
 * Eurospin chain adapter implementation.
 * Extends BaseCsvAdapter for common CSV parsing functionality.
 *
 * Supports date-based local file discovery via setDiscoveryDate() method.
 */
export class EurospinAdapter extends BaseCsvAdapter {
  /** Date to discover files for (YYYY-MM-DD format, set by CLI before discovery) */
  private discoveryDate: string | null = null

  constructor() {
    super({
      slug: 'eurospin',
      name: 'Eurospin',
      supportedTypes: ['csv'],
      chainConfig: CHAIN_CONFIGS.eurospin,
      columnMapping: EUROSPIN_COLUMN_MAPPING,
      alternativeColumnMapping: EUROSPIN_COLUMN_MAPPING_ALT,
      filenamePrefixPatterns: [
        /^Eurospin[_-]?/i,
        /^cjenik[_-]?/i,
        /^diskontna[_-]?/i,
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
   * Discover available Eurospin price files.
   *
   * Eurospin files are stored locally with naming patterns:
   * - Eurospin_store_XXX_YYYY-MM-DD.csv
   * - diskontna_prodavaonica-XXXXXX-...-DD.MM.YYYY-....csv
   *
   * Discovery searches the local data directory for matching files.
   *
   * @returns Array of discovered files (filtered by date if setDiscoveryDate was called)
   */
  async discover(): Promise<DiscoveredFile[]> {
    const discoveredFiles: DiscoveredFile[] = []

    // Use provided date or default to today
    const date = this.discoveryDate || new Date().toISOString().split('T')[0]

    // Look for local files in ./data/input/eurospin/ directory
    // (separate from ./data/ingestion/ to avoid overwriting source files)
    const dataDir = path.resolve('./data/input/eurospin')
    console.log(`[DEBUG] Scanning Eurospin local directory: ${dataDir}`)

    try {
      if (!fs.existsSync(dataDir)) {
        console.error(`Eurospin data directory not found: ${dataDir}`)
        return []
      }

      const files = fs.readdirSync(dataDir)

      for (const filename of files) {
        // Skip non-CSV files
        if (!filename.toLowerCase().endsWith('.csv')) {
          continue
        }

        // Try to extract date from various filename patterns
        let fileDate: string | null = null

        // Pattern 1: Eurospin_store_XXX_YYYY-MM-DD.csv
        const isoDateMatch = filename.match(/(\d{4}-\d{2}-\d{2})\.csv$/i)
        if (isoDateMatch) {
          fileDate = isoDateMatch[1]
        }

        // Pattern 2: ...DD.MM.YYYY... (European date format)
        if (!fileDate) {
          const euDateMatch = filename.match(/(\d{2})\.(\d{2})\.(\d{4})/)
          if (euDateMatch) {
            const [, day, month, year] = euDateMatch
            fileDate = `${year}-${month}-${day}`
          }
        }

        // Pattern 3: DDMMYYYY (compact date)
        if (!fileDate) {
          const compactDateMatch = filename.match(/(\d{2})(\d{2})(\d{4})/)
          if (compactDateMatch) {
            const [, day, month, year] = compactDateMatch
            fileDate = `${year}-${month}-${day}`
          }
        }

        // Filter by discovery date if set
        if (date && fileDate !== date) {
          continue
        }

        const filePath = path.join(dataDir, filename)
        const stats = fs.statSync(filePath)

        discoveredFiles.push({
          url: `file://${filePath}`,
          filename,
          type: 'csv',
          size: stats.size,
          lastModified: fileDate ? new Date(fileDate) : new Date(stats.mtime),
          metadata: {
            source: 'eurospin_local',
            discoveredAt: new Date().toISOString(),
            ...(fileDate && { portalDate: fileDate }),
          },
        })
      }

      return discoveredFiles
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Error discovering Eurospin files: ${errorMessage}`)
      console.error(`  Directory: ${dataDir}`)
      return []
    }
  }

  /**
   * Fetch a discovered Eurospin file.
   * For local files (file:// URLs), reads directly from filesystem.
   */
  async fetch(file: DiscoveredFile): Promise<FetchedFile> {
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
}

/**
 * Create a Eurospin adapter instance.
 */
export function createEurospinAdapter(): EurospinAdapter {
  return new EurospinAdapter()
}
