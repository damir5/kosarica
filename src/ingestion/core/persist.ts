/**
 * Persist Module for Ingestion Pipeline
 *
 * Handles upserting retailer items, barcodes, and store prices
 * with signature-based deduplication to minimize database writes.
 *
 * Optimized with batch operations for improved performance on large datasets.
 */

import type { InferSelectModel } from "drizzle-orm";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
	chains,
	retailerItemBarcodes,
	retailerItems,
	storeIdentifiers,
	storeItemPricePeriods,
	storeItemState,
	stores,
} from "@/db/schema";
import { generatePrefixedId } from "@/utils/id";
import { createLogger } from "@/utils/logger";
import { computeBatchSize } from "./sql";
import { computeSha256 } from "./storage";
import type { NormalizedRow, StoreDescriptor } from "./types";

const log = createLogger("ingestion");

// ============================================================================
// Type definitions for database query results
// ============================================================================

/** Type for retailer item select results */
type RetailerItemSelect = InferSelectModel<typeof retailerItems>;

/** Type for retailer item barcode select results */
type RetailerItemBarcodeSelect = InferSelectModel<typeof retailerItemBarcodes>;

/** Type for store item state select results */
type StoreItemStateSelect = InferSelectModel<typeof storeItemState>;

// ============================================================================
// Database Connection Types
// ============================================================================

/**
 * Database type for database operations.
 *
 * PostgreSQL is used across all environments:
 * - Production: PostgreSQL database
 * - Local CLI: Local PostgreSQL instance
 * - Tests: PostgreSQL test database
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDatabase = any;

/**
 * Type alias for database connection that works with both direct Database
 * and Transaction contexts. This allows helper functions to be used within
 * transactions while maintaining type safety.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseConnection = any;

// ============================================================================
// Constants
// ============================================================================

/** Default batch size for batch operations */
const DEFAULT_BATCH_SIZE = 50;

/**
 * Dynamic batch sizes computed based on column counts.
 * Configured to stay under database bound parameter limits.
 */
const BATCH_SIZE_RETAILER_ITEMS = computeBatchSize(11); // 11 columns → 7 rows
const BATCH_SIZE_BARCODES = computeBatchSize(4); // 4 columns → 20 rows
const BATCH_SIZE_STORE_ITEM_STATE = computeBatchSize(18); // 18 columns → 4 rows
const BATCH_SIZE_PRICE_PERIODS = computeBatchSize(5); // 5 columns → 16 rows

// ============================================================================
// Price Signature
// ============================================================================

/**
 * Fields used to compute the price signature.
 * When any of these change, we create a new price period.
 */
interface PriceSignatureFields {
	price: number;
	discountPrice: number | null;
	discountStart: Date | null;
	discountEnd: Date | null;
	// Croatian price transparency fields
	unitPrice: number | null;
	unitPriceBaseQuantity: string | null;
	unitPriceBaseUnit: string | null;
	lowestPrice30d: number | null;
	anchorPrice: number | null;
	anchorPriceAsOf: Date | null;
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
	});
	return computeSha256(data);
}

// ============================================================================
// Persist Result Types
// ============================================================================

/**
 * Result of persisting a single row.
 */
export interface PersistRowResult {
	/** Whether the row was successfully persisted */
	success: boolean;
	/** Retailer item ID (new or existing) */
	retailerItemId: string | null;
	/** Store item state ID */
	storeItemStateId: string | null;
	/** Whether a new price period was created */
	priceChanged: boolean;
	/** Error message if failed */
	error: string | null;
}

/**
 * Result of persisting multiple rows.
 */
export interface PersistResult {
	/** Total rows attempted */
	total: number;
	/** Successfully persisted rows */
	persisted: number;
	/** Rows where price changed (new periods created) */
	priceChanges: number;
	/** Rows where only last_seen was updated */
	unchanged: number;
	/** Rows that failed */
	failed: number;
	/** Errors encountered */
	errors: Array<{ rowNumber: number; error: string }>;
	/** Store ID that was persisted to */
	storeId?: string;
	/** True if store needs geocoding (new pending store with address) */
	needsGeocoding?: boolean;
}

