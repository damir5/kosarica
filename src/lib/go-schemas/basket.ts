/**
 * Auto-generated Zod schemas from Go types
 * DO NOT EDIT - regenerate with: pnpm schema:generate
 *
 * Source: shared/schemas/basket.json
 */

import { z } from "zod";

// ============================================================================
// Schemas
// ============================================================================

export const BasketItemSchema = z.object({
	itemId: z.string(),
	name: z.string(),
	quantity: z.number().int().gte(1),
});

export const ItemPriceInfoSchema = z.object({
	itemId: z.string(),
	itemName: z.string(),
	quantity: z.number().int(),
	basePrice: z.number().int(),
	effectivePrice: z.number().int(),
	hasDiscount: z.boolean(),
	discountPrice: z.number().int().optional(),
	lineTotal: z.number().int(),
});

export const LocationSchema = z.object({
	latitude: z.number().gte(-90).lte(90),
	longitude: z.number().gte(-180).lte(180),
});

export const MissingItemSchema = z.object({
	itemId: z.string(),
	itemName: z.string(),
	penalty: z.number().int(),
	isOptional: z.boolean(),
});

export const MultiStoreResultSchema = z.object({
	stores: z.array(
		z.object({
			storeId: z.string(),
			items: z.array(
				z.object({
					itemId: z.string(),
					itemName: z.string(),
					quantity: z.number().int(),
					basePrice: z.number().int(),
					effectivePrice: z.number().int(),
					hasDiscount: z.boolean(),
					discountPrice: z.number().int().optional(),
					lineTotal: z.number().int(),
				}),
			),
			storeTotal: z.number().int(),
			distance: z.number(),
			visitOrder: z.number().int(),
		}),
	),
	combinedTotal: z.number().int(),
	coverageRatio: z.number(),
	unassignedItems: z
		.array(
			z.object({
				itemId: z.string(),
				itemName: z.string(),
				penalty: z.number().int(),
				isOptional: z.boolean(),
			}),
		)
		.optional(),
	algorithmUsed: z.string(),
});

export const OptimizeRequestSchema = z.object({
	chainSlug: z.string(),
	basketItems: z
		.array(
			z.object({
				itemId: z.string(),
				name: z.string(),
				quantity: z.number().int().gte(1),
			}),
		)
		.min(1)
		.max(100),
	location: z
		.object({
			latitude: z.number().gte(-90).lte(90),
			longitude: z.number().gte(-180).lte(180),
		})
		.optional(),
	maxDistance: z.number().optional(),
	maxStores: z.number().int().gte(1).lte(10).optional(),
});

export const SingleStoreResultSchema = z.object({
	storeId: z.string(),
	coverageRatio: z.number(),
	coverageBin: z.number().int(),
	sortingTotal: z.number().int(),
	realTotal: z.number().int(),
	missingItems: z
		.array(
			z.object({
				itemId: z.string(),
				itemName: z.string(),
				penalty: z.number().int(),
				isOptional: z.boolean(),
			}),
		)
		.optional(),
	items: z
		.array(
			z.object({
				itemId: z.string(),
				itemName: z.string(),
				quantity: z.number().int(),
				basePrice: z.number().int(),
				effectivePrice: z.number().int(),
				hasDiscount: z.boolean(),
				discountPrice: z.number().int().optional(),
				lineTotal: z.number().int(),
			}),
		)
		.optional(),
	distance: z.number(),
});

export const StoreAllocationSchema = z.object({
	storeId: z.string(),
	items: z.array(
		z.object({
			itemId: z.string(),
			itemName: z.string(),
			quantity: z.number().int(),
			basePrice: z.number().int(),
			effectivePrice: z.number().int(),
			hasDiscount: z.boolean(),
			discountPrice: z.number().int().optional(),
			lineTotal: z.number().int(),
		}),
	),
	storeTotal: z.number().int(),
	distance: z.number(),
	visitOrder: z.number().int(),
});

// ============================================================================
// Types
// ============================================================================

export type BasketItem = z.infer<typeof BasketItemSchema>;
export type ItemPriceInfo = z.infer<typeof ItemPriceInfoSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type MissingItem = z.infer<typeof MissingItemSchema>;
export type MultiStoreResult = z.infer<typeof MultiStoreResultSchema>;
export type OptimizeRequest = z.infer<typeof OptimizeRequestSchema>;
export type SingleStoreResult = z.infer<typeof SingleStoreResultSchema>;
export type StoreAllocation = z.infer<typeof StoreAllocationSchema>;
