/**
 * XML Parser Module
 *
 * Parser for XML files using fast-xml-parser.
 * Supports mapping XML elements to NormalizedRow fields.
 * Handles Studenac/Trgocentar and similar retail XML formats.
 */

import { XMLParser, type X2jOptions } from 'fast-xml-parser'
import type { FileType, NormalizedRow } from '../core/types'
import { Parser, type ParseContext } from './base'

/**
 * Field mapping from NormalizedRow field to XML path.
 * Paths use dot notation for nested elements (e.g., "product.price.value").
 * Can also be a function for custom extraction.
 */
export interface XmlFieldMapping {
  /** Path to store identifier element */
  storeIdentifier?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to external ID element */
  externalId?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to name element (required) */
  name: string | ((item: Record<string, unknown>) => string | null)
  /** Path to description element */
  description?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to category element */
  category?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to subcategory element */
  subcategory?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to brand element */
  brand?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to unit element */
  unit?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to unit quantity element */
  unitQuantity?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to price element (required) */
  price: string | ((item: Record<string, unknown>) => string | null)
  /** Path to discount price element */
  discountPrice?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to discount start date element */
  discountStart?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to discount end date element */
  discountEnd?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to barcodes element (comma-separated or array) */
  barcodes?: string | ((item: Record<string, unknown>) => string[] | null)
  /** Path to image URL element */
  imageUrl?: string | ((item: Record<string, unknown>) => string | null)
  // Croatian price transparency fields
  /** Path to unit price element */
  unitPrice?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to unit price base quantity element */
  unitPriceBaseQuantity?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to unit price base unit element */
  unitPriceBaseUnit?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to lowest price in last 30 days element */
  lowestPrice30d?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to anchor price (sidrena cijena) element */
  anchorPrice?: string | ((item: Record<string, unknown>) => string | null)
  /** Path to anchor price date element */
  anchorPriceAsOf?: string | ((item: Record<string, unknown>) => string | null)
}

/**
 * XML parser options.
 */
export interface XmlParserOptions {
  /** Path to the array of items in the XML (e.g., "products.product", "items.item") */
  itemsPath: string
  /** Field mapping configuration */
  fieldMapping: XmlFieldMapping
  /** Default store identifier if not in XML */
  defaultStoreIdentifier?: string
  /** XML parser options for fast-xml-parser */
  parserOptions?: Partial<X2jOptions>
  /** File encoding */
  encoding?: string
  /** Attribute prefix in parsed output (default: '@_') */
  attributePrefix?: string
}

/**
 * XML Parser implementation.
 * Parses XML files with configurable item path and field mapping.
 */
export class XmlParser extends Parser {
  readonly fileType: FileType = 'xml'
  readonly extensions: string[] = ['.xml']

  private options: XmlParserOptions

  constructor(options: XmlParserOptions) {
    super()
    this.options = options
  }

  /**
   * Set parser options.
   * @param options - Options to merge with existing
   */
  setOptions(options: Partial<XmlParserOptions>): void {
    this.options = { ...this.options, ...options }
  }

