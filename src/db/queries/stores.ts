/**
 * Store Query Helpers
 *
 * Helper functions for querying stores and resolving price sources
 * for the virtual store architecture.
 *
 * Virtual stores:
 * - isVirtual: true
 * - Contain price data
 * - May be shared by multiple physical stores
 *
 * Physical stores:
 * - isVirtual: false (default)
 * - Have priceSourceStoreId pointing to a virtual store
 * - Do NOT have their own price data; they use the virtual store's prices
 */

import { and, eq, inArray } from "drizzle-orm";
import { storeItemState, stores } from "../schema";

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
export type AnyDatabase = any;

// ============================================================================
// Store Types
// ============================================================================

/**
 * Store record from the database.
 */
export interface Store {
	id: string;
	chainSlug: string;
	name: string;
	address: string | null;
	city: string | null;
	postalCode: string | null;
	latitude: string | null;
	longitude: string | null;
	isVirtual: boolean | null;
	priceSourceStoreId: string | null;
	status: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
}

/**
 * Store item state record from the database.
 */
export interface StoreItemState {
	id: string;
	storeId: string;
	retailerItemId: string;
	currentPrice: number | null;
	previousPrice: number | null;
	discountPrice: number | null;
	discountStart: Date | null;
	discountEnd: Date | null;
	inStock: boolean | null;
	unitPrice: number | null;
	unitPriceBaseQuantity: string | null;
	unitPriceBaseUnit: string | null;
	lowestPrice30d: number | null;
	anchorPrice: number | null;
	anchorPriceAsOf: Date | null;
	priceSignature: string | null;
	lastSeenAt: Date | null;
	updatedAt: Date | null;
}

// ============================================================================
// Price Source Resolution
// ============================================================================

/**
 * Returns the store ID to use for price lookups.
 * Physical stores return their priceSourceStoreId.
 * Virtual stores return their own ID.
 *
 * @param store - Store object with id and priceSourceStoreId
 * @returns The effective store ID for price lookups
 *
 * @example
 * // Virtual store (has prices)
 * getEffectivePriceStoreId({ id: 'sto_abc', priceSourceStoreId: null })
 * // Returns: 'sto_abc'
 *
 * @example
 * // Physical store (uses virtual store's prices)
 * getEffectivePriceStoreId({ id: 'sto_xyz', priceSourceStoreId: 'sto_abc' })
 * // Returns: 'sto_abc'
 */
export function getEffectivePriceStoreId(store: {
	id: string;
	priceSourceStoreId: string | null;
}): string {
	return store.priceSourceStoreId ?? store.id;
}

/**
 * Result of resolving a store with its price source.
 */
export interface StoreWithPriceSource {
	/** The original store that was queried */
	store: Store;
	/** The store to use for price lookups (may be the same as store) */
	priceStore: Store;
	/** Whether this store uses shared pricing from another store */
	usesSharedPricing: boolean;
}

/**
 * Fetches store and its price source store (if different).
 *
 * This function is useful when you need to:
 * - Display store information (use `store`)
 * - Query prices (use `priceStore`)
 * - Know if prices come from another store (check `usesSharedPricing`)
 *
 * @param db - Database instance (D1 or BetterSQLite3)
 * @param storeId - The store ID to look up
 * @returns Store with resolved price source, or null if not found
 *
 * @example
 * const result = await getStoreWithPriceSource(db, 'sto_abc123')
 * if (result) {
 *   console.log(`Store: ${result.store.name}`)
 *   console.log(`Prices from: ${result.priceStore.name}`)
 *   console.log(`Uses shared pricing: ${result.usesSharedPricing}`)
 * }
 */
export async function getStoreWithPriceSource(
	db: AnyDatabase,
	storeId: string,
): Promise<StoreWithPriceSource | null> {
	// Fetch the store
	const store = await db.query.stores.findFirst({
		where: eq(stores.id, storeId),
	});

	if (!store) {
		return null;
	}

	// If no priceSourceStoreId, this store is its own price source
	if (!store.priceSourceStoreId) {
		return {
			store: store as Store,
			priceStore: store as Store,
			usesSharedPricing: false,
		};
	}

	// Fetch the price source store
	const priceStore = await db.query.stores.findFirst({
		where: eq(stores.id, store.priceSourceStoreId),
	});

	// If price source store not found, fall back to the original store
	if (!priceStore) {
		console.warn(
			`[stores] Price source store ${store.priceSourceStoreId} not found for store ${storeId}`,
		);
		return {
			store: store as Store,
			priceStore: store as Store,
			usesSharedPricing: false,
		};
	}

	return {
		store: store as Store,
		priceStore: priceStore as Store,
		usesSharedPricing: true,
	};
}