// ============================================================================
// Batch Helper Types
// ============================================================================

/**
 * Maps row index to its retailer item ID after batch upsert.
 */
interface RetailerItemMapping {
	rowIndex: number;
	retailerItemId: string;
	row: NormalizedRow;
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
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
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
		});

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
				.where(eq(retailerItems.id, existing.id));

			return existing.id;
		}
	}

	// Try to find by name if no externalId match
	const byName = await db.query.retailerItems.findFirst({
		where: and(
			eq(retailerItems.chainSlug, chainSlug),
			eq(retailerItems.name, row.name),
		),
	});

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
			.where(eq(retailerItems.id, byName.id));

		return byName.id;
	}

	// Create new retailer item
	const id = generatePrefixedId("rit");
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
	});

	return id;
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
	if (barcodes.length === 0) return;

	// Get existing barcodes
	const existing = await db.query.retailerItemBarcodes.findMany({
		where: eq(retailerItemBarcodes.retailerItemId, retailerItemId),
	});
	const existingSet = new Set(
		existing.map((b: RetailerItemBarcodeSelect) => b.barcode),
	);

	// Filter to new barcodes only
	const newBarcodes = barcodes.filter((b) => !existingSet.has(b));

	if (newBarcodes.length === 0) return;

	// Insert new barcodes
	await db.insert(retailerItemBarcodes).values(
		newBarcodes.map((barcode, index) => ({
			id: generatePrefixedId("rib"),
			retailerItemId,
			barcode,
			isPrimary: existing.length === 0 && index === 0, // First barcode on empty item is primary
		})),
	);
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
	identifierType: string = "filename_code",
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
		.limit(1);

	return result.length > 0 ? result[0].storeId : null;
}

// ============================================================================
// Store Auto-Registration
// ============================================================================

/**
 * Options for auto-registering a store when it doesn't exist.
 */
export interface StoreAutoRegisterOptions {
	/** Store name (e.g., "RC DUGO SELO") */
	name: string;
	/** Optional address extracted from filename or metadata */
	address?: string;
	/** Optional city */
	city?: string;
}

/**
 * Chain configuration for auto-registration.
 */
interface ChainConfig {
	slug: string;
	name: string;
	website?: string;
}

/** Known chain configurations for auto-registration */
const CHAIN_CONFIGS: Record<string, ChainConfig> = {
	ktc: { slug: "ktc", name: "KTC", website: "https://www.ktc.hr" },
	konzum: { slug: "konzum", name: "Konzum", website: "https://www.konzum.hr" },
	lidl: { slug: "lidl", name: "Lidl", website: "https://www.lidl.hr" },
	plodine: {
		slug: "plodine",
		name: "Plodine",
		website: "https://www.plodine.hr",
	},
	interspar: {
		slug: "interspar",
		name: "Interspar",
		website: "https://www.interspar.hr",
	},
	studenac: {
		slug: "studenac",
		name: "Studenac",
		website: "https://www.studenac.hr",
	},
	kaufland: {
		slug: "kaufland",
		name: "Kaufland",
		website: "https://www.kaufland.hr",
	},
	eurospin: {
		slug: "eurospin",
		name: "Eurospin",
		website: "https://www.eurospin.hr",
	},
	dm: { slug: "dm", name: "DM", website: "https://www.dm.hr" },
	metro: { slug: "metro", name: "Metro", website: "https://www.metro.hr" },
	trgocentar: {
		slug: "trgocentar",
		name: "Trgocentar",
		website: "https://www.trgocentar.hr",
	},
};

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
	});

	if (existing) {
		return true;
	}

	// Get chain config
	const config = CHAIN_CONFIGS[chainSlug];
	if (!config) {
		log.warn("Unknown chain slug, cannot auto-register", { phase: "persist", chainSlug });
		return false;
	}

	// Create chain
	await db.insert(chains).values({
		slug: config.slug,
		name: config.name,
		website: config.website,
	});

	log.info("Auto-registered chain", { phase: "persist", name: config.name, slug: config.slug });
	return true;
}

