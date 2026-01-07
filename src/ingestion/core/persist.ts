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

/** Default batch size for batch operations */
const DEFAULT_BATCH_SIZE = 100

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
  unitPriceCents: number | null
  unitPriceBaseQuantity: string | null
  unitPriceBaseUnit: string | null
  lowestPrice30dCents: number | null
  anchorPriceCents: number | null
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
    up: fields.unitPriceCents,
    ubq: fields.unitPriceBaseQuantity,
    ubu: fields.unitPriceBaseUnit,
    lp30: fields.lowestPrice30dCents,
    ap: fields.anchorPriceCents,
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

  // Step 5: Batch insert new items
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

    await db.insert(retailerItems).values(newItems)
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

  // Batch insert new barcodes
  if (barcodesToInsert.length > 0) {
    await db.insert(retailerItemBarcodes).values(barcodesToInsert)
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
    unitPriceCents: row.unitPriceCents,
    unitPriceBaseQuantity: row.unitPriceBaseQuantity,
    unitPriceBaseUnit: row.unitPriceBaseUnit,
    lowestPrice30dCents: row.lowestPrice30dCents,
    anchorPriceCents: row.anchorPriceCents,
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
      unitPriceCents: row.unitPriceCents,
      unitPriceBaseQuantity: row.unitPriceBaseQuantity,
      unitPriceBaseUnit: row.unitPriceBaseUnit,
      lowestPrice30dCents: row.lowestPrice30dCents,
      anchorPriceCents: row.anchorPriceCents,
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
      unitPriceCents: row.unitPriceCents,
      unitPriceBaseQuantity: row.unitPriceBaseQuantity,
      unitPriceBaseUnit: row.unitPriceBaseUnit,
      lowestPrice30dCents: row.lowestPrice30dCents,
      anchorPriceCents: row.anchorPriceCents,
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
          unitPriceCents: item.row.unitPriceCents,
          unitPriceBaseQuantity: item.row.unitPriceBaseQuantity,
          unitPriceBaseUnit: item.row.unitPriceBaseUnit,
          lowestPrice30dCents: item.row.lowestPrice30dCents,
          anchorPriceCents: item.row.anchorPriceCents,
          anchorPriceAsOf: item.row.anchorPriceAsOf,
          priceSignature: item.signature,
          lastSeenAt: now,
          updatedAt: now,
        },
      }
    })

    // Batch insert store item states
    await db.insert(storeItemState).values(newStates.map((s) => s.stateData))

    // Batch insert price periods
    const newPeriods = newStates.map((s) => ({
      id: generatePrefixedId('sip'),
      storeItemStateId: s.stateId,
      price: s.item.row.price,
      discountPrice: s.item.row.discountPrice,
      startedAt: now,
    }))

    await db.insert(storeItemPricePeriods).values(newPeriods)
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
        unitPriceCents: data.row.unitPriceCents,
        unitPriceBaseQuantity: data.row.unitPriceBaseQuantity,
        unitPriceBaseUnit: data.row.unitPriceBaseUnit,
        lowestPrice30dCents: data.row.lowestPrice30dCents,
        anchorPriceCents: data.row.anchorPriceCents,
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
// Main Persist Functions
// ============================================================================

/**
 * Persist a batch of normalized rows for a store.
 * Uses optimized batch operations for improved performance on large datasets.
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

  for (const rowChunk of chunks) {
    try {
      // Step 1: Batch upsert retailer items
      const mappings = await batchUpsertRetailerItems(
        db,
        store.chainSlug,
        rowChunk,
      )

      // Step 2: Batch sync barcodes
      const barcodeItems = mappings.map((m) => ({
        retailerItemId: m.retailerItemId,
        barcodes: m.row.barcodes,
      }))
      await batchSyncBarcodes(db, barcodeItems)

      // Step 3: Prepare price data with signatures
      const priceDataPromises = mappings.map(async (m) => {
        const signature = await computePriceSignature({
          price: m.row.price,
          discountPrice: m.row.discountPrice,
          discountStart: m.row.discountStart,
          discountEnd: m.row.discountEnd,
          // Croatian price transparency fields
          unitPriceCents: m.row.unitPriceCents,
          unitPriceBaseQuantity: m.row.unitPriceBaseQuantity,
          unitPriceBaseUnit: m.row.unitPriceBaseUnit,
          lowestPrice30dCents: m.row.lowestPrice30dCents,
          anchorPriceCents: m.row.anchorPriceCents,
          anchorPriceAsOf: m.row.anchorPriceAsOf,
        })
        return {
          rowIndex: m.rowIndex,
          retailerItemId: m.retailerItemId,
          row: m.row,
          signature,
        } as PreparedPriceData
      })
      const priceData = await Promise.all(priceDataPromises)

      // Step 4: Batch persist prices
      const priceResults = await batchPersistPrices(db, store.id, priceData)

      // Update result statistics
      for (const pr of priceResults) {
        result.persisted++
        if (pr.priceChanged) {
          result.priceChanges++
        } else {
          result.unchanged++
        }
      }
    } catch (_error) {
      // If chunk fails, fall back to individual processing for this chunk
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
 * Persist rows using a store identifier instead of a resolved store.
 * Resolves the store first, then persists.
 *
 * @param db - Database instance
 * @param chainSlug - Chain identifier
 * @param storeIdentifier - Store identifier value
 * @param rows - Normalized rows to persist
 * @param identifierType - Type of identifier (defaults to 'filename_code')
 * @returns Persist result, or null if store not found
 */
export async function persistRowsForStore(
  db: AnyDatabase,
  chainSlug: string,
  storeIdentifier: string,
  rows: NormalizedRow[],
  identifierType: string = 'filename_code',
): Promise<PersistResult | null> {
  // Resolve store
  const storeId = await resolveStoreId(
    db,
    chainSlug,
    storeIdentifier,
    identifierType,
  )

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

  return persistRows(db, store, rows)
}
