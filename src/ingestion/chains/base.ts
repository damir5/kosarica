/**
 * Base Chain Adapter Classes
 *
 * Common base classes for chain adapters to reduce code duplication.
 * Provides shared implementations for CSV, XML, and XLSX adapters.
 */

import type {
  ChainAdapter,
  DiscoveredFile,
  FetchedFile,
  FileType,
  NormalizedRow,
  NormalizedRowValidation,
  ParseOptions,
  ParseResult,
  StoreIdentifier,
  StoreMetadata,
} from '../core/types'
import { computeSha256 } from '../core/storage'
import {
  RateLimiter,
  fetchWithRetry,
  type RateLimitConfig,
  DEFAULT_RATE_LIMIT_CONFIG,
} from '../core/rate-limit'
import { CsvParser, type CsvColumnMapping, type CsvParserOptions } from '../parsers/csv'
import { XmlParser, type XmlFieldMapping } from '../parsers/xml'
import type { ChainConfig } from './config'

/**
 * Configuration for base chain adapter.
 */
export interface BaseAdapterConfig {
  /** Chain slug (konzum, lidl, etc.) */
  slug: string
  /** Human-readable chain name */
  name: string
  /** Supported file types */
  supportedTypes: FileType[]
  /** Chain configuration from CHAIN_CONFIGS */
  chainConfig: ChainConfig
  /** Regex patterns to remove from filename when extracting store identifier */
  filenamePrefixPatterns?: RegExp[]
  /** File extension pattern (default: csv|CSV) */
  fileExtensionPattern?: RegExp
  /** Rate limit configuration overrides */
  rateLimitConfig?: Partial<RateLimitConfig>
}

/**
 * Abstract base class for all chain adapters.
 * Provides common implementations for fetch(), validateRow(), and store identifier extraction.
 */
export abstract class BaseChainAdapter implements ChainAdapter {
  readonly slug: string
  readonly name: string
  readonly supportedTypes: FileType[]

  protected config: ChainConfig
  protected filenamePrefixPatterns: RegExp[]
  protected fileExtensionPattern: RegExp
  protected rateLimiter: RateLimiter
  protected rateLimitConfig: RateLimitConfig

