/**
 * Persist Module for Ingestion Pipeline
 *
 * Handles upserting retailer items, barcodes, and store prices
 * with signature-based deduplication to minimize database writes.
 *
 * Optimized with batch operations for improved performance on large datasets.
 */

import { eq, and, sql, inArray } from 'drizzle-orm'
import * as schema from '@/db/schema'
import {
  chains,
  stores,
  storeIdentifiers,
  retailerItems,
  retailerItemBarcodes,
  storeItemState,
  storeItemPricePeriods,
} from '@/db/schema'
import { generatePrefixedId } from '@/utils/id'
import { computeSha256 } from './storage'
import type { NormalizedRow, StoreDescriptor } from './types'

// ============================================================================
// Database Connection Types
// ============================================================================

/**
 * Generic database type that works with both D1 (production) and
 * BetterSQLite3 (CLI/local development).
 *
 * Both database types share the same Drizzle query interface, so we use
 * a permissive type to accept either. Type safety is maintained by the
 * shared schema.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDatabase = any

/**
 * Type alias for database connection that works with both direct Database
 * and Transaction contexts. This allows helper functions to be used within
 * transactions while maintaining type safety.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseConnection = any

// ============================================================================
// Constants
// ============================================================================

/** Default batch size for batch operations - reduced to stay under D1's 100 bound parameter limit */
const DEFAULT_BATCH_SIZE = 50

/** Max rows per INSERT to stay under D1's 100 bound parameter limit (~10 columns) */
const INSERT_BATCH_SIZE = 8

// ============================================================================
// Price Signature
// ============================================================================

/**
 * Fields used to compute the price signature.
 * When any of these change, we create a new price period.
 */
interface PriceSignatureFields {
  price: number
  discountPrice: number | null
  discountStart: Date | null
  discountEnd: Date | null
  // Croatian price transparency fields
  unitPrice: number | null
  unitPriceBaseQuantity: string | null
  unitPriceBaseUnit: string | null
  lowestPrice30d: number | null
  anchorPrice: number | null
  anchorPriceAsOf: Date | null
}

/**
 * Compute a signature hash from price fields.
 * Used to detect when prices have actually changed.
 *
 * @param fields - Price fields to hash
 * @returns SHA256 hash of the price fields
 */
export async function computePriceSignature(
  fields: PriceSignatureFields,
): Promise<string> {
  const data = JSON.stringify({
    p: fields.price,
    dp: fields.discountPrice,
    ds: fields.discountStart?.getTime() ?? null,
    de: fields.discountEnd?.getTime() ?? null,
    // Croatian price transparency fields
    up: fields.unitPrice,
    ubq: fields.unitPriceBaseQuantity,
    ubu: fields.unitPriceBaseUnit,
    lp30: fields.lowestPrice30d,
    ap: fields.anchorPrice,
    apa: fields.anchorPriceAsOf?.getTime() ?? null,
  })
  return computeSha256(data)
}

// ============================================================================
// Persist Result Types
// ============================================================================

/**
 * Result of persisting a single row.
 */
export interface PersistRowResult {
  /** Whether the row was successfully persisted */
  success: boolean
  /** Retailer item ID (new or existing) */
  retailerItemId: string | null
  /** Store item state ID */
  storeItemStateId: string | null
  /** Whether a new price period was created */
  priceChanged: boolean
  /** Error message if failed */
  error: string | null
}

/**
 * Result of persisting multiple rows.
 */
export interface PersistResult {
  /** Total rows attempted */
  total: number
  /** Successfully persisted rows */
  persisted: number
  /** Rows where price changed (new periods created) */
  priceChanges: number
  /** Rows where only last_seen was updated */
  unchanged: number
  /** Rows that failed */
  failed: number
  /** Errors encountered */
  errors: Array<{ rowNumber: number; error: string }>
}

// ============================================================================
// Batch Helper Types
// ============================================================================

/**
 * Maps row index to its retailer item ID after batch upsert.
 */
interface RetailerItemMapping {
  rowIndex: number
  retailerItemId: string
  row: NormalizedRow
}

/**
 * Price data prepared for batch processing.
 */
interface PreparedPriceData {
  rowIndex: number
  retailerItemId: string
  row: NormalizedRow
  signature: string
}

// ============================================================================
// Batch Helper Functions
// ============================================================================

/**
 * Split an array into chunks of specified size.
 *
 * @param array - Array to split
 * @param size - Maximum chunk size
 * @returns Array of chunks
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

// ============================================================================
// Retailer Item Operations
// ============================================================================

/**
 * Find or create a retailer item based on chain and external ID or name.
 *
 * @param db - Database or transaction instance
 * @param chainSlug - Chain identifier
 * @param row - Normalized row data
 * @returns The retailer item ID
 */
export async function upsertRetailerItem(
  db: DatabaseConnection,
  chainSlug: string,
  row: NormalizedRow,
): Promise<string> {
  // Try to find existing item by externalId first
  if (row.externalId) {
    const existing = await db.query.retailerItems.findFirst({
      where: and(
        eq(retailerItems.chainSlug, chainSlug),
        eq(retailerItems.externalId, row.externalId),
      ),
    })

    if (existing) {
      // Update mutable fields if they've changed
      await db
        .update(retailerItems)
        .set({
          name: row.name,
          description: row.description,
          category: row.category,
          subcategory: row.subcategory,
          brand: row.brand,
          unit: row.unit,
          unitQuantity: row.unitQuantity,
          imageUrl: row.imageUrl,
          updatedAt: new Date(),
        })
        .where(eq(retailerItems.id, existing.id))

      return existing.id
    }
  }

  // Try to find by name if no externalId match
  const byName = await db.query.retailerItems.findFirst({
    where: and(
      eq(retailerItems.chainSlug, chainSlug),
      eq(retailerItems.name, row.name),
    ),
  })

  if (byName) {
    // Update mutable fields
    await db
      .update(retailerItems)
      .set({
        externalId: row.externalId ?? byName.externalId,
        description: row.description ?? byName.description,
        category: row.category ?? byName.category,
        subcategory: row.subcategory ?? byName.subcategory,
        brand: row.brand ?? byName.brand,
        unit: row.unit ?? byName.unit,
        unitQuantity: row.unitQuantity ?? byName.unitQuantity,
        imageUrl: row.imageUrl ?? byName.imageUrl,
        updatedAt: new Date(),
      })
      .where(eq(retailerItems.id, byName.id))

    return byName.id
  }

  // Create new retailer item
  const id = generatePrefixedId('rit')
  await db.insert(retailerItems).values({
    id,
    chainSlug,
    externalId: row.externalId,
    name: row.name,
    description: row.description,
    category: row.category,
    subcategory: row.subcategory,
    brand: row.brand,
    unit: row.unit,
    unitQuantity: row.unitQuantity,
    imageUrl: row.imageUrl,
  })

  return id
}

