import { eq } from "drizzle-orm";
import * as z from "zod";
import { productLinks, products, retailerItems, chains } from "@/db/schema";
import { getClickHouse, parseNumber } from "@/lib/clickhouse";
import { getDb } from "@/utils/bindings";
import { procedure } from "../base";

type ClickHousePriceHistoryRow = {
	target_date: string;
	chain_slug: string;
	store_id: string;
	price_cents: number | string | null;
	discount_price_cents: number | string | null;
};

type ClickHouseCurrentPriceRow = {
	retailer_item_id: string;
	chain_slug: string;
	store_id: string;
	current_price: number | string | null;
	discount_price: number | string | null;
	last_seen_at: string;
};

export const getProductPrices = procedure
	.input(z.object({ productId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();
		const clickhouse = getClickHouse();

		// 1. Fetch product
		const [product] = await db
			.select()
			.from(products)
			.where(eq(products.id, input.productId))
			.limit(1);

		if (!product) {
			throw new Error("Product not found");
		}

		// 2. Fetch linked retailer items with chain info
		const links = await db
			.select({
				retailerItemId: productLinks.retailerItemId,
				itemName: retailerItems.name,
				chainSlug: retailerItems.chainSlug,
				chainName: chains.name,
				category: retailerItems.category,
				unit: retailerItems.unit,
				unitQuantity: retailerItems.unitQuantity,
			})
			.from(productLinks)
			.innerJoin(
				retailerItems,
				eq(productLinks.retailerItemId, retailerItems.id),
			)
			.leftJoin(chains, eq(retailerItems.chainSlug, chains.slug))
			.where(eq(productLinks.productId, input.productId));

		if (links.length === 0) {
			return {
				product: {
					id: product.id,
					name: product.name,
					category: product.category,
					unit: product.unit,
					unitQuantity: product.unitQuantity,
					brand: product.brand,
					imageUrl: product.imageUrl,
				},
				storePrices: [],
				priceHistory: [],
			};
		}

		const retailerItemIds = links.map((l) => l.retailerItemId);

		// 3. Get current prices from ClickHouse for each linked item
		const currentPriceRows = await clickhouse.query<ClickHouseCurrentPriceRow>(
			`SELECT
				retailer_item_id,
				chain_slug,
				store_id,
				argMax(price_cents, target_date) AS current_price,
				argMax(discount_price_cents, target_date) AS discount_price,
				max(target_date) AS last_seen_at
			FROM prices
			WHERE retailer_item_id IN ({itemIds:Array(String)})
				AND target_date <= today()
			GROUP BY retailer_item_id, chain_slug, store_id`,
			{ itemIds: retailerItemIds },
		);

		// Build a map of chainSlug -> chain name from links
		const chainNameMap = new Map<string, string>();
		for (const link of links) {
			if (link.chainSlug && link.chainName) {
				chainNameMap.set(link.chainSlug, link.chainName);
			}
		}

		const storePrices = currentPriceRows.map((row) => {
			const currentPrice = parseNumber(row.current_price);
			const discountPrice = parseNumber(row.discount_price);
			return {
				retailerItemId: row.retailer_item_id,
				chainSlug: row.chain_slug,
				chainName: chainNameMap.get(row.chain_slug) ?? row.chain_slug,
				storeId: row.store_id,
				currentPrice,
				discountPrice,
				effectivePrice: discountPrice ?? currentPrice,
				lastSeenAt: row.last_seen_at,
			};
		});

		// 4. Get price history (last 90 days) for the chart
		const historyRows = await clickhouse.query<ClickHousePriceHistoryRow>(
			`SELECT
				target_date,
				chain_slug,
				store_id,
				price_cents,
				discount_price_cents
			FROM prices
			WHERE retailer_item_id IN ({itemIds:Array(String)})
				AND target_date >= today() - 90
				AND target_date <= today()
			ORDER BY target_date ASC`,
			{ itemIds: retailerItemIds },
		);

		// Aggregate history: for each date, take the min effective price across all stores
		const dateMap = new Map<
			string,
			{ date: string; minPrice: number; prices: Array<{ chainSlug: string; price: number }> }
		>();

		for (const row of historyRows) {
			const price = parseNumber(row.discount_price_cents) ?? parseNumber(row.price_cents);
			if (price == null) continue;

			const priceEur = price / 100;
			const existing = dateMap.get(row.target_date);

			if (existing) {
				existing.minPrice = Math.min(existing.minPrice, priceEur);
				existing.prices.push({ chainSlug: row.chain_slug, price: priceEur });
			} else {
				dateMap.set(row.target_date, {
					date: row.target_date,
					minPrice: priceEur,
					prices: [{ chainSlug: row.chain_slug, price: priceEur }],
				});
			}
		}

		const priceHistory = Array.from(dateMap.values())
			.sort((a, b) => a.date.localeCompare(b.date))
			.map((entry) => ({
				date: entry.date,
				value: entry.minPrice,
			}));

		return {
			product: {
				id: product.id,
				name: product.name,
				category: product.category,
				unit: product.unit,
				unitQuantity: product.unitQuantity,
				brand: product.brand,
				imageUrl: product.imageUrl,
			},
			storePrices,
			priceHistory,
		};
	});