  /**
   * Parse XML content into normalized rows.
   */
  protected async parseRows(
    context: ParseContext,
  ): Promise<{ rows: NormalizedRow[]; totalRows: number }> {
    const opts = this.options

    // Decode content
    const content = this.decodeContent(context.content, opts.encoding)

    // Configure fast-xml-parser
    const parserOptions: X2jOptions = {
      ignoreAttributes: false,
      attributeNamePrefix: opts.attributePrefix ?? '@_',
      parseAttributeValue: true,
      parseTagValue: true,
      trimValues: true,
      ...opts.parserOptions,
    }

    const xmlParser = new XMLParser(parserOptions)

    let parsed: Record<string, unknown>
    try {
      parsed = xmlParser.parse(content) as Record<string, unknown>
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      context.addError({
        field: null,
        message: `XML parsing error: ${message}`,
        originalValue: content.substring(0, 200),
      })
      return { rows: [], totalRows: 0 }
    }

    // Navigate to items array
    const items = this.getValueAtPath(parsed, opts.itemsPath)

    if (items === null || items === undefined) {
      context.addWarning({
        field: null,
        message: `No items found at path "${opts.itemsPath}"`,
      })
      return { rows: [], totalRows: 0 }
    }

    // Ensure items is an array
    const itemsArray = Array.isArray(items) ? items : [items]

    if (itemsArray.length === 0) {
      context.addWarning({ field: null, message: 'XML file contains no items' })
      return { rows: [], totalRows: 0 }
    }

    const rows: NormalizedRow[] = []
    const totalRows = itemsArray.length

    for (let i = 0; i < itemsArray.length; i++) {
      const item = itemsArray[i] as Record<string, unknown>
      const rowNumber = i + 1 // 1-based for user-facing

      const normalizedRow = this.mapItemToNormalized(
        item,
        rowNumber,
        opts.fieldMapping,
        opts.defaultStoreIdentifier ?? '',
        context,
      )

      if (normalizedRow) {
        // Validate required fields
        const validationErrors = this.validateRequiredFields(normalizedRow)
        if (validationErrors.length > 0) {
          for (const error of validationErrors) {
            context.addError({
              rowNumber,
              field: null,
              message: error,
              originalValue: JSON.stringify(item).substring(0, 500),
            })
          }
          if (context.options.skipInvalid) {
            continue
          }
        }
        rows.push(normalizedRow)
      }
    }

    return { rows, totalRows }
  }