/**
 * Batch upsert retailer items with optimized lookups.
 *
 * Strategy:
 * 1. Batch lookup existing items by externalId
 * 2. Batch lookup remaining items by name
 * 3. Batch update existing items
 * 4. Batch insert new items
 *
 * @param db - Database connection
 * @param chainSlug - Chain identifier
 * @param rows - Array of normalized rows with their indices
 * @returns Array of mappings from row index to retailer item ID
 */
async function batchUpsertRetailerItems(
  db: DatabaseConnection,
  chainSlug: string,
  rows: Array<{ rowIndex: number; row: NormalizedRow }>,
): Promise<RetailerItemMapping[]> {
  if (rows.length === 0) return []

  const now = new Date()
  const mappings: RetailerItemMapping[] = []

  // Separate rows with and without externalId
  const rowsWithExternalId = rows.filter((r) => r.row.externalId !== null)
  const rowsWithoutExternalId = rows.filter((r) => r.row.externalId === null)

  // Track which rows have been matched
  const matchedRowIndices = new Set<number>()

  // Step 1: Batch lookup by externalId
  if (rowsWithExternalId.length > 0) {
    const externalIds = rowsWithExternalId.map(
      (r) => r.row.externalId as string,
    )

    const existingByExternalId = await db.query.retailerItems.findMany({
      where: and(
        eq(retailerItems.chainSlug, chainSlug),
        inArray(retailerItems.externalId, externalIds),
      ),
    })

    // Create lookup map
    const externalIdToExisting = new Map(
      existingByExternalId.map((item) => [item.externalId, item]),
    )

    // Process matched items - collect updates
    const itemsToUpdate: Array<{
      id: string
      rowData: NormalizedRow
    }> = []

    for (const { rowIndex, row } of rowsWithExternalId) {
      const existing = externalIdToExisting.get(row.externalId as string)
      if (existing) {
        matchedRowIndices.add(rowIndex)
        mappings.push({ rowIndex, retailerItemId: existing.id, row })
        itemsToUpdate.push({ id: existing.id, rowData: row })
      }
    }

    // Batch update existing items by externalId
    // SQLite doesn't support batch updates with different values, so we update one by one
    // but at least we've reduced lookups
    for (const { id, rowData } of itemsToUpdate) {
      await db
        .update(retailerItems)
        .set({
          name: rowData.name,
          description: rowData.description,
          category: rowData.category,
          subcategory: rowData.subcategory,
          brand: rowData.brand,
          unit: rowData.unit,
          unitQuantity: rowData.unitQuantity,
          imageUrl: rowData.imageUrl,
          updatedAt: now,
        })
        .where(eq(retailerItems.id, id))
    }
  }

  // Step 2: Collect unmatched rows (no externalId match or no externalId)
  const unmatchedRows = [
    ...rowsWithExternalId.filter((r) => !matchedRowIndices.has(r.rowIndex)),
    ...rowsWithoutExternalId,
  ]

  // Step 3: Batch lookup by name for unmatched rows
  if (unmatchedRows.length > 0) {
    const names = unmatchedRows.map((r) => r.row.name)

    const existingByName = await db.query.retailerItems.findMany({
      where: and(
        eq(retailerItems.chainSlug, chainSlug),
        inArray(retailerItems.name, names),
      ),
    })

    // Create lookup map
    const nameToExisting = new Map(
      existingByName.map((item) => [item.name, item]),
    )

    // Process matched items
    const itemsToUpdateByName: Array<{
      id: string
      rowData: NormalizedRow
      existing: (typeof existingByName)[0]
    }> = []

    for (const { rowIndex, row } of unmatchedRows) {
      const existing = nameToExisting.get(row.name)
      if (existing) {
        matchedRowIndices.add(rowIndex)
        mappings.push({ rowIndex, retailerItemId: existing.id, row })
        itemsToUpdateByName.push({ id: existing.id, rowData: row, existing })
      }
    }

    // Batch update existing items by name
    for (const { id, rowData, existing } of itemsToUpdateByName) {
      await db
        .update(retailerItems)
        .set({
          externalId: rowData.externalId ?? existing.externalId,
          description: rowData.description ?? existing.description,
          category: rowData.category ?? existing.category,
          subcategory: rowData.subcategory ?? existing.subcategory,
          brand: rowData.brand ?? existing.brand,
          unit: rowData.unit ?? existing.unit,
          unitQuantity: rowData.unitQuantity ?? existing.unitQuantity,
          imageUrl: rowData.imageUrl ?? existing.imageUrl,
          updatedAt: now,
        })
        .where(eq(retailerItems.id, id))
    }
  }

  // Step 4: Collect rows that still need to be inserted
  const rowsToInsert = rows.filter((r) => !matchedRowIndices.has(r.rowIndex))

  // Step 5: Batch insert new items in smaller chunks to avoid overwhelming the database
  const INSERT_BATCH_SIZE = 50
  if (rowsToInsert.length > 0) {
    const newItems = rowsToInsert.map(({ rowIndex, row }) => {
      const id = generatePrefixedId('rit')
      mappings.push({ rowIndex, retailerItemId: id, row })
      return {
        id,
        chainSlug,
        externalId: row.externalId,
        name: row.name,
        description: row.description,
        category: row.category,
        subcategory: row.subcategory,
        brand: row.brand,
        unit: row.unit,
        unitQuantity: row.unitQuantity,
        imageUrl: row.imageUrl,
      }
    })

    const insertChunks = chunk(newItems, INSERT_BATCH_SIZE)
    for (const insertChunk of insertChunks) {
      await db.insert(retailerItems).values(insertChunk)
    }
  }

  return mappings
}

