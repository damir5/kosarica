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
 * Column mapping for Lidl CSV files (Croatian headers).
 * Maps Lidl's column names to NormalizedRow fields.
 * Lidl may include multiple GTINs separated by semicolon in the barcode field.
 */
const LIDL_COLUMN_MAPPING: CsvColumnMapping = {
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
 * Alternative column mapping for Lidl CSV files (abbreviated headers).
 * Some Lidl exports may use abbreviated column names.
 */
const LIDL_COLUMN_MAPPING_ALT: CsvColumnMapping = {
  externalId: 'Art.br.',
  name: 'Naziv',
  category: 'Kat.',
  brand: 'Marka',
  unit: 'JM',
  unitQuantity: 'Kol.',
  price: 'Cijena',
  discountPrice: 'Akc. cijena',
  discountStart: 'Akc. od',
  discountEnd: 'Akc. do',
  barcodes: 'GTIN',
}

/**
 * Lidl chain adapter implementation.
 * Extends BaseCsvAdapter with custom GTIN handling and discovery logic.
 */
export class LidlAdapter extends BaseCsvAdapter {
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
   * Discover available Lidl price files.
   * Fetches the Lidl price portal and parses HTML for ZIP and CSV file links.
   * Lidl typically publishes daily ZIP files containing per-store CSVs.
   */
  async discover(): Promise<DiscoveredFile[]> {
    const baseUrl = this.config.baseUrl
    const discoveredFiles: DiscoveredFile[] = []

    try {
      const response = await fetch(baseUrl, {
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

      // Parse HTML to find ZIP file links (Lidl's primary format)
      const zipLinkPattern = /href=["']([^"']*\.zip(?:\?[^"']*)?)["']/gi
      let match: RegExpExecArray | null

      while ((match = zipLinkPattern.exec(html)) !== null) {
        const href = match[1]
        const fileUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString()
        const filename = this.extractFilenameFromUrl(fileUrl)

        // Extract date from filename if present (e.g., Lidl_2024-01-15.zip)
        const dateMatch = filename.match(/(\d{4}[-_]\d{2}[-_]\d{2})/)
        const fileDate = dateMatch ? dateMatch[1].replace(/_/g, '-') : null

        discoveredFiles.push({
          url: fileUrl,
          filename,
          type: 'zip',
          size: null,
          lastModified: fileDate ? new Date(fileDate) : null,
          metadata: {
            source: 'lidl_portal',
            discoveredAt: new Date().toISOString(),
            ...(fileDate && { fileDate }),
          },
        })
      }

      // Also look for direct CSV file links
      const csvLinkPattern = /href=["']([^"']*\.csv(?:\?[^"']*)?)["']/gi
      while ((match = csvLinkPattern.exec(html)) !== null) {
        const href = match[1]
        const fileUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString()
        const filename = this.extractFilenameFromUrl(fileUrl)

        discoveredFiles.push({
          url: fileUrl,
          filename,
          type: 'csv',
          size: null,
          lastModified: null,
          metadata: {
            source: 'lidl_portal',
            discoveredAt: new Date().toISOString(),
          },
        })
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
