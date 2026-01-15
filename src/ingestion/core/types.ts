/**
 * Ingestion Core Types
 *
 * Shared interfaces for the price tracking ingestion pipeline.
 * Used by CLI commands, Cloudflare Workers, and chain adapters.
 */

// ============================================================================
// Normalized Row - Output of parsing stage
// ============================================================================

/**
 * A normalized row from any chain's data source.
 * Represents a single item's price at a store after parsing.
 */
export interface NormalizedRow {
  /** Store identifier from the source (filename code, portal ID, etc.) */
  storeIdentifier: string
  /** Retailer's internal ID for the item */
  externalId: string | null
  /** Item name as provided by retailer */
  name: string
  /** Item description */
  description: string | null
  /** Category from retailer */
  category: string | null
  /** Subcategory from retailer */
  subcategory: string | null
  /** Brand name */
  brand: string | null
  /** Unit of measurement (kg, l, kom, etc.) */
  unit: string | null
  /** Unit quantity ("1", "0.5", "500g", etc.) */
  unitQuantity: string | null
  /** Current price in cents/lipa */
  price: number
  /** Promotional/discount price in cents/lipa, if active */
  discountPrice: number | null
  /** Discount start date */
  discountStart: Date | null
  /** Discount end date */
  discountEnd: Date | null
  /** EAN/barcode, can be multiple separated by comma */
  barcodes: string[]
  /** Image URL if available */
  imageUrl: string | null
  /** Row number in source file for error tracking */
  rowNumber: number
  /** Original raw data as JSON string for debugging */
  rawData: string
  // Croatian price transparency fields
  /** Unit price in cents/lipa (e.g., price per kg, per liter) */
  unitPrice: number | null
  /** Base quantity for unit price (e.g., "1", "100") */
  unitPriceBaseQuantity: string | null
  /** Base unit for unit price (e.g., "kg", "l", "kom") */
  unitPriceBaseUnit: string | null
  /** Lowest price in the last 30 days in cents/lipa */
  lowestPrice30d: number | null
  /** Anchor price (sidrena cijena) in cents/lipa */
  anchorPrice: number | null
  /** Date when the anchor price was set */
  anchorPriceAsOf: Date | null
}

/**
 * Validation result for a normalized row.
 */
export interface NormalizedRowValidation {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

// ============================================================================
// Store Descriptor - Resolved store information
// ============================================================================

/**
 * Resolved store information after matching identifiers.
 */
export interface StoreDescriptor {
  /** Store ID from database */
  id: string
  /** Chain slug (konzum, lidl, etc.) */
  chainSlug: string
  /** Store name */
  name: string
  /** Street address */
  address: string | null
  /** City name */
  city: string | null
  /** Postal/ZIP code */
  postalCode: string | null
  /** Latitude for geo queries */
  latitude: string | null
  /** Longitude for geo queries */
  longitude: string | null
}

/**
 * Store identifier with its type and value.
 */
export interface StoreIdentifier {
  /** Type of identifier (filename_code, portal_id, internal_id, etc.) */
  type: string
  /** The identifier value */
  value: string
}

/**
 * Metadata extracted from file for auto-registering stores.
 * Used when a store doesn't exist in the database yet.
 */
export interface StoreMetadata {
  /** Store name (e.g., "RC DUGO SELO" or "SUPERMARKET Žitna 1A") */
  name: string
  /** Street address (e.g., "Žitna 1A") */
  address?: string
  /** City name (e.g., "Ivanić Grad") */
  city?: string
  /** Postal/ZIP code (e.g., "10310") */
  postalCode?: string
  /** Store type from retailer (e.g., "SUPERMARKET", "HIPERMARKET") */
  storeType?: string
}

/**
 * Result of store resolution attempt.
 */
export interface StoreResolutionResult {
  /** Whether a store was found */
  found: boolean
  /** The resolved store, if found */
  store: StoreDescriptor | null
  /** The identifier that matched, if found */
  matchedIdentifier: StoreIdentifier | null
  /** Attempted identifiers that didn't match */
  attemptedIdentifiers: StoreIdentifier[]
}

// ============================================================================
// Chain Adapter Interface
// ============================================================================

/**
 * File type supported by the ingestion pipeline.
 */
export type FileType = 'csv' | 'xml' | 'xlsx' | 'zip'

/**
 * A discovered file from a chain's data source.
 */
export interface DiscoveredFile {
  /** URL or path to the file */
  url: string
  /** Original filename */
  filename: string
  /** Detected file type */
  type: FileType
  /** File size in bytes, if known */
  size: number | null
  /** Last modified date, if known */
  lastModified: Date | null
  /** Metadata extracted from filename/path */
  metadata: Record<string, string>
}

/**
 * Result of fetching a file.
 */
export interface FetchedFile {
  /** Original discovered file info */
  discovered: DiscoveredFile
  /** File contents as ArrayBuffer */
  content: ArrayBuffer
  /** Content hash for deduplication */
  hash: string
}

/**
 * Result of expanding a ZIP file.
 */
export interface ExpandedFile {
  /** Parent ZIP file info */
  parent: DiscoveredFile
  /** Filename within the ZIP */
  innerFilename: string
  /** Detected file type */
  type: FileType
  /** File contents as ArrayBuffer */
  content: ArrayBuffer
  /** Content hash for deduplication */
  hash: string
}

/**
 * Parse options for chain adapters.
 */
export interface ParseOptions {
  /** Skip rows with validation errors */
  skipInvalid?: boolean
  /** Maximum number of rows to parse (for testing) */
  limit?: number
}

/**
 * Parse result from a chain adapter.
 */
export interface ParseResult {
  /** Successfully parsed rows */
  rows: NormalizedRow[]
  /** Errors encountered during parsing */
  errors: ParseError[]
  /** Warnings (non-fatal issues) */
  warnings: ParseWarning[]
  /** Total rows attempted */
  totalRows: number
  /** Rows that passed validation */
  validRows: number
}

/**
 * A parsing error.
 */
export interface ParseError {
  /** Row number where error occurred */
  rowNumber: number | null
  /** Field that caused the error */
  field: string | null
  /** Error message */
  message: string
  /** Original value that caused the error */
  originalValue: string | null
}

/**
 * A parsing warning (non-fatal issue).
 */
export interface ParseWarning {
  /** Row number where warning occurred */
  rowNumber: number | null
  /** Field with the issue */
  field: string | null
  /** Warning message */
  message: string
}

/**
 * Chain adapter interface for processing retail chain data.
 * Each chain (Konzum, Lidl, etc.) implements this interface.
 */
export interface ChainAdapter {
  /** Chain slug identifier */
  readonly slug: string
  /** Human-readable chain name */
  readonly name: string
  /** Supported file types for this chain */
  readonly supportedTypes: FileType[]