// ============================================================================
// Price Queries
// ============================================================================

/**
 * Options for querying prices.
 */
export interface GetPricesOptions {
	/** Maximum number of prices to return */
	limit?: number;
	/** Filter by specific retailer item ID */
	retailerItemId?: string;
}

/**
 * Gets prices for a store, following priceSourceStoreId if set.
 *
 * This is the primary function for retrieving prices. It automatically
 * resolves the correct price source store for physical stores that
 * share prices with a virtual store.
 *
 * @param db - Database instance (D1 or BetterSQLite3)
 * @param storeId - The store ID to get prices for
 * @param options - Optional query parameters
 * @returns Array of store item states (prices)
 *
 * @example
 * // Get all prices for a store
 * const prices = await getPricesForStore(db, 'sto_abc123')
 *
 * @example
 * // Get specific item price
 * const prices = await getPricesForStore(db, 'sto_abc123', {
 *   retailerItemId: 'rit_xyz789'
 * })
 *
 * @example
 * // Get first 10 prices
 * const prices = await getPricesForStore(db, 'sto_abc123', { limit: 10 })
 */
export async function getPricesForStore(
	db: AnyDatabase,
	storeId: string,
	options?: GetPricesOptions,
): Promise<StoreItemState[]> {
	// First, get the store to check for priceSourceStoreId
	const store = await db.query.stores.findFirst({
		where: eq(stores.id, storeId),
	});

	if (!store) {
		return [];
	}

	// Determine which store to query for prices
	const effectiveStoreId = getEffectivePriceStoreId(store);

	// Build query conditions
	const conditions = [eq(storeItemState.storeId, effectiveStoreId)];

	if (options?.retailerItemId) {
		conditions.push(eq(storeItemState.retailerItemId, options.retailerItemId));
	}

	// Query prices
	const prices = await db.query.storeItemState.findMany({
		where: and(...conditions),
		limit: options?.limit,
	});

	return prices as StoreItemState[];
}

/**
 * Gets prices for a specific retailer item across multiple stores.
 * Follows priceSourceStoreId for each store.
 *
 * @param db - Database instance
 * @param storeIds - Array of store IDs to query
 * @param retailerItemId - The retailer item to get prices for
 * @returns Map of original store ID to price (if found)
 *
 * @example
 * const prices = await getPricesForStores(db, ['sto_1', 'sto_2'], 'rit_abc')
 * for (const [storeId, price] of prices) {
 *   console.log(`Store ${storeId}: ${price.currentPrice}`)
 * }
 */
export async function getPricesForStores(
	db: AnyDatabase,
	storeIds: string[],
	retailerItemId: string,
): Promise<Map<string, StoreItemState>> {
	if (storeIds.length === 0) {
		return new Map();
	}

	// Fetch all stores to get their price sources
	const storeList = await db.query.stores.findMany({
		where: inArray(stores.id, storeIds),
	});

	// Build mapping: effectiveStoreId -> originalStoreIds
	const effectiveToOriginal = new Map<string, string[]>();
	for (const store of storeList) {
		const effectiveId = getEffectivePriceStoreId(store);
		if (!effectiveToOriginal.has(effectiveId)) {
			effectiveToOriginal.set(effectiveId, []);
		}
		effectiveToOriginal.get(effectiveId)?.push(store.id);
	}

	// Query prices for all effective store IDs
	const effectiveIds = Array.from(effectiveToOriginal.keys());
	const prices = await db.query.storeItemState.findMany({
		where: and(
			inArray(storeItemState.storeId, effectiveIds),
			eq(storeItemState.retailerItemId, retailerItemId),
		),
	});

	// Build result map: originalStoreId -> price
	const result = new Map<string, StoreItemState>();
	for (const price of prices) {
		const originalIds = effectiveToOriginal.get(price.storeId) || [];
		for (const originalId of originalIds) {
			result.set(originalId, price as StoreItemState);
		}
	}

	return result;
}

/**
 * Gets a single price for a store and retailer item.
 * Convenience wrapper around getPricesForStore.
 *
 * @param db - Database instance
 * @param storeId - The store ID
 * @param retailerItemId - The retailer item ID
 * @returns The price record, or null if not found
 */
export async function getPriceForStoreItem(
	db: AnyDatabase,
	storeId: string,
	retailerItemId: string,
): Promise<StoreItemState | null> {
	const prices = await getPricesForStore(db, storeId, {
		retailerItemId,
		limit: 1,
	});
	return prices.length > 0 ? prices[0] : null;
}