/**
 * Result type for auto-register store operation.
 */
export interface AutoRegisterStoreResult {
	storeId: string;
	status: "existing" | "pending" | "created";
	/** True if store was newly created with address data and needs geocoding */
	needsGeocoding?: boolean;
}

/**
 * Auto-register a store when it's encountered for the first time.
 *
 * Logic:
 * 1. Try to resolve existing store by identifier -> return { storeId, status: 'existing' }
 * 2. If not found, check if physical store exists with same name in chain
 * 3. If physical match -> add identifier to it, return { storeId, status: 'existing' }
 * 4. If no match -> create store with isVirtual=true, status='pending' -> return { storeId, status: 'pending' }
 *
 * Special case: National stores (identifierType === 'national') are auto-approved
 * with isVirtual=true, status='active'.
 *
 * @param db - Database instance
 * @param chainSlug - Chain identifier
 * @param identifier - Store identifier value (e.g., "PJ50-1")
 * @param identifierType - Type of identifier (defaults to 'filename_code')
 * @param options - Store details for registration
 * @returns Store registration result with storeId and status, or null if failed
 */
export async function autoRegisterStore(
	db: AnyDatabase,
	chainSlug: string,
	identifier: string,
	identifierType: string,
	options: StoreAutoRegisterOptions,
): Promise<AutoRegisterStoreResult | null> {
	// Ensure chain exists first
	const chainExists = await ensureChainExists(db, chainSlug);
	if (!chainExists) {
		return null;
	}

	// Step 1: Try to resolve existing store by identifier
	const existingStoreId = await resolveStoreId(
		db,
		chainSlug,
		identifier,
		identifierType,
	);
	if (existingStoreId) {
		return { storeId: existingStoreId, status: "existing" };
	}

	// Step 2: Check if physical (non-virtual) store exists with same name in chain
	const physicalStore = await db.query.stores.findFirst({
		where: and(
			eq(stores.chainSlug, chainSlug),
			eq(stores.name, options.name),
			eq(stores.isVirtual, false),
		),
	});

	if (physicalStore) {
		// Step 3: Physical match found - add identifier to it
		await db.insert(storeIdentifiers).values({
			id: generatePrefixedId("sid"),
			storeId: physicalStore.id,
			type: identifierType,
			value: identifier,
		});

		log.info("Added identifier to existing physical store", {
			phase: "persist",
			identifier,
			storeName: physicalStore.name,
		});
		return { storeId: physicalStore.id, status: "existing" };
	}

	// Step 4: No match - create new virtual store
	// Determine status based on identifier type
	const isNational = identifierType === "national";
	const storeStatus = isNational ? "active" : "pending";

	const storeId = generatePrefixedId("sto");
	await db.insert(stores).values({
		id: storeId,
		chainSlug,
		name: options.name,
		address: options.address,
		city: options.city,
		isVirtual: true,
		status: storeStatus,
	});

	// Create store identifier
	await db.insert(storeIdentifiers).values({
		id: generatePrefixedId("sid"),
		storeId,
		type: identifierType,
		value: identifier,
	});

	if (isNational) {
		log.info("Auto-registered national store", {
			phase: "persist",
			name: options.name,
			identifier,
			chainSlug,
		});
		return { storeId, status: "created" };
	}

	// Pending stores with address data should be geocoded
	const hasAddressData = Boolean(options.address || options.city);
	log.info("Created pending store", {
		phase: "persist",
		name: options.name,
		identifier,
		chainSlug,
		hasAddressData,
	});

	return { storeId, status: "pending", needsGeocoding: hasAddressData };
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
	const now = new Date();

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
	});

	// Look for existing store item state
	const existing = await db.query.storeItemState.findFirst({
		where: and(
			eq(storeItemState.storeId, storeId),
			eq(storeItemState.retailerItemId, retailerItemId),
		),
	});

	if (!existing) {
		// Create new store item state
		const stateId = generatePrefixedId("sis");
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
		});

		// Create first price period
		await db.insert(storeItemPricePeriods).values({
			id: generatePrefixedId("sip"),
			storeItemStateId: stateId,
			price: row.price,
			discountPrice: row.discountPrice,
			startedAt: now,
		});

		return { priceChanged: true, storeItemStateId: stateId };
	}

	// Existing state found - check if signature changed
	if (existing.priceSignature === signature) {
		// No price change - just update last_seen_at
		await db
			.update(storeItemState)
			.set({ lastSeenAt: now })
			.where(eq(storeItemState.id, existing.id));

		return { priceChanged: false, storeItemStateId: existing.id };
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
		);

	// Create new price period
	await db.insert(storeItemPricePeriods).values({
		id: generatePrefixedId("sip"),
		storeItemStateId: existing.id,
		price: row.price,
		discountPrice: row.discountPrice,
		startedAt: now,
	});

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
		.where(eq(storeItemState.id, existing.id));

	return { priceChanged: true, storeItemStateId: existing.id };
}