/**
 * Sync barcodes for a retailer item.
 * Adds new barcodes without duplicating existing ones.
 *
 * @param db - Database or transaction instance
 * @param retailerItemId - The retailer item ID
 * @param barcodes - Array of barcode strings
 */
export async function syncBarcodes(
  db: DatabaseConnection,
  retailerItemId: string,
  barcodes: string[],
): Promise<void> {
  if (barcodes.length === 0) return

  // Get existing barcodes
  const existing = await db.query.retailerItemBarcodes.findMany({
    where: eq(retailerItemBarcodes.retailerItemId, retailerItemId),
  })
  const existingSet = new Set(existing.map((b) => b.barcode))

  // Filter to new barcodes only
  const newBarcodes = barcodes.filter((b) => !existingSet.has(b))

  if (newBarcodes.length === 0) return

  // Insert new barcodes
  await db.insert(retailerItemBarcodes).values(
    newBarcodes.map((barcode, index) => ({
      id: generatePrefixedId('rib'),
      retailerItemId,
      barcode,
      isPrimary: existing.length === 0 && index === 0, // First barcode on empty item is primary
    })),
  )
}

/**
 * Batch sync barcodes for multiple retailer items.
 *
 * Strategy:
 * 1. Batch lookup all existing barcodes for the retailer items
 * 2. Filter to new barcodes
 * 3. Batch insert new barcodes
 *
 * @param db - Database connection
 * @param items - Array of retailer item IDs with their barcodes
 */
async function batchSyncBarcodes(
  db: DatabaseConnection,
  items: Array<{ retailerItemId: string; barcodes: string[] }>,
): Promise<void> {
  // Filter out items with no barcodes
  const itemsWithBarcodes = items.filter((i) => i.barcodes.length > 0)
  if (itemsWithBarcodes.length === 0) return

  const retailerItemIds = itemsWithBarcodes.map((i) => i.retailerItemId)

  // Batch lookup all existing barcodes for these items
  const existingBarcodes = await db.query.retailerItemBarcodes.findMany({
    where: inArray(retailerItemBarcodes.retailerItemId, retailerItemIds),
  })

  // Create lookup: retailerItemId -> Set of existing barcodes
  const existingByItem = new Map<string, Set<string>>()
  for (const barcode of existingBarcodes) {
    if (!existingByItem.has(barcode.retailerItemId)) {
      existingByItem.set(barcode.retailerItemId, new Set())
    }
    existingByItem.get(barcode.retailerItemId)!.add(barcode.barcode)
  }

  // Collect all new barcodes to insert
  const barcodesToInsert: Array<{
    id: string
    retailerItemId: string
    barcode: string
    isPrimary: boolean
  }> = []

  for (const { retailerItemId, barcodes } of itemsWithBarcodes) {
    const existingSet = existingByItem.get(retailerItemId) ?? new Set()
    const hasExisting = existingSet.size > 0

    const newBarcodes = barcodes.filter((b) => !existingSet.has(b))
    for (let i = 0; i < newBarcodes.length; i++) {
      barcodesToInsert.push({
        id: generatePrefixedId('rib'),
        retailerItemId,
        barcode: newBarcodes[i],
        isPrimary: !hasExisting && i === 0, // First new barcode on empty item is primary
      })
    }
  }

  // Batch insert new barcodes in smaller chunks to avoid overwhelming the database
  const INSERT_BATCH_SIZE = 50
  if (barcodesToInsert.length > 0) {
    const barcodeChunks = chunk(barcodesToInsert, INSERT_BATCH_SIZE)
    for (const barcodeChunk of barcodeChunks) {
      await db.insert(retailerItemBarcodes).values(barcodeChunk)
    }
  }
}

// ============================================================================
// Store Resolution
// ============================================================================

/**
 * Resolve a store ID from a store identifier.
 *
 * @param db - Database instance
 * @param chainSlug - Chain identifier
 * @param identifier - Store identifier value (from filename, portal, etc.)
 * @param identifierType - Type of identifier (defaults to 'filename_code')
 * @returns Store ID if found, null otherwise
 */
export async function resolveStoreId(
  db: AnyDatabase,
  chainSlug: string,
  identifier: string,
  identifierType: string = 'filename_code',
): Promise<string | null> {
  const result = await db
    .select({ storeId: storeIdentifiers.storeId })
    .from(storeIdentifiers)
    .innerJoin(stores, eq(stores.id, storeIdentifiers.storeId))
    .where(
      and(
        eq(stores.chainSlug, chainSlug),
        eq(storeIdentifiers.type, identifierType),
        eq(storeIdentifiers.value, identifier),
      ),
    )
    .limit(1)

  return result.length > 0 ? result[0].storeId : null
}

// ============================================================================
// Store Auto-Registration
// ============================================================================

/**
 * Options for auto-registering a store when it doesn't exist.
 */
export interface StoreAutoRegisterOptions {
  /** Store name (e.g., "RC DUGO SELO") */
  name: string
  /** Optional address extracted from filename or metadata */
  address?: string
  /** Optional city */
  city?: string
}

/**
 * Chain configuration for auto-registration.
 */
interface ChainConfig {
  slug: string
  name: string
  website?: string
}

/** Known chain configurations for auto-registration */
const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  ktc: { slug: 'ktc', name: 'KTC', website: 'https://www.ktc.hr' },
  konzum: { slug: 'konzum', name: 'Konzum', website: 'https://www.konzum.hr' },
  lidl: { slug: 'lidl', name: 'Lidl', website: 'https://www.lidl.hr' },
  plodine: { slug: 'plodine', name: 'Plodine', website: 'https://www.plodine.hr' },
  interspar: { slug: 'interspar', name: 'Interspar', website: 'https://www.interspar.hr' },
  studenac: { slug: 'studenac', name: 'Studenac', website: 'https://www.studenac.hr' },
  kaufland: { slug: 'kaufland', name: 'Kaufland', website: 'https://www.kaufland.hr' },
  eurospin: { slug: 'eurospin', name: 'Eurospin', website: 'https://www.eurospin.hr' },
  dm: { slug: 'dm', name: 'DM', website: 'https://www.dm.hr' },
  metro: { slug: 'metro', name: 'Metro', website: 'https://www.metro.hr' },
  trgocentar: { slug: 'trgocentar', name: 'Trgocentar', website: 'https://www.trgocentar.hr' },
}

