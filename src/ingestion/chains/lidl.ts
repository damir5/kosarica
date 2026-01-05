/**
 * Lidl Chain Adapter
 *
 * Adapter for parsing Lidl retail chain price data files.
 * Lidl uses CSV format with comma delimiter and UTF-8 encoding.
 * Store resolution is based on filename (daily ZIP files -> fanout).
 * Handles multiple GTINs per SKU.
 */

import type {
  DiscoveredFile,
  NormalizedRow,
  NormalizedRowValidation,
  ParseResult,
} from '../core/types'
import type { CsvColumnMapping } from '../parsers/csv'
import { BaseCsvAdapter } from './base'
import { CHAIN_CONFIGS } from './config'

/**
 * Column mapping for Lidl CSV files (2026 format).
 * Maps Lidl's column names to NormalizedRow fields.
 * Lidl may include multiple GTINs separated by semicolon in the barcode field.
 *
 * Current columns (as of 2026):
 * NAZIV, ŠIFRA, NETO_KOLIČINA, JEDINICA_MJERE, MARKA, MALOPRODAJNA_CIJENA,
 * MPC_ZA_VRIJEME_POSEBNOG_OBLIKA_PRODAJE, NAJNIZA_CIJENA_U_POSLJ._30_DANA,
 * CIJENA_ZA_JEDINICU_MJERE, BARKOD, KATEGORIJA_PROIZVODA, Sidrena_cijena_na_...
 */
const LIDL_COLUMN_MAPPING: CsvColumnMapping = {
  externalId: 'ŠIFRA',
  name: 'NAZIV',
  category: 'KATEGORIJA_PROIZVODA',
  brand: 'MARKA',
  unit: 'JEDINICA_MJERE',
  unitQuantity: 'NETO_KOLIČINA',
  price: 'MALOPRODAJNA_CIJENA',
  discountPrice: 'MPC_ZA_VRIJEME_POSEBNOG_OBLIKA_PRODAJE',
  barcodes: 'BARKOD',
}

/**
 * Alternative column mapping for Lidl CSV files (legacy format).
 * Some older Lidl exports may use these column names.
 */
const LIDL_COLUMN_MAPPING_ALT: CsvColumnMapping = {
  externalId: 'Artikl',
  name: 'Naziv artikla',
  category: 'Kategorija',
  brand: 'Robna marka',
  unit: 'Jedinica mjere',
  unitQuantity: 'Količina',
  price: 'Cijena',
  discountPrice: 'Akcijska cijena',
  discountStart: 'Početak akcije',
  discountEnd: 'Završetak akcije',
  barcodes: 'GTIN',
}

/**
 * Lidl chain adapter implementation.
 * Extends BaseCsvAdapter with custom GTIN handling and discovery logic.
 *
 * Lidl portal: https://tvrtka.lidl.hr/cijene
 * Download URL pattern: https://tvrtka.lidl.hr/content/download/[DYNAMIC_ID]/fileupload/[FILENAME].zip
 * Filename format: Popis_cijena_po_trgovinama_na_dan_DD_MM_YYYY.zip
 */
export class LidlAdapter extends BaseCsvAdapter {
  /** Date to discover files for (YYYY-MM-DD format, set by CLI before discovery) */
  private discoveryDate: string | null = null