  constructor(adapterConfig: BaseAdapterConfig) {
    this.slug = adapterConfig.slug
    this.name = adapterConfig.name
    this.supportedTypes = adapterConfig.supportedTypes
    this.config = adapterConfig.chainConfig
    this.filenamePrefixPatterns = adapterConfig.filenamePrefixPatterns ?? [
      new RegExp(`^${adapterConfig.name}[_-]?`, 'i'),
      /^cjenik[_-]?/i,
    ]
    this.fileExtensionPattern = adapterConfig.fileExtensionPattern ?? /\.(csv|CSV)$/
    this.rateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG, ...adapterConfig.rateLimitConfig }
    this.rateLimiter = new RateLimiter(this.rateLimitConfig)
  }

  /**
   * Discover available price files.
   * Fetches the chain's price portal and parses HTML for file links.
   * Can be overridden in subclasses for chain-specific discovery logic.
   */
  async discover(): Promise<DiscoveredFile[]> {
    const baseUrl = this.config.baseUrl
    const discoveredFiles: DiscoveredFile[] = []

    console.log(`[DEBUG] Fetching ${this.name} portal: ${baseUrl}`)

    try {
      const response = await fetch(baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PriceTracker/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })

      if (!response.ok) {
        console.error(`Failed to fetch ${this.name} portal: ${response.status} ${response.statusText}`)
        console.error(`  URL: ${baseUrl}`)
        return []
      }

      const html = await response.text()

      // Get file extensions to look for based on supported types
      const extensions = this.getDiscoverableExtensions()
      const extensionPattern = extensions.join('|')
      const linkPattern = new RegExp(`href=["']([^"']*\\.(${extensionPattern})(?:\\?[^"']*)?)["']`, 'gi')

      let match: RegExpExecArray | null
      while ((match = linkPattern.exec(html)) !== null) {
        const href = match[1]
        const fileUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString()
        const filename = this.extractFilenameFromUrl(fileUrl)
        const fileType = this.detectFileType(filename)

        discoveredFiles.push({
          url: fileUrl,
          filename,
          type: fileType,
          size: null,
          lastModified: null,
          metadata: {
            source: `${this.slug}_portal`,
            discoveredAt: new Date().toISOString(),
          },
        })
      }

      return discoveredFiles
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Error discovering ${this.name} files: ${errorMessage}`)
      console.error(`  URL: ${baseUrl}`)
      return []
    }
  }

  /**
   * Get file extensions to look for during discovery.
   * Override in subclasses for chain-specific extensions.
   */
  protected getDiscoverableExtensions(): string[] {
    return this.supportedTypes.flatMap(type => {
      switch (type) {
        case 'csv': return ['csv']
        case 'xlsx': return ['xlsx', 'xls']
        case 'xml': return ['xml']
        case 'zip': return ['zip']
        default: return []
      }
    })
  }

  /**
   * Extract filename from URL, handling query parameters.
   */
  protected extractFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname
      const filename = pathname.split('/').pop() || `unknown.${this.supportedTypes[0]}`
      return filename.split('?')[0]
    } catch {
      return `unknown.${this.supportedTypes[0]}`
    }
  }

  /**
   * Detect file type from filename extension.
   */
  protected detectFileType(filename: string): FileType {
    const lowerFilename = filename.toLowerCase()
    if (lowerFilename.endsWith('.csv')) return 'csv'
    if (lowerFilename.endsWith('.xlsx') || lowerFilename.endsWith('.xls')) return 'xlsx'
    if (lowerFilename.endsWith('.xml')) return 'xml'
    if (lowerFilename.endsWith('.zip')) return 'zip'
    return this.supportedTypes[0] // Default to first supported type
  }

  /**
   * Fetch a discovered file with rate limiting and retry logic.
   * Common implementation that works for most chains.
   */
  async fetch(file: DiscoveredFile): Promise<FetchedFile> {
    const response = await fetchWithRetry(
      file.url,
      this.rateLimiter,
      this.rateLimitConfig,
    )

    const content = await response.arrayBuffer()
    const hash = await computeSha256(content)

    return {
      discovered: file,
      content,
      hash,
    }
  }

  /**
   * Parse file content into normalized rows.
   * Must be implemented by subclasses.
   */
  abstract parse(
    content: ArrayBuffer,
    filename: string,
    options?: ParseOptions,
  ): Promise<ParseResult>

  /**
   * Extract store identifier from filename.
   * Uses common pattern for filename-based store resolution.
   */
  extractStoreIdentifier(file: DiscoveredFile): StoreIdentifier | null {
    const identifier = this.extractStoreIdentifierFromFilename(file.filename)
    if (!identifier) {
      return null
    }

    return {
      type: 'filename_code',
      value: identifier,
    }
  }

  /**
   * Extract store identifier string from filename.
   * Removes common prefixes and file extension.
   */
  protected extractStoreIdentifierFromFilename(filename: string): string {
    // Remove file extension
    let baseName = filename.replace(this.fileExtensionPattern, '')

    // Remove common prefixes
    for (const pattern of this.filenamePrefixPatterns) {
      baseName = baseName.replace(pattern, '')
    }

    const cleanName = baseName.trim()

    // If nothing left, use full basename
    return cleanName || filename.replace(this.fileExtensionPattern, '')
  }

  /**
   * Validate a normalized row according to common rules.
   * Provides base validation that subclasses can extend.
   */
  validateRow(row: NormalizedRow): NormalizedRowValidation {
    const errors: string[] = []
    const warnings: string[] = []

    // Required field validation
    if (!row.name || row.name.trim() === '') {
      errors.push('Missing product name')
    }

    if (row.price <= 0) {
      errors.push('Price must be positive')
    }

    // Common validations
    if (row.price > 100000000) {
      // > 1,000,000 EUR seems unlikely
      warnings.push('Price seems unusually high')
    }

    if (row.discountPrice !== null && row.discountPrice >= row.price) {
      warnings.push('Discount price is not less than regular price')
    }

    // Barcode validation
    for (const barcode of row.barcodes) {
      if (!/^\d{8,14}$/.test(barcode)) {
        warnings.push(`Invalid barcode format: ${barcode}`)
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Extract store metadata from file for auto-registration.
   * Default implementation returns a basic name from the store identifier.
   * Override in subclasses for chain-specific metadata extraction.
   */
  extractStoreMetadata(file: DiscoveredFile): StoreMetadata | null {
    const identifier = this.extractStoreIdentifierFromFilename(file.filename)
    if (!identifier) {
      return null
    }

    return {
      name: `${this.name} ${identifier}`,
    }
  }
}

/**
 * Configuration for CSV-based chain adapters.
 */
export interface CsvAdapterConfig extends BaseAdapterConfig {
  /** Primary column mapping */
  columnMapping: CsvColumnMapping
  /** Alternative column mapping (for files with different headers) */
  alternativeColumnMapping?: CsvColumnMapping
}

/**
 * Base class for CSV-based chain adapters.
 * Handles common CSV parsing logic with support for multiple column mappings.
 */
export abstract class BaseCsvAdapter extends BaseChainAdapter {
  protected csvParser: CsvParser
  protected csvConfig: NonNullable<ChainConfig['csv']>
  protected columnMapping: CsvColumnMapping
  protected alternativeColumnMapping?: CsvColumnMapping

  constructor(adapterConfig: CsvAdapterConfig) {
    super({
      ...adapterConfig,
      fileExtensionPattern: /\.(csv|CSV)$/,
    })

    this.columnMapping = adapterConfig.columnMapping
    this.alternativeColumnMapping = adapterConfig.alternativeColumnMapping

    // Initialize CSV parser with chain-specific configuration
    if (!this.config.csv) {
      throw new Error(`${this.name} adapter requires CSV configuration but none was provided`)
    }
    this.csvConfig = this.config.csv
    this.csvParser = new CsvParser({
      delimiter: this.csvConfig.delimiter,
      encoding: this.csvConfig.encoding,
      hasHeader: this.csvConfig.hasHeader,
      columnMapping: this.columnMapping,
      skipEmptyRows: true,
    })
  }

  /**
   * Parse CSV content into normalized rows.
   * Tries primary column mapping first, then alternative if no valid rows.
   */
  async parse(
    content: ArrayBuffer,
    filename: string,
    options?: ParseOptions,
  ): Promise<ParseResult> {
    // Preprocess content if needed (can be overridden by subclasses)
    const processedContent = this.preprocessContent(content)

    // Extract store identifier from filename to use as default
    const storeIdentifier = this.extractStoreIdentifierFromFilename(filename)

    // Get parser options for primary mapping
    const parserOptions = this.getParserOptions(storeIdentifier)

    // Try parsing with primary column mapping first
    this.csvParser.setOptions({
      columnMapping: this.columnMapping,
      ...parserOptions,
    })

    let result = await this.csvParser.parse(processedContent, filename, options)

    // If no valid rows and we have alternative mapping, try that
    if (result.validRows === 0 && result.errors.length > 0 && this.alternativeColumnMapping) {
      this.csvParser.setOptions({
        columnMapping: this.alternativeColumnMapping,
        ...parserOptions,
      })
      result = await this.csvParser.parse(processedContent, filename, options)
    }

    // Post-process results if needed (can be overridden by subclasses)
    return this.postprocessResult(result)
  }

  /**
   * Preprocess content before parsing.
   * Override in subclasses to handle chain-specific formatting issues.
   */
  protected preprocessContent(content: ArrayBuffer): ArrayBuffer {
    return content
  }

  /**
   * Get additional parser options.
   * Override in subclasses to customize parser behavior.
   */
  protected getParserOptions(storeIdentifier: string): Partial<CsvParserOptions> {
    return {
      defaultStoreIdentifier: storeIdentifier,
    }
  }

  /**
   * Post-process parse result.
   * Override in subclasses to modify parsed rows.
   */
  protected postprocessResult(result: ParseResult): ParseResult {
    return result
  }
}

/**
 * Configuration for XML-based chain adapters.
 */
export interface XmlAdapterConfig extends BaseAdapterConfig {
  /** Primary field mapping */
  fieldMapping: XmlFieldMapping
  /** Alternative field mapping (for files with different element names) */
  alternativeFieldMapping?: XmlFieldMapping
  /** Default items path in XML structure */
  defaultItemsPath?: string
  /** List of possible item paths to try */
  itemPaths?: string[]
}

/**
 * Base class for XML-based chain adapters.
 * Handles common XML parsing logic with support for multiple field mappings.
 */
export abstract class BaseXmlAdapter extends BaseChainAdapter {
  protected xmlParser: XmlParser
  protected fieldMapping: XmlFieldMapping
  protected alternativeFieldMapping?: XmlFieldMapping
  protected itemPaths: string[]

  constructor(adapterConfig: XmlAdapterConfig) {
    super({
      ...adapterConfig,
      fileExtensionPattern: /\.(xml|XML)$/,
    })

    this.fieldMapping = adapterConfig.fieldMapping
    this.alternativeFieldMapping = adapterConfig.alternativeFieldMapping
    this.itemPaths = adapterConfig.itemPaths ?? [
      'products.product',
      'Products.Product',
      'items.item',
      'Items.Item',
      'data.product',
      'Data.Product',
      'Cjenik.Proizvod',
      'cjenik.proizvod',
    ]

    // Initialize XML parser with default configuration
    this.xmlParser = new XmlParser({
      itemsPath: adapterConfig.defaultItemsPath ?? 'products.product',
      fieldMapping: this.fieldMapping,
    })
  }

  /**
   * Parse XML content into normalized rows.
   * Tries multiple item paths and field mappings to find valid data.
   */
  async parse(
    content: ArrayBuffer,
    filename: string,
    options?: ParseOptions,
  ): Promise<ParseResult> {
    // Extract store identifier from filename to use as default
    const storeIdentifier = this.extractStoreIdentifierFromFilename(filename)

    // Try with primary field mapping first
    for (const itemsPath of this.itemPaths) {
      this.xmlParser.setOptions({
        itemsPath,
        fieldMapping: this.fieldMapping,
        defaultStoreIdentifier: storeIdentifier,
      })

      const result = await this.xmlParser.parse(content, filename, options)

      if (result.validRows > 0) {
        return result
      }
    }

    // Try alternative field mapping if available
    if (this.alternativeFieldMapping) {
      for (const itemsPath of this.itemPaths) {
        this.xmlParser.setOptions({
          itemsPath,
          fieldMapping: this.alternativeFieldMapping,
          defaultStoreIdentifier: storeIdentifier,
        })

        const result = await this.xmlParser.parse(content, filename, options)

        if (result.validRows > 0) {
          return result
        }
      }
    }

    // Return last attempt result (will contain errors)
    return this.xmlParser.parse(content, filename, options)
  }

  /**
   * Extract store identifier from XML file.
   * For XML files, the store identifier is typically embedded in the content,
   * but we can also try to extract from filename as fallback.
   */
  extractStoreIdentifier(file: DiscoveredFile): StoreIdentifier | null {
    // Try to extract from metadata if set during discovery
    if (file.metadata['storeId']) {
      return {
        type: 'portal_id',
        value: file.metadata['storeId'],
      }
    }

    // Try to extract from filename as fallback
    const identifier = this.extractStoreIdentifierFromFilename(file.filename)
    if (identifier) {
      return {
        type: 'filename_code',
        value: identifier,
      }
    }

    return null
  }

  /**
   * Extract store identifier string from filename for XML files.
   * Handles XML-specific patterns.
   */
  protected override extractStoreIdentifierFromFilename(filename: string): string {
    // Remove file extension
    const baseName = filename.replace(this.fileExtensionPattern, '')

    // Remove common prefixes
    let cleanName = baseName
    for (const pattern of this.filenamePrefixPatterns) {
      cleanName = cleanName.replace(pattern, '')
    }
    cleanName = cleanName.trim()

    // Try to extract store ID from patterns like "store_123" or "poslovnica_456"
    const storeIdMatch = cleanName.match(/(?:store|poslovnica|trgovina)[_-]?(\d+)/i)
    if (storeIdMatch) {
      return storeIdMatch[1]
    }

    // If nothing matches, use the clean name or fallback to basename
    return cleanName || filename.replace(this.fileExtensionPattern, '')
  }
}