/**
 * Ensure a chain exists in the database.
 * Creates it if it doesn't exist.
 *
 * @param db - Database instance
 * @param chainSlug - Chain identifier
 * @returns true if chain exists or was created
 */
export async function ensureChainExists(
  db: AnyDatabase,
  chainSlug: string,
): Promise<boolean> {
  // Check if chain exists
  const existing = await db.query.chains.findFirst({
    where: eq(chains.slug, chainSlug),
  })

  if (existing) {
    return true
  }

  // Get chain config
  const config = CHAIN_CONFIGS[chainSlug]
  if (!config) {
    console.warn(`[persist] Unknown chain slug: "${chainSlug}", cannot auto-register`)
    return false
  }

  // Create chain
  await db.insert(chains).values({
    slug: config.slug,
    name: config.name,
    website: config.website,
  })

  console.log(`[persist] Auto-registered chain: ${config.name} (${config.slug})`)
  return true
}

/**
 * Auto-register a store when it's encountered for the first time.
 *
 * @param db - Database instance
 * @param chainSlug - Chain identifier
 * @param identifier - Store identifier value (e.g., "PJ50-1")
 * @param identifierType - Type of identifier (defaults to 'filename_code')
 * @param options - Store details for registration
 * @returns Store ID if created successfully, null otherwise
 */
export async function autoRegisterStore(
  db: AnyDatabase,
  chainSlug: string,
  identifier: string,
  identifierType: string,
  options: StoreAutoRegisterOptions,
): Promise<string | null> {
  // Ensure chain exists first
  const chainExists = await ensureChainExists(db, chainSlug)
  if (!chainExists) {
    return null
  }

  // Create store
  const storeId = generatePrefixedId('sto')
  await db.insert(stores).values({
    id: storeId,
    chainSlug,
    name: options.name,
    address: options.address,
    city: options.city,
  })

  // Create store identifier
  await db.insert(storeIdentifiers).values({
    id: generatePrefixedId('sid'),
    storeId,
    type: identifierType,
    value: identifier,
  })

  console.log(`[persist] Auto-registered store: ${options.name} (${identifier}) for chain ${chainSlug}`)
  return storeId
}

// ============================================================================
// Price State Operations
// ============================================================================

/**
 * Persist a single row's price data with signature deduplication.
 *
 * @param db - Database or transaction instance
 * @param storeId - Store ID
 * @param retailerItemId - Retailer item ID
 * @param row - Normalized row data
 * @returns Persist result for this row
 */
