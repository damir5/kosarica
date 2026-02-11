import { inArray } from "drizzle-orm";
import * as z from "zod";
import { skuItemLinks } from "@/db/schema";
import { getClickHouse, parseNumber } from "@/lib/clickhouse";
import { autocompleteSearch, fullSearch } from "@/lib/search/queries";
import type { SearchSort } from "@/lib/search/types";
import { getDb } from "@/utils/bindings";
import { procedure } from "../base";

const EntityTypeSchema = z.enum(["product", "item", "store"]);
const SearchSortSchema = z.enum(["relevance", "price_asc", "price_desc", "name_asc", "name_desc"]).default("relevance");

const SearchFiltersSchema = z
	.object({
		entityTypes: z.array(EntityTypeSchema).optional(),
		chainSlug: z.string().optional(),
		chainSlugs: z.array(z.string()).optional(),
		category: z.string().optional(),
	})
	.optional();

const AutocompleteResultSchema = z.object({
	id: z.string(),
	entityType: EntityTypeSchema,
	entityId: z.string(),
	title: z.string(),
	subtitle: z.string().nullable(),
	imageUrl: z.string().nullable(),
});

const FullSearchResultSchema = AutocompleteResultSchema.extend({
	chainSlug: z.string().nullable(),
	category: z.string().nullable(),
	body: z.string().nullable(),
	score: z.number(),
	highlights: z.object({
		title: z.string().nullable(),
		body: z.string().nullable(),
	}),
	currentPrice: z.number().nullable(),
	discountPrice: z.number().nullable(),
});

type ClickHouseBestPriceRow = {
	retailer_item_id: string;
	current_price: number | string | null;
	discount_price: number | string | null;
};

/**
 * Fetch the best (lowest effective) price per retailer item from ClickHouse.
 * Returns a map keyed by retailer_item_id.
 */
async function fetchBestPrices(
	retailerItemIds: string[],
): Promise<Map<string, { currentPrice: number | null; discountPrice: number | null }>> {
	if (retailerItemIds.length === 0) {
		return new Map();
	}

	const clickhouse = getClickHouse();
	const rows = await clickhouse.query<ClickHouseBestPriceRow>(
		`SELECT
			retailer_item_id,
			argMin(price_cents, if(discount_price_cents > 0, discount_price_cents, price_cents)) AS current_price,
			argMin(discount_price_cents, if(discount_price_cents > 0, discount_price_cents, price_cents)) AS discount_price
		FROM prices_current FINAL
		WHERE retailer_item_id IN ({itemIds:Array(String)})
		GROUP BY retailer_item_id`,
		{ itemIds: retailerItemIds },
	);

	const priceMap = new Map<string, { currentPrice: number | null; discountPrice: number | null }>();
	for (const row of rows) {
		const currentPrice = parseNumber(row.current_price);
		const discountPrice = parseNumber(row.discount_price);
		if (currentPrice != null || discountPrice != null) {
			priceMap.set(row.retailer_item_id, { currentPrice, discountPrice });
		}
	}
	return priceMap;
}

/**
 * Resolve product entity IDs (canonical SKUs or product clusters) to retailer item IDs
 * via the sku_item_links table.
 */
async function resolveProductItemIds(
	productEntityIds: string[],
): Promise<Map<string, string[]>> {
	if (productEntityIds.length === 0) {
		return new Map();
	}

	const db = getDb();
	const links = await db
		.select({
			skuId: skuItemLinks.canonicalSkuId,
			retailerItemId: skuItemLinks.retailerItemId,
		})
		.from(skuItemLinks)
		.where(inArray(skuItemLinks.canonicalSkuId, productEntityIds));

	const mapping = new Map<string, string[]>();
	for (const link of links) {
		const existing = mapping.get(link.skuId) ?? [];
		existing.push(link.retailerItemId);
		mapping.set(link.skuId, existing);
	}
	return mapping;
}