// ============================================================================
// Main Persist Functions (Optimized with db.batch())
// ============================================================================

/**
 * Persist a batch of normalized rows for a store.
 * Uses db.batch() to minimize network round-trips to the database.
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
	};

	if (rows.length === 0) return result;

	// Prepare rows with indices for tracking
	const indexedRows = rows.map((row, index) => ({ rowIndex: index, row }));

	// Process in chunks to avoid memory issues
	const chunks = chunk(indexedRows, batchSize);

	let chunkIndex = 0;
	for (const rowChunk of chunks) {
		chunkIndex++;
		if (chunks.length > 10 && chunkIndex % 10 === 0) {
			log.info("Processing batch", {
				phase: "persist",
				batch: chunkIndex,
				total: chunks.length,
				percent: Math.round((chunkIndex / chunks.length) * 100),
			});
		}
		try {
			const chunkResult = await persistRowChunkBatched(db, store, rowChunk);

			// Log first batch completion
			if (chunkIndex === 1) {
				log.info("First batch completed successfully", { phase: "persist" });
			}

			// Update result statistics
			result.persisted += chunkResult.persisted;
			result.priceChanges += chunkResult.priceChanges;
			result.unchanged += chunkResult.unchanged;
			result.failed += chunkResult.failed;
			result.errors.push(...chunkResult.errors);
		} catch (error) {
			// If batch fails, fall back to individual processing for this chunk
			log.warn("Batch failed, falling back to individual processing", {
				phase: "persist",
				error: error instanceof Error ? error.message : String(error),
			});
			for (const { row } of rowChunk) {
				try {
					const retailerItemId = await upsertRetailerItem(
						db,
						store.chainSlug,
						row,
					);
					await syncBarcodes(db, retailerItemId, row.barcodes);
					const priceResult = await persistPrice(
						db,
						store.id,
						retailerItemId,
						row,
					);

					result.persisted++;
					if (priceResult.priceChanged) {
						result.priceChanges++;
					} else {
						result.unchanged++;
					}
				} catch (rowError) {
					result.failed++;
					result.errors.push({
						rowNumber: row.rowNumber,
						error:
							rowError instanceof Error ? rowError.message : String(rowError),
					});
				}
			}
		}
	}

	return result;
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
	persisted: number;
	priceChanges: number;
	unchanged: number;
	failed: number;
	errors: Array<{ rowNumber: number; error: string }>;
}> {
	const now = new Date();
	const result = {
		persisted: 0,
		priceChanges: 0,
		unchanged: 0,
		failed: 0,
		errors: [] as Array<{ rowNumber: number; error: string }>,
	};

	// Separate rows with and without externalId
	const rowsWithExternalId = rowChunk.filter((r) => r.row.externalId !== null);
	const rowsWithoutExternalId = rowChunk.filter(
		(r) => r.row.externalId === null,
	);

	// Collect all lookup keys
	const externalIds = rowsWithExternalId.map((r) => r.row.externalId as string);
	const allNames = rowChunk.map((r) => r.row.name);

	// ============================================================================
	// PHASE 1: Batch all lookups in a single db.batch() call
	// ============================================================================
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const lookupQueries: any[] = [];

	// Query 0: Lookup retailer items by externalId
	if (externalIds.length > 0) {
		lookupQueries.push(
			db.query.retailerItems.findMany({
				where: and(
					eq(retailerItems.chainSlug, store.chainSlug),
					inArray(retailerItems.externalId, externalIds),
				),
			}),
		);
	}

	// Query 1: Lookup retailer items by name (for items without externalId match)
	lookupQueries.push(
		db.query.retailerItems.findMany({
			where: and(
				eq(retailerItems.chainSlug, store.chainSlug),
				inArray(retailerItems.name, allNames),
			),
		}),
	);

	// Execute all lookups in single batch
	const lookupResults = (await db.batch(lookupQueries)) as unknown[][];

	// Parse lookup results
	let queryIndex = 0;
	const existingByExternalId =
		externalIds.length > 0
			? new Map(
					(lookupResults[queryIndex++] as RetailerItemSelect[]).map(
						(item: RetailerItemSelect) => [item.externalId, item],
					),
				)
			: new Map<string | null, RetailerItemSelect>();
	const existingByName = new Map(
		(lookupResults[queryIndex++] as RetailerItemSelect[]).map(
			(item: RetailerItemSelect) => [item.name, item],
		),
	);

	// ============================================================================
	// Process results: Categorize items for insert vs update
	// ============================================================================
	const matchedRowIndices = new Set<number>();
	const retailerItemMappings: RetailerItemMapping[] = [];

	// Items to update (existing)
	const retailerItemUpdates: Array<{
		id: string;
		rowData: NormalizedRow;
		mergeExisting?: boolean;
	}> = [];
	// Items to insert (new)
	const retailerItemInserts: Array<{
		id: string;
		rowIndex: number;
		row: NormalizedRow;
	}> = [];

	// Match by externalId first
	for (const { rowIndex, row } of rowsWithExternalId) {
		const existing = existingByExternalId.get(row.externalId as string);
		if (existing) {
			matchedRowIndices.add(rowIndex);
			retailerItemMappings.push({ rowIndex, retailerItemId: existing.id, row });
			retailerItemUpdates.push({ id: existing.id, rowData: row });
		}
	}

	// Match remaining by name
	const unmatchedRows = [
		...rowsWithExternalId.filter((r) => !matchedRowIndices.has(r.rowIndex)),
		...rowsWithoutExternalId,
	];

	for (const { rowIndex, row } of unmatchedRows) {
		const existing = existingByName.get(row.name);
		if (existing) {
			matchedRowIndices.add(rowIndex);
			retailerItemMappings.push({ rowIndex, retailerItemId: existing.id, row });
			retailerItemUpdates.push({
				id: existing.id,
				rowData: row,
				mergeExisting: true,
			});
		}
	}

	// Items that need to be inserted
	for (const { rowIndex, row } of rowChunk) {
		if (!matchedRowIndices.has(rowIndex)) {
			const id = generatePrefixedId("rit");
			retailerItemMappings.push({ rowIndex, retailerItemId: id, row });
			retailerItemInserts.push({ id, rowIndex, row });
		}
	}

	// ============================================================================
	// PHASE 1b: Lookup barcodes and store item states for all retailer items
	// ============================================================================
	const allRetailerItemIds = retailerItemMappings.map((m) => m.retailerItemId);

	// Only lookup barcodes for existing items (new items have no barcodes yet)
	const existingRetailerItemIds = retailerItemMappings
		.filter(
			(m) => !retailerItemInserts.some((ins) => ins.id === m.retailerItemId),
		)
		.map((m) => m.retailerItemId);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const lookupQueries2: any[] = [];

	// Query: Lookup existing barcodes
	if (existingRetailerItemIds.length > 0) {
		lookupQueries2.push(
			db.query.retailerItemBarcodes.findMany({
				where: inArray(
					retailerItemBarcodes.retailerItemId,
					existingRetailerItemIds,
				),
			}),
		);
	}

	// Query: Lookup existing store item states
	lookupQueries2.push(
		db.query.storeItemState.findMany({
			where: and(
				eq(storeItemState.storeId, store.id),
				inArray(storeItemState.retailerItemId, allRetailerItemIds),
			),
		}),
	);

	const lookupResults2 =
		lookupQueries2.length > 0
			? ((await db.batch(lookupQueries2)) as unknown[][])
			: ([] as unknown[][]);

	// Parse barcode lookup results
	let queryIndex2 = 0;
	const existingBarcodesByItem = new Map<string, Set<string>>();
	if (existingRetailerItemIds.length > 0) {
		for (const barcode of lookupResults2[
			queryIndex2++
		] as RetailerItemBarcodeSelect[]) {
			if (!existingBarcodesByItem.has(barcode.retailerItemId)) {
				existingBarcodesByItem.set(barcode.retailerItemId, new Set());
			}
			existingBarcodesByItem.get(barcode.retailerItemId)?.add(barcode.barcode);
		}
	}

	// Parse store item state lookup results
	const existingStatesByRetailerId = new Map(
		((lookupResults2[queryIndex2] as StoreItemStateSelect[]) || []).map(
			(s: StoreItemStateSelect) => [s.retailerItemId, s],
		),
	);

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
		});
		return { ...m, signature };
	});
	const priceData = await Promise.all(priceDataPromises);

	// Categorize price data
	const newPriceItems: Array<(typeof priceData)[0] & { stateId: string }> = [];
	const unchangedPriceItems: Array<{
		data: (typeof priceData)[0];
		existingId: string;
	}> = [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const changedPriceItems: Array<{
		data: (typeof priceData)[0];
		existing: any;
	}> = [];

	for (const item of priceData) {
		const existing = existingStatesByRetailerId.get(item.retailerItemId);
		if (!existing) {
			const stateId = generatePrefixedId("sis");
			newPriceItems.push({ ...item, stateId });
		} else if (existing.priceSignature === item.signature) {
			unchangedPriceItems.push({ data: item, existingId: existing.id });
		} else {
			changedPriceItems.push({ data: item, existing });
		}
	}

	// ============================================================================
	// PHASE 2: Batch all writes in a single db.batch() call
	// ============================================================================
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const writeQueries: any[] = [];

	// 1. Retailer item updates
	for (const { id, rowData, mergeExisting } of retailerItemUpdates) {
		if (mergeExisting) {
			// For name-matched items, only update if new values exist
			writeQueries.push(
				db
					.update(retailerItems)
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
					.where(eq(retailerItems.id, id)),
			);
		} else {
			writeQueries.push(
				db
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
					.where(eq(retailerItems.id, id)),
			);
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
		}));

		for (const insertChunk of chunk(insertData, BATCH_SIZE_RETAILER_ITEMS)) {
			writeQueries.push(db.insert(retailerItems).values(insertChunk));
		}
	}

	// 3. Barcode inserts
	const barcodeInserts: Array<{
		id: string;
		retailerItemId: string;
		barcode: string;
		isPrimary: boolean;
	}> = [];
	for (const mapping of retailerItemMappings) {
		if (mapping.row.barcodes.length === 0) continue;

		const existingBarcodes =
			existingBarcodesByItem.get(mapping.retailerItemId) ?? new Set();
		const hasExisting = existingBarcodes.size > 0;

		const newBarcodes = mapping.row.barcodes.filter(
			(b) => !existingBarcodes.has(b),
		);
		for (let i = 0; i < newBarcodes.length; i++) {
			barcodeInserts.push({
				id: generatePrefixedId("rib"),
				retailerItemId: mapping.retailerItemId,
				barcode: newBarcodes[i],
				isPrimary: !hasExisting && i === 0,
			});
		}
	}

	if (barcodeInserts.length > 0) {
		for (const insertChunk of chunk(barcodeInserts, BATCH_SIZE_BARCODES)) {
			writeQueries.push(db.insert(retailerItemBarcodes).values(insertChunk));
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
		}));

		for (const insertChunk of chunk(
			stateInserts,
			BATCH_SIZE_STORE_ITEM_STATE,
		)) {
			writeQueries.push(db.insert(storeItemState).values(insertChunk));
		}

		// 5. New price periods for new items
		const periodInserts = newPriceItems.map((item) => ({
			id: generatePrefixedId("sip"),
			storeItemStateId: item.stateId,
			price: item.row.price,
			discountPrice: item.row.discountPrice,
			startedAt: now,
		}));

		for (const insertChunk of chunk(periodInserts, BATCH_SIZE_PRICE_PERIODS)) {
			writeQueries.push(db.insert(storeItemPricePeriods).values(insertChunk));
		}
	}

	// 6. Unchanged price items - update lastSeenAt
	if (unchangedPriceItems.length > 0) {
		const unchangedIds = unchangedPriceItems.map((u) => u.existingId);
		writeQueries.push(
			db
				.update(storeItemState)
				.set({ lastSeenAt: now })
				.where(inArray(storeItemState.id, unchangedIds)),
		);
	}

	// 7. Changed price items - close old period, create new period, update state
	for (const { data, existing } of changedPriceItems) {
		// Close old period
		writeQueries.push(
			db
				.update(storeItemPricePeriods)
				.set({ endedAt: now })
				.where(
					and(
						eq(storeItemPricePeriods.storeItemStateId, existing.id),
						sql`${storeItemPricePeriods.endedAt} IS NULL`,
					),
				),
		);

		// Create new period
		writeQueries.push(
			db.insert(storeItemPricePeriods).values({
				id: generatePrefixedId("sip"),
				storeItemStateId: existing.id,
				price: data.row.price,
				discountPrice: data.row.discountPrice,
				startedAt: now,
			}),
		);

		// Update state
		writeQueries.push(
			db
				.update(storeItemState)
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
				.where(eq(storeItemState.id, existing.id)),
		);
	}

	// Execute all writes in a single batch
	if (writeQueries.length > 0) {
		await db.batch(writeQueries);
	}

	// Calculate results
	result.persisted = retailerItemMappings.length;
	result.priceChanges = newPriceItems.length + changedPriceItems.length;
	result.unchanged = unchangedPriceItems.length;

	return result;
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
	identifierType: string = "filename_code",
	autoRegister?: StoreAutoRegisterOptions,
): Promise<PersistResult | null> {
	// Resolve store or auto-register if not found
	let storeId: string | null = null;

	let needsGeocoding = false;

	if (autoRegister) {
		// Use autoRegisterStore which handles both resolution and creation
		const result = await autoRegisterStore(
			db,
			chainSlug,
			storeIdentifier,
			identifierType,
			autoRegister,
		);
		storeId = result?.storeId ?? null;
		needsGeocoding = result?.needsGeocoding ?? false;
	} else {
		// Just resolve without auto-registration
		storeId = await resolveStoreId(
			db,
			chainSlug,
			storeIdentifier,
			identifierType,
		);
	}

	if (!storeId) {
		return null;
	}

	// Get store details
	const storeData = await db.query.stores.findFirst({
		where: eq(stores.id, storeId),
	});

	if (!storeData) {
		return null;
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
	};

	log.info("Starting persist", { phase: "persist", rowCount: rows.length });
	const persistResult = await persistRows(db, store, rows);
	return { ...persistResult, storeId, needsGeocoding };
}