export async function persistPrice(
  db: DatabaseConnection,
  storeId: string,
  retailerItemId: string,
  row: NormalizedRow,
): Promise<{ priceChanged: boolean; storeItemStateId: string }> {
  const now = new Date()

  // Compute price signature
  const signature = await computePriceSignature({
    price: row.price,
    discountPrice: row.discountPrice,
    discountStart: row.discountStart,
    discountEnd: row.discountEnd,
    // Croatian price transparency fields
    unitPrice: row.unitPrice,
    unitPriceBaseQuantity: row.unitPriceBaseQuantity,
    unitPriceBaseUnit: row.unitPriceBaseUnit,
    lowestPrice30d: row.lowestPrice30d,
    anchorPrice: row.anchorPrice,
    anchorPriceAsOf: row.anchorPriceAsOf,
  })

  // Look for existing store item state
  const existing = await db.query.storeItemState.findFirst({
    where: and(
      eq(storeItemState.storeId, storeId),
      eq(storeItemState.retailerItemId, retailerItemId),
    ),
  })

  if (!existing) {
    // Create new store item state
    const stateId = generatePrefixedId('sis')
    await db.insert(storeItemState).values({
      id: stateId,
      storeId,
      retailerItemId,
      currentPrice: row.price,
      discountPrice: row.discountPrice,
      discountStart: row.discountStart,
      discountEnd: row.discountEnd,
      // Croatian price transparency fields
      unitPrice: row.unitPrice,
      unitPriceBaseQuantity: row.unitPriceBaseQuantity,
      unitPriceBaseUnit: row.unitPriceBaseUnit,
      lowestPrice30d: row.lowestPrice30d,
      anchorPrice: row.anchorPrice,
      anchorPriceAsOf: row.anchorPriceAsOf,
      priceSignature: signature,
      lastSeenAt: now,
      updatedAt: now,
    })

    // Create first price period
    await db.insert(storeItemPricePeriods).values({
      id: generatePrefixedId('sip'),
      storeItemStateId: stateId,
      price: row.price,
      discountPrice: row.discountPrice,
      startedAt: now,
    })

    return { priceChanged: true, storeItemStateId: stateId }
  }

  // Existing state found - check if signature changed
  if (existing.priceSignature === signature) {
    // No price change - just update last_seen_at
    await db
      .update(storeItemState)
      .set({ lastSeenAt: now })
      .where(eq(storeItemState.id, existing.id))

    return { priceChanged: false, storeItemStateId: existing.id }
  }

  // Price changed - close old period and open new one
  // First, close the current open period (one without endedAt)
  await db
    .update(storeItemPricePeriods)
    .set({ endedAt: now })
    .where(
      and(
        eq(storeItemPricePeriods.storeItemStateId, existing.id),
        sql`${storeItemPricePeriods.endedAt} IS NULL`,
      ),
    )

  // Create new price period
  await db.insert(storeItemPricePeriods).values({
    id: generatePrefixedId('sip'),
    storeItemStateId: existing.id,
    price: row.price,
    discountPrice: row.discountPrice,
    startedAt: now,
  })

  // Update store item state with new prices
  await db
    .update(storeItemState)
    .set({
      previousPrice: existing.currentPrice,
      currentPrice: row.price,
      discountPrice: row.discountPrice,
      discountStart: row.discountStart,
      discountEnd: row.discountEnd,
      // Croatian price transparency fields
      unitPrice: row.unitPrice,
      unitPriceBaseQuantity: row.unitPriceBaseQuantity,
      unitPriceBaseUnit: row.unitPriceBaseUnit,
      lowestPrice30d: row.lowestPrice30d,
      anchorPrice: row.anchorPrice,
      anchorPriceAsOf: row.anchorPriceAsOf,
      priceSignature: signature,
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(storeItemState.id, existing.id))

  return { priceChanged: true, storeItemStateId: existing.id }
}

/**
 * Batch persist prices with optimized lookups.
 *
 * Strategy:
 * 1. Pre-compute all price signatures
 * 2. Batch lookup existing store item states
 * 3. Separate into: new items, unchanged items, changed items
 * 4. Batch insert new store item states
 * 5. Batch insert new price periods
 * 6. Batch update unchanged items (lastSeenAt only)
 * 7. Process changed items (close old period, create new, update state)
 *
 * @param db - Database connection
 * @param storeId - Store ID
 * @param items - Array of prepared price data
 * @returns Array of results with price change status
 */
async function batchPersistPrices(
  db: DatabaseConnection,
  storeId: string,
  items: PreparedPriceData[],
): Promise<Array<{ rowIndex: number; priceChanged: boolean }>> {
  if (items.length === 0) return []

  const now = new Date()
  const results: Array<{ rowIndex: number; priceChanged: boolean }> = []

  const retailerItemIds = items.map((i) => i.retailerItemId)

  // Batch lookup existing store item states
  const existingStates = await db.query.storeItemState.findMany({
    where: and(
      eq(storeItemState.storeId, storeId),
      inArray(storeItemState.retailerItemId, retailerItemIds),
    ),
  })

  // Create lookup: retailerItemId -> existing state
  const existingByRetailerId = new Map(
    existingStates.map((s) => [s.retailerItemId, s]),
  )

  // Categorize items
  const newItems: PreparedPriceData[] = []
  const unchangedItems: Array<{
    data: PreparedPriceData
    existingId: string
  }> = []
  const changedItems: Array<{
    data: PreparedPriceData
    existing: (typeof existingStates)[0]
  }> = []

  for (const item of items) {
    const existing = existingByRetailerId.get(item.retailerItemId)
    if (!existing) {
      newItems.push(item)
    } else if (existing.priceSignature === item.signature) {
      unchangedItems.push({ data: item, existingId: existing.id })
    } else {
      changedItems.push({ data: item, existing })
    }
  }

  // Process new items - batch insert states and periods
  // Use smaller sub-batches to avoid overwhelming the database
  const INSERT_BATCH_SIZE = 50
  if (newItems.length > 0) {
    const newStates = newItems.map((item) => {
      const stateId = generatePrefixedId('sis')
      results.push({ rowIndex: item.rowIndex, priceChanged: true })
      return {
        stateId,
        item,
        stateData: {
          id: stateId,
          storeId,
          retailerItemId: item.retailerItemId,
          currentPrice: item.row.price,
          discountPrice: item.row.discountPrice,
          discountStart: item.row.discountStart,
          discountEnd: item.row.discountEnd,
          // Croatian price transparency fields
          unitPrice: item.row.unitPrice,
          unitPriceBaseQuantity: item.row.unitPriceBaseQuantity,
          unitPriceBaseUnit: item.row.unitPriceBaseUnit,
          lowestPrice30d: item.row.lowestPrice30d,
          anchorPrice: item.row.anchorPrice,
          anchorPriceAsOf: item.row.anchorPriceAsOf,
          priceSignature: item.signature,
          lastSeenAt: now,
          updatedAt: now,
        },
      }
    })

    // Batch insert store item states in smaller chunks
    const stateChunks = chunk(newStates, INSERT_BATCH_SIZE)
    for (const stateChunk of stateChunks) {
      await db.insert(storeItemState).values(stateChunk.map((s) => s.stateData))
    }

    // Batch insert price periods in smaller chunks
    const newPeriods = newStates.map((s) => ({
      id: generatePrefixedId('sip'),
      storeItemStateId: s.stateId,
      price: s.item.row.price,
      discountPrice: s.item.row.discountPrice,
      startedAt: now,
    }))

    const periodChunks = chunk(newPeriods, INSERT_BATCH_SIZE)
    for (const periodChunk of periodChunks) {
      await db.insert(storeItemPricePeriods).values(periodChunk)
    }
  }

  // Process unchanged items - batch update lastSeenAt
  if (unchangedItems.length > 0) {
    const unchangedIds = unchangedItems.map((u) => u.existingId)
    await db
      .update(storeItemState)
      .set({ lastSeenAt: now })
      .where(inArray(storeItemState.id, unchangedIds))

    for (const { data } of unchangedItems) {
      results.push({ rowIndex: data.rowIndex, priceChanged: false })
    }
  }

  // Process changed items - need to handle price periods
  // SQLite doesn't support batch updates with different values, so we need individual updates
  for (const { data, existing } of changedItems) {
    // Close old period
    await db
      .update(storeItemPricePeriods)
      .set({ endedAt: now })
      .where(
        and(
          eq(storeItemPricePeriods.storeItemStateId, existing.id),
          sql`${storeItemPricePeriods.endedAt} IS NULL`,
        ),
      )

    // Create new period
    await db.insert(storeItemPricePeriods).values({
      id: generatePrefixedId('sip'),
      storeItemStateId: existing.id,
      price: data.row.price,
      discountPrice: data.row.discountPrice,
      startedAt: now,
    })

    // Update state
    await db
      .update(storeItemState)
      .set({
        previousPrice: existing.currentPrice,
        currentPrice: data.row.price,
        discountPrice: data.row.discountPrice,
        discountStart: data.row.discountStart,
        discountEnd: data.row.discountEnd,
        // Croatian price transparency fields
        unitPrice: data.row.unitPrice,
        unitPriceBaseQuantity: data.row.unitPriceBaseQuantity,
        unitPriceBaseUnit: data.row.unitPriceBaseUnit,
        lowestPrice30d: data.row.lowestPrice30d,
        anchorPrice: data.row.anchorPrice,
        anchorPriceAsOf: data.row.anchorPriceAsOf,
        priceSignature: data.signature,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(storeItemState.id, existing.id))

    results.push({ rowIndex: data.rowIndex, priceChanged: true })
  }

  return results
}

// ============================================================================
// Main Persist Functions (Optimized with db.batch())
// ============================================================================

/**
 * Persist a batch of normalized rows for a store.
 * Uses db.batch() to minimize network round-trips to D1.
 *
 * Two-phase approach:
 * 1. Phase 1: Batch all lookups in single call
 * 2. Phase 2: Batch all writes in single call
 *
 * @param db - Database instance
 * @param store - Resolved store descriptor
 * @param rows - Normalized rows to persist
 * @param batchSize - Optional batch size for chunking (default: 100)
 * @returns Persist result with statistics
 */
export async function persistRows(
  db: AnyDatabase,
  store: StoreDescriptor,
  rows: NormalizedRow[],
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<PersistResult> {
  const result: PersistResult = {
    total: rows.length,
    persisted: 0,
    priceChanges: 0,
    unchanged: 0,
    failed: 0,
    errors: [],
  }

  if (rows.length === 0) return result

  // Prepare rows with indices for tracking
  const indexedRows = rows.map((row, index) => ({ rowIndex: index, row }))

  // Process in chunks to avoid memory issues
  const chunks = chunk(indexedRows, batchSize)

  let chunkIndex = 0
  for (const rowChunk of chunks) {
    chunkIndex++
    if (chunks.length > 10 && chunkIndex % 10 === 0) {
      console.log(`[persist] Processing batch ${chunkIndex}/${chunks.length} (${Math.round(chunkIndex / chunks.length * 100)}%)`)
    }
    try {
      const chunkResult = await persistRowChunkBatched(db, store, rowChunk)

      // Log first batch completion
      if (chunkIndex === 1) {
        console.log(`[persist] First batch completed successfully`)
      }

      // Update result statistics
      result.persisted += chunkResult.persisted
      result.priceChanges += chunkResult.priceChanges
      result.unchanged += chunkResult.unchanged
      result.failed += chunkResult.failed
      result.errors.push(...chunkResult.errors)
    } catch (error) {
      // If batch fails, fall back to individual processing for this chunk
      console.warn(`[persist] Batch failed, falling back to individual processing: ${error instanceof Error ? error.message : String(error)}`)
      for (const { row } of rowChunk) {
        try {
          const retailerItemId = await upsertRetailerItem(
            db,
            store.chainSlug,
            row,
          )
          await syncBarcodes(db, retailerItemId, row.barcodes)
          const priceResult = await persistPrice(
            db,
            store.id,
            retailerItemId,
            row,
          )

          result.persisted++
          if (priceResult.priceChanged) {
            result.priceChanges++
          } else {
            result.unchanged++
          }
        } catch (rowError) {
          result.failed++
          result.errors.push({
            rowNumber: row.rowNumber,
            error:
              rowError instanceof Error ? rowError.message : String(rowError),
          })
        }
      }
    }
  }

  return result
}

/**
 * Process a chunk of rows using db.batch() for optimal performance.
 * Uses two-phase approach: batch lookups, then batch writes.
 */
async function persistRowChunkBatched(
  db: AnyDatabase,
  store: StoreDescriptor,
  rowChunk: Array<{ rowIndex: number; row: NormalizedRow }>,
): Promise<{
  persisted: number
  priceChanges: number
  unchanged: number
  failed: number
  errors: Array<{ rowNumber: number; error: string }>
}> {
  const now = new Date()
  const result = { persisted: 0, priceChanges: 0, unchanged: 0, failed: 0, errors: [] as Array<{ rowNumber: number; error: string }> }

  // Separate rows with and without externalId
  const rowsWithExternalId = rowChunk.filter((r) => r.row.externalId !== null)
  const rowsWithoutExternalId = rowChunk.filter((r) => r.row.externalId === null)

  // Collect all lookup keys
  const externalIds = rowsWithExternalId.map((r) => r.row.externalId as string)
  const allNames = rowChunk.map((r) => r.row.name)

  // ============================================================================
  // PHASE 1: Batch all lookups in a single db.batch() call
  // ============================================================================
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lookupQueries: any[] = []

  // Query 0: Lookup retailer items by externalId
  if (externalIds.length > 0) {
    lookupQueries.push(
      db.query.retailerItems.findMany({
        where: and(
          eq(retailerItems.chainSlug, store.chainSlug),
          inArray(retailerItems.externalId, externalIds),
        ),
      })
    )
  }

  // Query 1: Lookup retailer items by name (for items without externalId match)
  lookupQueries.push(
    db.query.retailerItems.findMany({
      where: and(
        eq(retailerItems.chainSlug, store.chainSlug),
        inArray(retailerItems.name, allNames),
      ),
    })
  )

  // Execute all lookups in single batch
  const lookupResults = await db.batch(lookupQueries)

  // Parse lookup results
  let queryIndex = 0
  const existingByExternalId = externalIds.length > 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? new Map((lookupResults[queryIndex++] as any[]).map((item: any) => [item.externalId, item]))
    : new Map()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingByName = new Map((lookupResults[queryIndex++] as any[]).map((item: any) => [item.name, item]))

  // ============================================================================
  // Process results: Categorize items for insert vs update
  // ============================================================================
  const matchedRowIndices = new Set<number>()
  const retailerItemMappings: RetailerItemMapping[] = []

  // Items to update (existing)
  const retailerItemUpdates: Array<{ id: string; rowData: NormalizedRow; mergeExisting?: boolean }> = []
  // Items to insert (new)
  const retailerItemInserts: Array<{ id: string; rowIndex: number; row: NormalizedRow }> = []

  // Match by externalId first
  for (const { rowIndex, row } of rowsWithExternalId) {
    const existing = existingByExternalId.get(row.externalId as string)
    if (existing) {
      matchedRowIndices.add(rowIndex)
      retailerItemMappings.push({ rowIndex, retailerItemId: existing.id, row })
      retailerItemUpdates.push({ id: existing.id, rowData: row })
    }
  }

  // Match remaining by name
  const unmatchedRows = [
    ...rowsWithExternalId.filter((r) => !matchedRowIndices.has(r.rowIndex)),
    ...rowsWithoutExternalId,
  ]

  for (const { rowIndex, row } of unmatchedRows) {
    const existing = existingByName.get(row.name)
    if (existing) {
      matchedRowIndices.add(rowIndex)
      retailerItemMappings.push({ rowIndex, retailerItemId: existing.id, row })
      retailerItemUpdates.push({ id: existing.id, rowData: row, mergeExisting: true })
    }
  }

  // Items that need to be inserted
  for (const { rowIndex, row } of rowChunk) {
    if (!matchedRowIndices.has(rowIndex)) {
      const id = generatePrefixedId('rit')
      retailerItemMappings.push({ rowIndex, retailerItemId: id, row })
      retailerItemInserts.push({ id, rowIndex, row })
    }
  }

  // ============================================================================
  // PHASE 1b: Lookup barcodes and store item states for all retailer items
  // ============================================================================
  const allRetailerItemIds = retailerItemMappings.map((m) => m.retailerItemId)

  // Only lookup barcodes for existing items (new items have no barcodes yet)
  const existingRetailerItemIds = retailerItemMappings
    .filter((m) => !retailerItemInserts.some((ins) => ins.id === m.retailerItemId))
    .map((m) => m.retailerItemId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lookupQueries2: any[] = []

  // Query: Lookup existing barcodes
  if (existingRetailerItemIds.length > 0) {
    lookupQueries2.push(
      db.query.retailerItemBarcodes.findMany({
        where: inArray(retailerItemBarcodes.retailerItemId, existingRetailerItemIds),
      })
    )
  }

  // Query: Lookup existing store item states
  lookupQueries2.push(
    db.query.storeItemState.findMany({
      where: and(
        eq(storeItemState.storeId, store.id),
        inArray(storeItemState.retailerItemId, allRetailerItemIds),
      ),
    })
  )

  const lookupResults2 = lookupQueries2.length > 0 ? await db.batch(lookupQueries2) : []

  // Parse barcode lookup results
  let queryIndex2 = 0
  const existingBarcodesByItem = new Map<string, Set<string>>()
  if (existingRetailerItemIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const barcode of (lookupResults2[queryIndex2++] as any[])) {
      if (!existingBarcodesByItem.has(barcode.retailerItemId)) {
        existingBarcodesByItem.set(barcode.retailerItemId, new Set())
      }
      existingBarcodesByItem.get(barcode.retailerItemId)!.add(barcode.barcode)
    }
  }

  // Parse store item state lookup results
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingStatesByRetailerId = new Map((lookupResults2[queryIndex2] as any[] || []).map((s: any) => [s.retailerItemId, s]))

  // ============================================================================
  // Prepare price data with signatures
  // ============================================================================
  const priceDataPromises = retailerItemMappings.map(async (m) => {
    const signature = await computePriceSignature({
      price: m.row.price,
      discountPrice: m.row.discountPrice,
      discountStart: m.row.discountStart,
      discountEnd: m.row.discountEnd,
      unitPrice: m.row.unitPrice,
      unitPriceBaseQuantity: m.row.unitPriceBaseQuantity,
      unitPriceBaseUnit: m.row.unitPriceBaseUnit,
      lowestPrice30d: m.row.lowestPrice30d,
      anchorPrice: m.row.anchorPrice,
      anchorPriceAsOf: m.row.anchorPriceAsOf,
    })
    return { ...m, signature }
  })
  const priceData = await Promise.all(priceDataPromises)

  // Categorize price data
  const newPriceItems: Array<typeof priceData[0] & { stateId: string }> = []
  const unchangedPriceItems: Array<{ data: typeof priceData[0]; existingId: string }> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const changedPriceItems: Array<{ data: typeof priceData[0]; existing: any }> = []

  for (const item of priceData) {
    const existing = existingStatesByRetailerId.get(item.retailerItemId)
    if (!existing) {
      const stateId = generatePrefixedId('sis')
      newPriceItems.push({ ...item, stateId })
    } else if (existing.priceSignature === item.signature) {
      unchangedPriceItems.push({ data: item, existingId: existing.id })
    } else {
      changedPriceItems.push({ data: item, existing })
    }
  }

  // ============================================================================
  // PHASE 2: Batch all writes in a single db.batch() call
  // ============================================================================
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writeQueries: any[] = []

  // 1. Retailer item updates
  for (const { id, rowData, mergeExisting } of retailerItemUpdates) {
    if (mergeExisting) {
      // For name-matched items, only update if new values exist
      writeQueries.push(
        db.update(retailerItems)
          .set({
            externalId: rowData.externalId,
            description: rowData.description,
            category: rowData.category,
            subcategory: rowData.subcategory,
            brand: rowData.brand,
            unit: rowData.unit,
            unitQuantity: rowData.unitQuantity,
            imageUrl: rowData.imageUrl,
            updatedAt: now,
          })
          .where(eq(retailerItems.id, id))
      )
    } else {
      writeQueries.push(
        db.update(retailerItems)
          .set({
            name: rowData.name,
            description: rowData.description,
            category: rowData.category,
            subcategory: rowData.subcategory,
            brand: rowData.brand,
            unit: rowData.unit,
            unitQuantity: rowData.unitQuantity,
            imageUrl: rowData.imageUrl,
            updatedAt: now,
          })
          .where(eq(retailerItems.id, id))
      )
    }
  }

  // 2. Retailer item inserts (chunked to INSERT_BATCH_SIZE)
  if (retailerItemInserts.length > 0) {
    const insertData = retailerItemInserts.map(({ id, row }) => ({
      id,
      chainSlug: store.chainSlug,
      externalId: row.externalId,
      name: row.name,
      description: row.description,
      category: row.category,
      subcategory: row.subcategory,
      brand: row.brand,
      unit: row.unit,
      unitQuantity: row.unitQuantity,
      imageUrl: row.imageUrl,
    }))

    for (const insertChunk of chunk(insertData, INSERT_BATCH_SIZE)) {
      writeQueries.push(db.insert(retailerItems).values(insertChunk))
    }
  }

  // 3. Barcode inserts
  const barcodeInserts: Array<{ id: string; retailerItemId: string; barcode: string; isPrimary: boolean }> = []
  for (const mapping of retailerItemMappings) {
    if (mapping.row.barcodes.length === 0) continue

    const existingBarcodes = existingBarcodesByItem.get(mapping.retailerItemId) ?? new Set()
    const hasExisting = existingBarcodes.size > 0

    const newBarcodes = mapping.row.barcodes.filter((b) => !existingBarcodes.has(b))
    for (let i = 0; i < newBarcodes.length; i++) {
      barcodeInserts.push({
        id: generatePrefixedId('rib'),
        retailerItemId: mapping.retailerItemId,
        barcode: newBarcodes[i],
        isPrimary: !hasExisting && i === 0,
      })
    }
  }

  if (barcodeInserts.length > 0) {
    for (const insertChunk of chunk(barcodeInserts, INSERT_BATCH_SIZE)) {
      writeQueries.push(db.insert(retailerItemBarcodes).values(insertChunk))
    }
  }

  // 4. New store item states
  if (newPriceItems.length > 0) {
    const stateInserts = newPriceItems.map((item) => ({
      id: item.stateId,
      storeId: store.id,
      retailerItemId: item.retailerItemId,
      currentPrice: item.row.price,
      discountPrice: item.row.discountPrice,
      discountStart: item.row.discountStart,
      discountEnd: item.row.discountEnd,
      unitPrice: item.row.unitPrice,
      unitPriceBaseQuantity: item.row.unitPriceBaseQuantity,
      unitPriceBaseUnit: item.row.unitPriceBaseUnit,
      lowestPrice30d: item.row.lowestPrice30d,
      anchorPrice: item.row.anchorPrice,
      anchorPriceAsOf: item.row.anchorPriceAsOf,
      priceSignature: item.signature,
      lastSeenAt: now,
      updatedAt: now,
    }))

    for (const insertChunk of chunk(stateInserts, INSERT_BATCH_SIZE)) {
      writeQueries.push(db.insert(storeItemState).values(insertChunk))
    }

    // 5. New price periods for new items
    const periodInserts = newPriceItems.map((item) => ({
      id: generatePrefixedId('sip'),
      storeItemStateId: item.stateId,
      price: item.row.price,
      discountPrice: item.row.discountPrice,
      startedAt: now,
    }))

    for (const insertChunk of chunk(periodInserts, INSERT_BATCH_SIZE)) {
      writeQueries.push(db.insert(storeItemPricePeriods).values(insertChunk))
    }
  }

  // 6. Unchanged price items - update lastSeenAt
  if (unchangedPriceItems.length > 0) {
    const unchangedIds = unchangedPriceItems.map((u) => u.existingId)
    writeQueries.push(
      db.update(storeItemState)
        .set({ lastSeenAt: now })
        .where(inArray(storeItemState.id, unchangedIds))
    )
  }

  // 7. Changed price items - close old period, create new period, update state
  for (const { data, existing } of changedPriceItems) {
    // Close old period
    writeQueries.push(
      db.update(storeItemPricePeriods)
        .set({ endedAt: now })
        .where(
          and(
            eq(storeItemPricePeriods.storeItemStateId, existing.id),
            sql`${storeItemPricePeriods.endedAt} IS NULL`,
          ),
        )
    )

    // Create new period
    writeQueries.push(
      db.insert(storeItemPricePeriods).values({
        id: generatePrefixedId('sip'),
        storeItemStateId: existing.id,
        price: data.row.price,
        discountPrice: data.row.discountPrice,
        startedAt: now,
      })
    )

    // Update state
    writeQueries.push(
      db.update(storeItemState)
        .set({
          previousPrice: existing.currentPrice,
          currentPrice: data.row.price,
          discountPrice: data.row.discountPrice,
          discountStart: data.row.discountStart,
          discountEnd: data.row.discountEnd,
          unitPrice: data.row.unitPrice,
          unitPriceBaseQuantity: data.row.unitPriceBaseQuantity,
          unitPriceBaseUnit: data.row.unitPriceBaseUnit,
          lowestPrice30d: data.row.lowestPrice30d,
          anchorPrice: data.row.anchorPrice,
          anchorPriceAsOf: data.row.anchorPriceAsOf,
          priceSignature: data.signature,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(eq(storeItemState.id, existing.id))
    )
  }

  // Execute all writes in a single batch
  if (writeQueries.length > 0) {
    await db.batch(writeQueries)
  }

  // Calculate results
  result.persisted = retailerItemMappings.length
  result.priceChanges = newPriceItems.length + changedPriceItems.length
  result.unchanged = unchangedPriceItems.length

  return result
}

/**
 * Persist rows using a store identifier instead of a resolved store.
 * Resolves the store first, then persists. If autoRegister is provided
 * and the store doesn't exist, it will be created automatically.
 *
 * @param db - Database instance
 * @param chainSlug - Chain identifier
 * @param storeIdentifier - Store identifier value
 * @param rows - Normalized rows to persist
 * @param identifierType - Type of identifier (defaults to 'filename_code')
 * @param autoRegister - Optional options for auto-registering store if not found
 * @returns Persist result, or null if store not found and auto-register not provided/failed
 */
export async function persistRowsForStore(
  db: AnyDatabase,
  chainSlug: string,
  storeIdentifier: string,
  rows: NormalizedRow[],
  identifierType: string = 'filename_code',
  autoRegister?: StoreAutoRegisterOptions,
): Promise<PersistResult | null> {
  // Resolve store
  let storeId = await resolveStoreId(
    db,
    chainSlug,
    storeIdentifier,
    identifierType,
  )

  // Auto-register if not found and options provided
  if (!storeId && autoRegister) {
    storeId = await autoRegisterStore(
      db,
      chainSlug,
      storeIdentifier,
      identifierType,
      autoRegister,
    )
  }

  if (!storeId) {
    return null
  }

  // Get store details
  const storeData = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
  })

  if (!storeData) {
    return null
  }

  const store: StoreDescriptor = {
    id: storeData.id,
    chainSlug: storeData.chainSlug,
    name: storeData.name,
    address: storeData.address,
    city: storeData.city,
    postalCode: storeData.postalCode,
    latitude: storeData.latitude,
    longitude: storeData.longitude,
  }

  console.log(`[persist] Starting persist for ${rows.length} rows...`)
  return persistRows(db, store, rows)
}