  /**
   * Get a value from an object using dot notation path.
   * @param obj - The object to traverse
   * @param path - Dot notation path (e.g., "products.product")
   * @returns The value at the path, or null if not found
   */
  private getValueAtPath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined) {
        return null
      }
      if (typeof current !== 'object') {
        return null
      }
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  /**
   * Extract a string value from an item using field mapping.
   * @param item - The XML item object
   * @param mapping - String path or extraction function
   * @returns Extracted string value or null
   */
  private extractStringValue(
    item: Record<string, unknown>,
    mapping: string | ((item: Record<string, unknown>) => string | null) | undefined,
  ): string | null {
    if (mapping === undefined) {
      return null
    }

    if (typeof mapping === 'function') {
      return mapping(item)
    }

    const value = this.getValueAtPath(item, mapping)
    if (value === null || value === undefined) {
      return null
    }

    // Handle objects that might have text content
    if (typeof value === 'object' && value !== null) {
      // Try common text content keys
      const textValue =
        (value as Record<string, unknown>)['#text'] ??
        (value as Record<string, unknown>)['_text'] ??
        (value as Record<string, unknown>)['_']
      if (textValue !== undefined) {
        return String(textValue).trim() || null
      }
      return null
    }

    return String(value).trim() || null
  }

  /**
   * Extract barcodes array from an item.
   * @param item - The XML item object
   * @param mapping - String path or extraction function
   * @returns Array of barcodes
   */
  private extractBarcodes(
    item: Record<string, unknown>,
    mapping: string | ((item: Record<string, unknown>) => string[] | null) | undefined,
  ): string[] {
    if (mapping === undefined) {
      return []
    }

    if (typeof mapping === 'function') {
      return mapping(item) ?? []
    }

    const value = this.getValueAtPath(item, mapping)
    if (value === null || value === undefined) {
      return []
    }

    // Handle array of barcodes
    if (Array.isArray(value)) {
      return value.map((v) => String(v).trim()).filter((v) => v !== '')
    }

    // Handle comma-separated string
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v !== '')
    }

    // Single barcode
    return [String(value).trim()].filter((v) => v !== '')
  }

  /**
   * Map an XML item to NormalizedRow.
   */
  private mapItemToNormalized(
    item: Record<string, unknown>,
    rowNumber: number,
    mapping: XmlFieldMapping,
    defaultStoreIdentifier: string,
    context: ParseContext,
  ): NormalizedRow | null {
    // Extract name (required)
    const name = this.extractStringValue(item, mapping.name)

    // Extract and parse price
    const priceStr = this.extractStringValue(item, mapping.price)
    let price = 0
    if (priceStr) {
      price = this.parsePrice(priceStr)
      if (isNaN(price)) {
        context.addError({
          rowNumber,
          field: 'price',
          message: 'Invalid price value',
          originalValue: priceStr,
        })
        price = 0
      }
    }

    // Extract discount price
    let discountPrice: number | null = null
    const discountPriceStr = this.extractStringValue(item, mapping.discountPrice)
    if (discountPriceStr) {
      discountPrice = this.parsePrice(discountPriceStr)
      if (isNaN(discountPrice)) {
        context.addWarning({
          rowNumber,
          field: 'discountPrice',
          message: 'Invalid discount price value, ignoring',
        })
        discountPrice = null
      }
    }

    // Extract dates
    const discountStart = this.parseDate(
      this.extractStringValue(item, mapping.discountStart),
    )
    const discountEnd = this.parseDate(
      this.extractStringValue(item, mapping.discountEnd),
    )

    // Extract barcodes
    const barcodes = this.extractBarcodes(item, mapping.barcodes)

    // Get store identifier
    const storeIdentifier =
      this.extractStringValue(item, mapping.storeIdentifier) ?? defaultStoreIdentifier

    // Parse price transparency fields
    let unitPriceCents: number | null = null
    const unitPriceStr = this.extractStringValue(item, mapping.unitPrice)
    if (unitPriceStr) {
      unitPriceCents = this.parsePrice(unitPriceStr)
      if (isNaN(unitPriceCents)) {
        context.addWarning({
          rowNumber,
          field: 'unitPrice',
          message: 'Invalid unit price value, ignoring',
        })
        unitPriceCents = null
      }
    }

    let lowestPrice30dCents: number | null = null
    const lowestPrice30dStr = this.extractStringValue(item, mapping.lowestPrice30d)
    if (lowestPrice30dStr) {
      lowestPrice30dCents = this.parsePrice(lowestPrice30dStr)
      if (isNaN(lowestPrice30dCents)) {
        context.addWarning({
          rowNumber,
          field: 'lowestPrice30d',
          message: 'Invalid lowest price in 30 days value, ignoring',
        })
        lowestPrice30dCents = null
      }
    }

    let anchorPriceCents: number | null = null
    const anchorPriceStr = this.extractStringValue(item, mapping.anchorPrice)
    if (anchorPriceStr) {
      anchorPriceCents = this.parsePrice(anchorPriceStr)
      if (isNaN(anchorPriceCents)) {
        context.addWarning({
          rowNumber,
          field: 'anchorPrice',
          message: 'Invalid anchor price value, ignoring',
        })
        anchorPriceCents = null
      }
    }

    const anchorPriceAsOf = this.parseDate(
      this.extractStringValue(item, mapping.anchorPriceAsOf),
    )

    const row: NormalizedRow = {
      storeIdentifier,
      externalId: this.extractStringValue(item, mapping.externalId),
      name: name ?? '',
      description: this.extractStringValue(item, mapping.description),
      category: this.extractStringValue(item, mapping.category),
      subcategory: this.extractStringValue(item, mapping.subcategory),
      brand: this.extractStringValue(item, mapping.brand),
      unit: this.extractStringValue(item, mapping.unit),
      unitQuantity: this.extractStringValue(item, mapping.unitQuantity),
      price,
      discountPrice,
      discountStart,
      discountEnd,
      barcodes,
      imageUrl: this.extractStringValue(item, mapping.imageUrl),
      rowNumber,
      rawData: JSON.stringify(item),
      // Croatian price transparency fields
      unitPriceCents,
      unitPriceBaseQuantity: this.extractStringValue(item, mapping.unitPriceBaseQuantity),
      unitPriceBaseUnit: this.extractStringValue(item, mapping.unitPriceBaseUnit),
      lowestPrice30dCents,
      anchorPriceCents,
      anchorPriceAsOf,
    }

    return row
  }

  /**
   * Parse a price string to cents (integer).
   * Handles various formats: "12.99", "12,99", "1.299,00"
   */
  private parsePrice(value: string): number {
    // Remove currency symbols and whitespace
    let cleaned = value.replace(/[€$£\s]/g, '')

    // Determine decimal separator
    const lastDot = cleaned.lastIndexOf('.')
    const lastComma = cleaned.lastIndexOf(',')

    if (lastComma > lastDot) {
      // European format: 1.234,56 -> comma is decimal
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    } else if (lastDot > lastComma) {
      // US format: 1,234.56 -> just remove commas
      cleaned = cleaned.replace(/,/g, '')
    }

    const parsed = parseFloat(cleaned)
    if (isNaN(parsed)) {
      return NaN
    }

    // Convert to cents
    return Math.round(parsed * 100)
  }

  /**
   * Parse a date string to Date object.
   * Supports various formats: YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY
   */
  private parseDate(value: string | null): Date | null {
    if (!value) {
      return null
    }

    // Try ISO format first (YYYY-MM-DD)
    const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (isoMatch) {
      const date = new Date(
        parseInt(isoMatch[1]),
        parseInt(isoMatch[2]) - 1,
        parseInt(isoMatch[3]),
      )
      return isNaN(date.getTime()) ? null : date
    }

    // European format (DD.MM.YYYY or DD/MM/YYYY)
    const euMatch = value.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/)
    if (euMatch) {
      const date = new Date(
        parseInt(euMatch[3]),
        parseInt(euMatch[2]) - 1,
        parseInt(euMatch[1]),
      )
      return isNaN(date.getTime()) ? null : date
    }

    return null
  }
}

