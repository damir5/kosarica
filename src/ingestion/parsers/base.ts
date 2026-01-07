/**
 * Base Parser Module
 *
 * Abstract base class for parsing retail chain data files.
 * Provides common error handling and result building utilities.
 */

import type {
  FileType,
  NormalizedRow,
  ParseError,
  ParseOptions,
  ParseResult,
  ParseWarning,
} from '../core/types'

/**
 * Context passed to the parseRows implementation.
 */
export interface ParseContext {
  /** File content as ArrayBuffer */
  content: ArrayBuffer
  /** Original filename for type detection and metadata extraction */
  filename: string
  /** Parse options */
  options: ParseOptions
  /** Helper to add an error */
  addError: (error: Omit<ParseError, 'rowNumber'> & { rowNumber?: number | null }) => void
  /** Helper to add a warning */
  addWarning: (warning: Omit<ParseWarning, 'rowNumber'> & { rowNumber?: number | null }) => void
}

/**
 * Abstract base class for file parsers.
 * Each file format (CSV, XML, XLSX) extends this class.
 */
export abstract class Parser {
  /** File type this parser handles */
  abstract readonly fileType: FileType

  /** File extensions this parser supports (e.g., ['.csv'], ['.xml'], ['.xlsx']) */
  abstract readonly extensions: string[]

  /**
   * Check if this parser can handle the given filename.
   * @param filename - The filename to check
   * @returns true if this parser can handle the file
   */
  canParse(filename: string): boolean {
    const lower = filename.toLowerCase()
    return this.extensions.some((ext) => lower.endsWith(ext))
  }

  /**
   * Parse file content into normalized rows.
   * @param content - File content as ArrayBuffer
   * @param filename - Original filename
   * @param options - Parse options
   * @returns Parse result with rows, errors, and warnings
   */
  async parse(
    content: ArrayBuffer,
    filename: string,
    options: ParseOptions = {},
  ): Promise<ParseResult> {
    const errors: ParseError[] = []
    const warnings: ParseWarning[] = []

    const context: ParseContext = {
      content,
      filename,
      options,
      addError: (error) => {
        errors.push({
          rowNumber: error.rowNumber ?? null,
          field: error.field,
          message: error.message,
          originalValue: error.originalValue,
        })
      },
      addWarning: (warning) => {
        warnings.push({
          rowNumber: warning.rowNumber ?? null,
          field: warning.field ?? null,
          message: warning.message,
        })
      },
    }

    let rows: NormalizedRow[]
    let totalRows: number

    try {
      const result = await this.parseRows(context)
      rows = result.rows
      totalRows = result.totalRows
    } catch (err) {
      // Catch any unexpected errors during parsing
      const message = err instanceof Error ? err.message : String(err)
      context.addError({
        field: null,
        message: `Parser error: ${message}`,
        originalValue: null,
      })
      return {
        rows: [],
        errors,
        warnings,
        totalRows: 0,
        validRows: 0,
      }
    }

    // Apply limit if specified
    const finalRows = options.limit != null ? rows.slice(0, options.limit) : rows

    return {
      rows: finalRows,
      errors,
      warnings,
      totalRows,
      validRows: finalRows.length,
    }
  }

  /**
   * Implementation-specific parsing logic.
   * Subclasses must implement this method to parse their specific format.
   *
   * @param context - Parse context with content, options, and error helpers
   * @returns Parsed rows and total row count
   */
  protected abstract parseRows(
    context: ParseContext,
  ): Promise<{ rows: NormalizedRow[]; totalRows: number }>

  /**
   * Create a parse error object.
   * @param message - Error message
   * @param options - Optional error details
   * @returns ParseError object
   */
  protected createError(
    message: string,
    options: {
      rowNumber?: number | null
      field?: string | null
      originalValue?: string | null
    } = {},
  ): ParseError {
    return {
      rowNumber: options.rowNumber ?? null,
      field: options.field ?? null,
      message,
      originalValue: options.originalValue ?? null,
    }
  }

  /**
   * Create a parse warning object.
   * @param message - Warning message
   * @param options - Optional warning details
   * @returns ParseWarning object
   */
  protected createWarning(
    message: string,
    options: {
      rowNumber?: number | null
      field?: string | null
    } = {},
  ): ParseWarning {
    return {
      rowNumber: options.rowNumber ?? null,
      field: options.field ?? null,
      message,
    }
  }

  /**
   * Convert ArrayBuffer to string with encoding detection.
   * Defaults to UTF-8 but handles BOM markers for UTF-16.
   * @param buffer - The ArrayBuffer to decode
   * @param encoding - Optional encoding override
   * @returns Decoded string
   */
  protected decodeContent(buffer: ArrayBuffer, encoding?: string): string {
    const bytes = new Uint8Array(buffer)

    // Detect BOM markers
    if (!encoding) {
      // UTF-16 LE BOM
      if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        encoding = 'utf-16le'
      }
      // UTF-16 BE BOM
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        encoding = 'utf-16be'
      }
      // UTF-8 BOM or default
      else {
        encoding = 'utf-8'
      }
    }

    const decoder = new TextDecoder(encoding)
    return decoder.decode(buffer)
  }

  /**
   * Create an empty normalized row with default values.
   * Useful as a starting point for row construction.
   * @param rowNumber - The row number in the source
   * @param storeIdentifier - The store identifier
   * @returns A NormalizedRow with default values
   */
  protected createEmptyRow(rowNumber: number, storeIdentifier: string): NormalizedRow {
    return {
      storeIdentifier,
      externalId: null,
      name: '',
      description: null,
      category: null,
      subcategory: null,
      brand: null,
      unit: null,
      unitQuantity: null,
      price: 0,
      discountPrice: null,
      discountStart: null,
      discountEnd: null,
      barcodes: [],
      imageUrl: null,
      rowNumber,
      rawData: '',
      // Croatian price transparency fields
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }
  }

  /**
   * Validate that required fields are present in a row.
   * Returns validation errors for missing/invalid fields.
   * @param row - The row to validate
   * @returns Array of error messages (empty if valid)
   */
  protected validateRequiredFields(row: Partial<NormalizedRow>): string[] {
    const errors: string[] = []

    if (!row.name || row.name.trim() === '') {
      errors.push('Missing required field: name')
    }

    if (row.price == null || row.price < 0) {
      errors.push('Invalid or missing price')
    }

    if (!row.storeIdentifier || row.storeIdentifier.trim() === '') {
      errors.push('Missing required field: storeIdentifier')
    }

    return errors
  }
}

/**
 * Registry for parser instances.
 * Allows looking up the appropriate parser for a filename.
 */
export class ParserRegistry {
  private parsers: Parser[] = []

  /**
   * Register a parser instance.
   * @param parser - The parser to register
   */
  register(parser: Parser): void {
    this.parsers.push(parser)
  }

  /**
   * Find a parser that can handle the given filename.
   * @param filename - The filename to parse
   * @returns The appropriate parser, or undefined if none found
   */
  getParser(filename: string): Parser | undefined {
    return this.parsers.find((p) => p.canParse(filename))
  }

  /**
   * Get all registered parsers.
   * @returns Array of registered parsers
   */
  getAllParsers(): Parser[] {
    return [...this.parsers]
  }

  /**
   * Get parser by file type.
   * @param fileType - The file type to look up
   * @returns The parser for that file type, or undefined
   */
  getParserByType(fileType: FileType): Parser | undefined {
    return this.parsers.find((p) => p.fileType === fileType)
  }
}

/**
 * Default parser registry instance.
 * Import and use this, or create your own registry.
 */
export const parserRegistry = new ParserRegistry()