  constructor() {
    super({
      slug: 'lidl',
      name: 'Lidl',
      supportedTypes: ['csv', 'zip'],
      chainConfig: CHAIN_CONFIGS.lidl,
      columnMapping: LIDL_COLUMN_MAPPING,
      alternativeColumnMapping: LIDL_COLUMN_MAPPING_ALT,
      filenamePrefixPatterns: [
        /^Lidl[_-]?/i,
        /^Popis_cijena[_-]?/i,
        /^cjenik[_-]?/i,
        /^\d{4}[_-]\d{2}[_-]\d{2}[_-]?/, // Remove date prefix
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
   * Convert date from YYYY-MM-DD to DD_MM_YYYY format (Lidl filename format).
   */
  private formatDateForFilename(date: string): string {
    const [year, month, day] = date.split('-')
    return `${day}_${month}_${year}`
  }

  /**
   * Extract date from Lidl filename (DD_MM_YYYY) to YYYY-MM-DD format.
   */
  private extractDateFromFilename(filename: string): string | null {
    // Pattern: Popis_cijena_po_trgovinama_na_dan_DD_MM_YYYY.zip
    const match = filename.match(/(\d{2})_(\d{2})_(\d{4})\.zip$/i)
    if (match) {
      const [, day, month, year] = match
      return `${year}-${month}-${day}`
    }
    return null
  }

  /**
   * Discover available Lidl price files.
   *
   * Lidl's portal uses dynamic download IDs that must be parsed from the HTML:
   * - URL format: https://tvrtka.lidl.hr/cijene
   * - Download links: /content/download/[ID]/fileupload/Popis_cijena_po_trgovinama_na_dan_DD_MM_YYYY.zip
   *
   * @returns Array of discovered files (filtered by date if setDiscoveryDate was called)
   */
  async discover(): Promise<DiscoveredFile[]> {
    const discoveredFiles: DiscoveredFile[] = []
    const seenUrls = new Set<string>()

    try {
      const response = await fetch(this.config.baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PriceTracker/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })

      if (!response.ok) {
        console.error(`Failed to fetch Lidl portal: ${response.status} ${response.statusText}`)
        return []
      }

      const html = await response.text()

      // Extract download links matching Lidl's URL pattern
      // Pattern: href="(https://tvrtka.lidl.hr/content/download/\d+/fileupload/Popis_cijena[^"]+\.zip)"
      const downloadPattern = /href=["'](https:\/\/tvrtka\.lidl\.hr\/content\/download\/\d+\/fileupload\/([^"']+\.zip))["']/gi

      let match: RegExpExecArray | null
      while ((match = downloadPattern.exec(html)) !== null) {
        const fileUrl = match[1]
        const filename = match[2]

        // Skip duplicates
        if (seenUrls.has(fileUrl)) {
          continue
        }
        seenUrls.add(fileUrl)

        // Extract date from filename
        const fileDate = this.extractDateFromFilename(filename)

        // If discoveryDate is set, filter to only that date
        if (this.discoveryDate && fileDate !== this.discoveryDate) {
          continue
        }

        discoveredFiles.push({
          url: fileUrl,
          filename,
          type: 'zip',
          size: null,
          lastModified: fileDate ? new Date(fileDate) : null,
          metadata: {
            source: 'lidl_portal',
            discoveredAt: new Date().toISOString(),
            ...(fileDate && { portalDate: fileDate }),
          },
        })
      }

      // If using specific date and no exact match found, try relative URL pattern
      if (this.discoveryDate && discoveredFiles.length === 0) {
        // Try alternative pattern for relative URLs
        const relativePattern = /href=["'](\/content\/download\/\d+\/fileupload\/([^"']+\.zip))["']/gi

        while ((match = relativePattern.exec(html)) !== null) {
          const href = match[1]
          const filename = match[2]
          const fileUrl = new URL(href, this.config.baseUrl).toString()

          if (seenUrls.has(fileUrl)) {
            continue
          }
          seenUrls.add(fileUrl)

          const fileDate = this.extractDateFromFilename(filename)

          if (this.discoveryDate && fileDate !== this.discoveryDate) {
            continue
          }

          discoveredFiles.push({
            url: fileUrl,
            filename,
            type: 'zip',
            size: null,
            lastModified: fileDate ? new Date(fileDate) : null,
            metadata: {
              source: 'lidl_portal',
              discoveredAt: new Date().toISOString(),
              ...(fileDate && { portalDate: fileDate }),
            },
          })
        }
      }

      return discoveredFiles
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Error discovering Lidl files: ${errorMessage}`)
      return []
    }
  }

  /**
   * Override base extractFilenameFromUrl to use 'unknown.zip' as default.
   */
  protected override extractFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname
      const filename = pathname.split('/').pop() || 'unknown.zip'
      return filename.split('?')[0]
    } catch {
      return 'unknown.zip'
    }
  }

  /**
   * Post-process parse result to handle multiple GTINs.
   * Lidl may list multiple GTINs separated by semicolon or pipe.
   */
  protected postprocessResult(result: ParseResult): ParseResult {
    result.rows = result.rows.map((row) => this.normalizeMultipleGtins(row))
    return result
  }

  /**
   * Normalize multiple GTINs in a row.
   * Lidl may list multiple GTINs separated by semicolon or pipe.
   */
  private normalizeMultipleGtins(row: NormalizedRow): NormalizedRow {
    if (row.barcodes.length === 1) {
      // Check if single barcode contains multiple GTINs
      const barcode = row.barcodes[0]
      if (barcode.includes(';') || barcode.includes('|')) {
        const gtins = barcode
          .split(/[;|]/)
          .map((g) => g.trim())
          .filter((g) => g.length > 0)
        return { ...row, barcodes: gtins }
      }
    }
    return row
  }

  /**
   * Extract store identifier string from filename.
   * Lidl has special patterns for store identification.
   */
  protected extractStoreIdentifierFromFilename(filename: string): string {
    // Remove file extension
    const baseName = filename.replace(/\.(csv|CSV)$/, '')

    // Try to extract store ID from various Lidl filename patterns
    // Pattern 1: Lidl_DATE_STOREID (e.g., "Lidl_2024-01-15_42")
    const dateStoreMatch = baseName.match(/^Lidl[_-]?\d{4}[_-]\d{2}[_-]\d{2}[_-](.+)$/i)
    if (dateStoreMatch) {
      return dateStoreMatch[1]
    }

    // Pattern 2: Lidl_Poslovnica_LOCATION (e.g., "Lidl_Poslovnica_Zagreb_Ilica_123")
    const locationMatch = baseName.match(/^Lidl[_-]?Poslovnica[_-]?(.+)$/i)
    if (locationMatch) {
      return locationMatch[1]
    }

    // Pattern 3: Just Lidl_STOREID (e.g., "Lidl_42")
    const simpleMatch = baseName.match(/^Lidl[_-]?(\d+)$/i)
    if (simpleMatch) {
      return simpleMatch[1]
    }

    // Fall back to base class implementation
    return super.extractStoreIdentifierFromFilename(filename)
  }

  /**
   * Validate a normalized row according to Lidl-specific rules.
   * Uses stricter GTIN validation.
   */
  validateRow(row: NormalizedRow): NormalizedRowValidation {
    // Get base validation from parent
    const baseValidation = super.validateRow(row)
    const warnings = [...baseValidation.warnings]

    // Replace barcode warnings with Lidl-specific GTIN validation
    const gtinWarnings = warnings.filter(w => !w.includes('Invalid barcode format'))

    // GTIN validation - Lidl uses EAN-13 and EAN-8
    for (const barcode of row.barcodes) {
      if (!/^\d{8}$|^\d{13}$|^\d{14}$/.test(barcode)) {
        gtinWarnings.push(`Invalid GTIN format: ${barcode} (expected EAN-8, EAN-13, or GTIN-14)`)
      }
    }

    // Lidl products should typically have at least one GTIN
    if (row.barcodes.length === 0) {
      gtinWarnings.push('No GTIN/barcode found for product')
    }

    return {
      isValid: baseValidation.isValid,
      errors: baseValidation.errors,
      warnings: gtinWarnings,
    }
  }
}

/**
 * Create a Lidl adapter instance.
 */
export function createLidlAdapter(): LidlAdapter {
  return new LidlAdapter()
}