/**
 * Create an XML parser configured for common retail XML formats.
 * @param itemsPath - Path to items array in XML
 * @param fieldMapping - Field mapping configuration
 * @param defaultStoreIdentifier - Default store identifier
 * @returns Configured XmlParser instance
 */
export function createXmlParser(
  itemsPath: string,
  fieldMapping: XmlFieldMapping,
  defaultStoreIdentifier?: string,
): XmlParser {
  return new XmlParser({
    itemsPath,
    fieldMapping,
    defaultStoreIdentifier,
  })
}

/**
 * Detect the items path in an XML document.
 * Searches for common patterns like "products.product", "items.item", etc.
 * @param content - XML content as string
 * @returns Detected items path, or null if not found
 */
export function detectItemsPath(content: string): string | null {
  const parserOptions: X2jOptions = {
    ignoreAttributes: false,
    parseTagValue: false,
  }

  const xmlParser = new XMLParser(parserOptions)

  let parsed: Record<string, unknown>
  try {
    parsed = xmlParser.parse(content) as Record<string, unknown>
  } catch {
    return null
  }

  // Common patterns for item containers
  const patterns = [
    'products.product',
    'items.item',
    'catalog.product',
    'data.item',
    'data.product',
    'root.product',
    'root.item',
    'Products.Product',
    'Items.Item',
  ]

  for (const pattern of patterns) {
    const parts = pattern.split('.')
    let current: unknown = parsed

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        current = null
        break
      }
      const parent = current as Record<string, unknown>
      // Try exact match
      current = parent[part]
      // Try case-insensitive match if exact fails
      if (current === undefined) {
        const keys = Object.keys(parent)
        const matchingKey = keys.find((k) => k.toLowerCase() === part.toLowerCase())
        if (matchingKey) {
          current = parent[matchingKey]
        }
      }
    }

    if (current !== null && current !== undefined) {
      return pattern
    }
  }

  // Try to find any array in the first two levels
  const findArray = (
    obj: Record<string, unknown>,
    path: string[] = [],
    depth = 0,
  ): string | null => {
    if (depth > 2) return null

    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value) && value.length > 0) {
        return [...path, key].join('.')
      }
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const found = findArray(value as Record<string, unknown>, [...path, key], depth + 1)
        if (found) return found
      }
    }
    return null
  }

  return findArray(parsed)
}