export const autocomplete = procedure
	.input(
		z.object({
			query: z.string().min(2, "Query must be at least 2 characters"),
			limit: z.number().int().min(1).max(20).default(10),
			filters: SearchFiltersSchema,
		}),
	)
	.output(z.array(AutocompleteResultSchema))
	.handler(async ({ input }) => {
		return autocompleteSearch(input.query, input.limit, input.filters);
	});

export const search = procedure
	.input(
		z.object({
			query: z.string().min(2, "Query must be at least 2 characters"),
			limit: z.number().int().min(1).max(100).default(20),
			offset: z.number().int().min(0).default(0),
			filters: SearchFiltersSchema,
			sort: SearchSortSchema.optional(),
		}),
	)
	.output(
		z.object({
			results: z.array(FullSearchResultSchema),
			total: z.number(),
			query: z.string(),
		}),
	)
	.handler(async ({ input }) => {
		const sortValue = (input.sort ?? "relevance") as SearchSort;

		// Price sorting cannot be done in PostgreSQL (prices live in ClickHouse),
		// so fall back to relevance in the DB query and re-sort in JS after enrichment.
		const dbSort: SearchSort = sortValue === "price_asc" || sortValue === "price_desc"
			? "relevance"
			: sortValue;

		const { results, total } = await fullSearch(
			input.query,
			input.limit,
			input.offset,
			input.filters,
			dbSort,
		);

		// Collect entity IDs by type to fetch prices
		const itemEntityIds: string[] = [];
		const productEntityIds: string[] = [];
		for (const result of results) {
			if (result.entityType === "item") {
				itemEntityIds.push(result.entityId);
			} else if (result.entityType === "product") {
				productEntityIds.push(result.entityId);
			}
		}

		// Resolve product entities to their retailer item IDs
		const productToItemIds = await resolveProductItemIds(productEntityIds);

		// Gather all retailer item IDs for a single ClickHouse query
		const allRetailerItemIds = [
			...itemEntityIds,
			...Array.from(productToItemIds.values()).flat(),
		];

		// Fetch best prices from ClickHouse
		const itemPriceMap = await fetchBestPrices(allRetailerItemIds);

		// Build a price lookup keyed by search entity ID
		const entityPriceMap = new Map<string, { currentPrice: number | null; discountPrice: number | null }>();

		// Items: direct mapping from entityId -> retailer_item_id
		for (const entityId of itemEntityIds) {
			const price = itemPriceMap.get(entityId);
			if (price) {
				entityPriceMap.set(entityId, price);
			}
		}

		// Products: pick the best (lowest effective) price across linked retailer items
		for (const [productId, retailerItemIds] of productToItemIds) {
			let bestPrice: { currentPrice: number | null; discountPrice: number | null } | null = null;
			let bestEffective = Number.POSITIVE_INFINITY;

			for (const itemId of retailerItemIds) {
				const price = itemPriceMap.get(itemId);
				if (!price) {
					continue;
				}
				const effective = price.discountPrice ?? price.currentPrice ?? Number.POSITIVE_INFINITY;
				if (effective < bestEffective) {
					bestEffective = effective;
					bestPrice = price;
				}
			}

			if (bestPrice) {
				entityPriceMap.set(productId, bestPrice);
			}
		}

		const enrichedResults = results.map((result) => {
			const price = entityPriceMap.get(result.entityId);
			return {
				...result,
				currentPrice: price?.currentPrice ?? null,
				discountPrice: price?.discountPrice ?? null,
			};
		});

		// Apply price-based sorting in JS since prices come from ClickHouse
		if (sortValue === "price_asc" || sortValue === "price_desc") {
			const direction = sortValue === "price_asc" ? 1 : -1;
			enrichedResults.sort((a, b) => {
				const priceA = a.discountPrice ?? a.currentPrice;
				const priceB = b.discountPrice ?? b.currentPrice;
				// Items without price go to the end
				if (priceA == null && priceB == null) return 0;
				if (priceA == null) return 1;
				if (priceB == null) return -1;
				return (priceA - priceB) * direction;
			});
		}

		return {
			results: enrichedResults,
			total,
			query: input.query,
		};
	});
