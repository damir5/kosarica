/**
 * Auto-generated Zod schemas from Go types
 * DO NOT EDIT - regenerate with: pnpm schema:generate
 *
 * Source: shared/schemas/prices.json
 */

import { z } from "zod";

// ============================================================================
// Schemas
// ============================================================================

export const GetHistoricalPriceRequestSchema = z.object({
	storeId: z.string(),
	itemId: z.string(),
	asOf: z.string(),
});

export const GetStorePricesRequestSchema = z.object({
	chainSlug: z.string(),
	storeId: z.string(),
	limit: z.number().int().gte(1).lte(500),
	offset: z.number().int().gte(0),
});

export const GetStorePricesResponseSchema = z.object({
	prices: z.array(
		z.object({
			retailerItemId: z.string(),
			itemName: z.string(),
			itemExternalId: z.string(),
			brand: z.string(),
			unit: z.string(),
			unitQuantity: z.string(),
			currentPrice: z.number().int(),
			previousPrice: z.number().int(),
			discountPrice: z.number().int(),
			discountStart: z.string(),
			discountEnd: z.string(),
			inStock: z.boolean(),
			unitPrice: z.number().int(),
			unitPriceBaseQuantity: z.string(),
			unitPriceBaseUnit: z.string(),
			lowestPrice30d: z.number().int(),
			anchorPrice: z.number().int(),
			priceSignature: z.string(),
			lastSeenAt: z.string(),
		}),
	),
	total: z.number().int(),
});

export const ListPriceGroupsRequestSchema = z.object({
	chainSlug: z.string(),
	limit: z.number().int().gte(1).lte(100),
	offset: z.number().int().gte(0),
});

export const PriceGroupSummarySchema = z.object({
	id: z.string(),
	chainSlug: z.string(),
	priceHash: z.string(),
	storeCount: z.number().int(),
	itemCount: z.number().int(),
	firstSeenAt: z.string(),
	lastSeenAt: z.string(),
});

export const SearchItemSchema = z.object({
	id: z.string(),
	chainSlug: z.string(),
	externalId: z.string(),
	name: z.string(),
	description: z.string(),
	brand: z.string(),
	category: z.string(),
	subcategory: z.string(),
	unit: z.string(),
	unitQuantity: z.string(),
	imageUrl: z.string(),
	avgPrice: z.number().int(),
	storeCount: z.number().int(),
});

export const SearchItemsRequestSchema = z.object({
	q: z.string().min(3),
	chainSlug: z.string(),
	limit: z.number().int().gte(1).lte(100),
});

export const SearchItemsResponseSchema = z.object({
	items: z.array(
		z.object({
			id: z.string(),
			chainSlug: z.string(),
			externalId: z.string(),
			name: z.string(),
			description: z.string(),
			brand: z.string(),
			category: z.string(),
			subcategory: z.string(),
			unit: z.string(),
			unitQuantity: z.string(),
			imageUrl: z.string(),
			avgPrice: z.number().int(),
			storeCount: z.number().int(),
		}),
	),
	total: z.number().int(),
	query: z.string(),
});

export const StorePriceSchema = z.object({
	retailerItemId: z.string(),
	itemName: z.string(),
	itemExternalId: z.string(),
	brand: z.string(),
	unit: z.string(),
	unitQuantity: z.string(),
	currentPrice: z.number().int(),
	previousPrice: z.number().int(),
	discountPrice: z.number().int(),
	discountStart: z.string(),
	discountEnd: z.string(),
	inStock: z.boolean(),
	unitPrice: z.number().int(),
	unitPriceBaseQuantity: z.string(),
	unitPriceBaseUnit: z.string(),
	lowestPrice30d: z.number().int(),
	anchorPrice: z.number().int(),
	priceSignature: z.string(),
	lastSeenAt: z.string(),
});

// ============================================================================
// Types
// ============================================================================

export type GetHistoricalPriceRequest = z.infer<
	typeof GetHistoricalPriceRequestSchema
>;
export type GetStorePricesRequest = z.infer<typeof GetStorePricesRequestSchema>;
export type GetStorePricesResponse = z.infer<
	typeof GetStorePricesResponseSchema
>;
export type ListPriceGroupsRequest = z.infer<
	typeof ListPriceGroupsRequestSchema
>;
export type PriceGroupSummary = z.infer<typeof PriceGroupSummarySchema>;
export type SearchItem = z.infer<typeof SearchItemSchema>;
export type SearchItemsRequest = z.infer<typeof SearchItemsRequestSchema>;
export type SearchItemsResponse = z.infer<typeof SearchItemsResponseSchema>;
export type StorePrice = z.infer<typeof StorePriceSchema>;
