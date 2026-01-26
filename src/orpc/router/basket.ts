/**
 * Basket Optimization Router
 *
 * Provides basket optimization endpoints using the Go price-service.
 * Uses goFetch/goFetchWithRetry for resilient communication.
 */

import * as z from "zod";
import { goFetchWithRetry } from "@/lib/go-service-client";
import { procedure } from "../base";

// ============================================================================
// Types
// ============================================================================

const ChainSlugSchema = z.string();

const BasketItemSchema = z.object({
	itemId: z.string(),
	name: z.string(),
	quantity: z.number().int().min(1),
});

const LocationSchema = z.object({
	latitude: z.number().min(-90).max(90),
	longitude: z.number().min(-180).max(180),
});

const OptimizeRequestSchema = z.object({
	chainSlug: ChainSlugSchema,
	basketItems: z.array(BasketItemSchema).min(1).max(100),
	location: LocationSchema.optional(),
	maxDistance: z.number().optional(),
	maxStores: z.number().int().min(1).max(10).optional(),
});

// Response types (inferred from Go service responses)

const MissingItemSchema = z.object({
	itemId: z.string(),
	itemName: z.string(),
	penalty: z.number(),
	isOptional: z.boolean(),
});

const ItemPriceInfoSchema = z.object({
	itemId: z.string(),
	itemName: z.string(),
	quantity: z.number().int(),
	basePrice: z.number(),
	effectivePrice: z.number(),
	hasDiscount: z.boolean(),
	discountPrice: z.number().optional(),
	lineTotal: z.number(),
});

const SingleStoreResultSchema = z.object({
	storeId: z.string(),
	coverageRatio: z.number(),
	coverageBin: z.number(),
	sortingTotal: z.number(),
	realTotal: z.number(),
	missingItems: z.array(MissingItemSchema).optional(),
	items: z.array(ItemPriceInfoSchema).optional(),
	distance: z.number(),
});

const StoreAllocationSchema = z.object({
	storeId: z.string(),
	items: z.array(ItemPriceInfoSchema),
	storeTotal: z.number(),
	distance: z.number(),
	visitOrder: z.number().int(),
});

const MultiStoreResultSchema = z.object({
	stores: z.array(StoreAllocationSchema),
	combinedTotal: z.number(),
	coverageRatio: z.number(),
	unassignedItems: z.array(MissingItemSchema).optional(),
	algorithmUsed: z.string(),
});

const CacheFreshnessSchema = z.object({
	chainSlug: z.string(),
	loadedAt: z.number(),
	isStale: z.boolean(),
	estimatedMB: z.number(),
});

// ============================================================================
// Single-Store Optimization Routes
// ============================================================================

/**
 * Optimize basket for a single store
 * POST /internal/basket/optimize/single
 *
 * Returns a ranked list of stores based on coverage-first ranking.
 */
export const optimizeSingle = procedure
	.input(OptimizeRequestSchema)
	.handler(async ({ input }) => {
		return goFetchWithRetry("/internal/basket/optimize/single", {
			method: "POST",
			body: JSON.stringify(input),
			timeout: 2000, // 2s timeout for single-store optimization
		});
	});

// ============================================================================
// Multi-Store Optimization Routes
// ============================================================================

/**
 * Optimize basket across multiple stores
 * POST /internal/basket/optimize/multi
 *
 * Returns the optimal combination of stores for the basket.
 * Uses greedy algorithm by default, with optimal algorithm for small baskets.
 */
export const optimizeMulti = procedure
	.input(OptimizeRequestSchema)
	.handler(async ({ input }) => {
		return goFetchWithRetry("/internal/basket/optimize/multi", {
			method: "POST",
			body: JSON.stringify(input),
			timeout: 5000, // 5s timeout for multi-store optimization
		});
	});

// ============================================================================
// Cache Management Routes
// ============================================================================

/**
 * Warm up the price cache for all active chains
 * POST /internal/basket/cache/warmup
 *
 * This is an admin operation that should be called during startup
 * or when cache data is stale.
 */
export const cacheWarmup = procedure.handler(async () => {
	return goFetchWithRetry("/internal/basket/cache/warmup", {
		method: "POST",
		timeout: 30000, // 30s timeout - warmup can take time
	});
});

/**
 * Refresh the price cache for a specific chain
 * POST /internal/basket/cache/refresh/:chainSlug
 *
 * This is an admin operation to refresh a single chain's cache.
 */
export const cacheRefresh = procedure
	.input(
		z.object({
			chainSlug: ChainSlugSchema,
		}),
	)
	.handler(async ({ input }) => {
		return goFetchWithRetry(
			`/internal/basket/cache/refresh/${input.chainSlug}`,
			{
				method: "POST",
				timeout: 10000, // 10s timeout for single chain refresh
			},
		);
	});

/**
 * Get cache health status
 * GET /internal/basket/cache/health
 *
 * Returns the health status of the price cache including
 * freshness information for each chain.
 */
export const cacheHealth = procedure.handler(async () => {
	return goFetchWithRetry("/internal/basket/cache/health", {
		timeout: 5000,
	});
});

// ============================================================================
// Type Exports
// ============================================================================

export type BasketItem = z.infer<typeof BasketItemSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type OptimizeRequest = z.infer<typeof OptimizeRequestSchema>;
export type SingleStoreResult = z.infer<typeof SingleStoreResultSchema>;
export type MultiStoreResult = z.infer<typeof MultiStoreResultSchema>;
export type StoreAllocation = z.infer<typeof StoreAllocationSchema>;
export type ItemPriceInfo = z.infer<typeof ItemPriceInfoSchema>;
export type MissingItem = z.infer<typeof MissingItemSchema>;
export type CacheFreshness = z.infer<typeof CacheFreshnessSchema>;