  /**
   * Discover available data files from the chain's source.
   * @returns List of discovered files
   */
  discover(): Promise<DiscoveredFile[]>

  /**
   * Fetch a discovered file.
   * @param file - The file to fetch
   * @returns Fetched file with content
   */
  fetch(file: DiscoveredFile): Promise<FetchedFile>

  /**
   * Parse file content into normalized rows.
   * @param content - File content as ArrayBuffer
   * @param filename - Original filename (for type detection/metadata)
   * @param options - Parse options
   * @returns Parse result with rows and errors
   */
  parse(
    content: ArrayBuffer,
    filename: string,
    options?: ParseOptions,
  ): Promise<ParseResult>

  /**
   * Extract store identifier from filename or file metadata.
   * @param file - The file to extract from
   * @returns Store identifier info, or null if not extractable
   */
  extractStoreIdentifier(file: DiscoveredFile): StoreIdentifier | null

  /**
   * Validate a normalized row according to chain-specific rules.
   * @param row - The row to validate
   * @returns Validation result
   */
  validateRow(row: NormalizedRow): NormalizedRowValidation

  /**
   * Extract store metadata from file for auto-registration.
   * Used when a store doesn't exist and needs to be created.
   * @param file - The file to extract metadata from
   * @returns Store metadata, or null if not extractable
   */
  extractStoreMetadata?(file: DiscoveredFile): StoreMetadata | null
}

// ============================================================================
// Queue Message Types for Cloudflare Workers
// ============================================================================

/**
 * Base queue message with common fields.
 */
interface QueueMessageBase {
  /** Unique message ID */
  id: string
  /** Message type discriminator */
  type: string
  /** Ingestion run ID */
  runId: string
  /** Chain being processed */
  chainSlug: string
  /** Timestamp when message was created */
  createdAt: string
}

/**
 * Message to discover files from a chain.
 */
export interface DiscoverQueueMessage extends QueueMessageBase {
  type: 'discover'
}

/**
 * Message to fetch a specific file.
 */
export interface FetchQueueMessage extends QueueMessageBase {
  type: 'fetch'
  /** File to fetch */
  file: DiscoveredFile
}

/**
 * Message to expand a ZIP file.
 */
export interface ExpandQueueMessage extends QueueMessageBase {
  type: 'expand'
  /** R2 key where ZIP is stored */
  r2Key: string
  /** Original file metadata */
  file: DiscoveredFile
}

/**
 * Message to parse a file.
 */
export interface ParseQueueMessage extends QueueMessageBase {
  type: 'parse'
  /** R2 key where file is stored */
  r2Key: string
  /** File metadata */
  file: DiscoveredFile
  /** Inner filename if extracted from ZIP */
  innerFilename: string | null
  /** File content hash */
  hash: string
}

/**
 * Message to persist parsed rows.
 */
export interface PersistQueueMessage extends QueueMessageBase {
  type: 'persist'
  /** Ingestion file ID in database */
  fileId: string
  /** R2 key where parsed rows JSON is stored */
  rowsR2Key: string
  /** Number of rows to persist */
  rowCount: number
}

/**
 * Message to parse a file into chunks for parallel processing.
 */
export interface ParseChunkedQueueMessage extends QueueMessageBase {
  type: 'parse_chunked'
  /** R2 key where file is stored */
  r2Key: string
  /** File metadata */
  file: DiscoveredFile
  /** Inner filename if extracted from ZIP */
  innerFilename: string | null
  /** File content hash */
  hash: string
  /** Number of rows per chunk */
  chunkSize: number
}

/**
 * Message to persist a single chunk of rows.
 */
export interface PersistChunkQueueMessage extends QueueMessageBase {
  type: 'persist_chunk'
  /** Ingestion file ID in database */
  fileId: string
  /** Ingestion chunk ID in database */
  chunkId: string
  /** R2 key where chunk JSON is stored */
  chunkR2Key: string
  /** Chunk index (0-based) */
  chunkIndex: number
  /** Number of rows in this chunk */
  rowCount: number
}

/**
 * Rerun target type.
 */
export type RerunTargetType = 'run' | 'file' | 'chunk'

/**
 * Message to re-run ingestion at run/file/chunk level.
 */
export interface RerunQueueMessage extends QueueMessageBase {
  type: 'rerun'
  /** Original run ID being re-run */
  originalRunId: string
  /** Target type for re-run */
  targetType: RerunTargetType
  /** Target ID (run ID, file ID, or chunk ID depending on targetType) */
  targetId: string
}

/**
 * Store enrichment task type.
 */
export type EnrichmentTaskType = 'geocode' | 'verify_address' | 'ai_categorize'

/**
 * Message to enrich a store with geocoding/verification.
 */
export interface EnrichStoreQueueMessage extends QueueMessageBase {
  type: 'enrich_store'
  /** Store ID to enrich */
  storeId: string
  /** Type of enrichment task */
  taskType: EnrichmentTaskType
  /** Enrichment task ID in database */
  taskId: string
}

/**
 * Union type of all queue messages.
 */
export type QueueMessage =
  | DiscoverQueueMessage
  | FetchQueueMessage
  | ExpandQueueMessage
  | ParseQueueMessage
  | PersistQueueMessage
  | ParseChunkedQueueMessage
  | PersistChunkQueueMessage
  | RerunQueueMessage
  | EnrichStoreQueueMessage

/**
 * Type guard for discover messages.
 */
export function isDiscoverMessage(
  msg: QueueMessage,
): msg is DiscoverQueueMessage {
  return msg.type === 'discover'
}

/**
 * Type guard for fetch messages.
 */
export function isFetchMessage(msg: QueueMessage): msg is FetchQueueMessage {
  return msg.type === 'fetch'
}

/**
 * Type guard for expand messages.
 */
export function isExpandMessage(msg: QueueMessage): msg is ExpandQueueMessage {
  return msg.type === 'expand'
}

/**
 * Type guard for parse messages.
 */
export function isParseMessage(msg: QueueMessage): msg is ParseQueueMessage {
  return msg.type === 'parse'
}

/**
 * Type guard for persist messages.
 */
export function isPersistMessage(
  msg: QueueMessage,
): msg is PersistQueueMessage {
  return msg.type === 'persist'
}

/**
 * Type guard for parse chunked messages.
 */
export function isParseChunkedMessage(
  msg: QueueMessage,
): msg is ParseChunkedQueueMessage {
  return msg.type === 'parse_chunked'
}

/**
 * Type guard for persist chunk messages.
 */
export function isPersistChunkMessage(
  msg: QueueMessage,
): msg is PersistChunkQueueMessage {
  return msg.type === 'persist_chunk'
}

/**
 * Type guard for rerun messages.
 */
export function isRerunMessage(
  msg: QueueMessage,
): msg is RerunQueueMessage {
  return msg.type === 'rerun'
}

/**
 * Type guard for enrich store messages.
 */
export function isEnrichStoreMessage(
  msg: QueueMessage,
): msg is EnrichStoreQueueMessage {
  return msg.type === 'enrich_store'
}

// ============================================================================
// Ingestion Run Types
// ============================================================================

/**
 * Source of an ingestion run.
 */
export type IngestionSource = 'cli' | 'worker' | 'scheduled'

/**
 * Status of an ingestion run.
 */
export type IngestionStatus = 'pending' | 'running' | 'completed' | 'failed'

/**
 * Status of an ingestion file.
 */
export type FileStatus = 'pending' | 'processing' | 'completed' | 'failed'

/**
 * Status of an ingestion file entry.
 */
export type EntryStatus = 'pending' | 'processed' | 'skipped' | 'failed'

/**
 * Error severity levels.
 */
export type ErrorSeverity = 'warning' | 'error' | 'critical'

/**
 * Error types for ingestion errors.
 */
export type IngestionErrorType =
  | 'parse'
  | 'validation'
  | 'store_resolution'
  | 'persist'
  | 'fetch'
  | 'expand'
  | 'unknown'
