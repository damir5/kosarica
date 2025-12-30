/**
 * Persist Module for Ingestion Pipeline
 *
 * Handles upserting retailer items, barcodes, and store prices
 * with signature-based deduplication to minimize database writes.
 */

import { eq, and, sql } from 'drizzle-orm'
import type { Database } from '@/db'
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
// Retailer Item Operations
// ============================================================================

/**
 * Find or create a retailer item based on chain and external ID or name.
 *
 * @param db - Database instance
 * @param chainSlug - Chain identifier
 * @param row - Normalized row data
 * @returns The retailer item ID
 */
export async function upsertRetailerItem(
  db: Database,
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
 * Sync barcodes for a retailer item.
 * Adds new barcodes without duplicating existing ones.
 *
 * @param db - Database instance
 * @param retailerItemId - The retailer item ID
 * @param barcodes - Array of barcode strings
 */
export async function syncBarcodes(
  db: Database,
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
  db: Database,
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
 * @param db - Database instance
 * @param storeId - Store ID
 * @param retailerItemId - Retailer item ID
 * @param row - Normalized row data
 * @returns Persist result for this row
 */
export async function persistPrice(
  db: Database,
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
      priceSignature: signature,
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(storeItemState.id, existing.id))

  return { priceChanged: true, storeItemStateId: existing.id }
}

// ============================================================================
// Main Persist Function
// ============================================================================

/**
 * Persist a batch of normalized rows for a store.
 *
 * @param db - Database instance
 * @param store - Resolved store descriptor
 * @param rows - Normalized rows to persist
 * @returns Persist result with statistics
 */
export async function persistRows(
  db: Database,
  store: StoreDescriptor,
  rows: NormalizedRow[],
): Promise<PersistResult> {
  const result: PersistResult = {
    total: rows.length,
    persisted: 0,
    priceChanges: 0,
    unchanged: 0,
    failed: 0,
    errors: [],
  }

  for (const row of rows) {
    try {
      // 1. Upsert retailer item
      const retailerItemId = await upsertRetailerItem(db, store.chainSlug, row)

      // 2. Sync barcodes
      await syncBarcodes(db, retailerItemId, row.barcodes)

      // 3. Persist price with signature dedup
      const priceResult = await persistPrice(db, store.id, retailerItemId, row)

      result.persisted++
      if (priceResult.priceChanged) {
        result.priceChanges++
      } else {
        result.unchanged++
      }
    } catch (error) {
      result.failed++
      result.errors.push({
        rowNumber: row.rowNumber,
        error: error instanceof Error ? error.message : String(error),
      })
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
  db: Database,
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
