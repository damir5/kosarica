import { and, count, eq, like, or } from "drizzle-orm";
import * as z from "zod";
import { retailerItems } from "@/db/schema";
import { getClickHouse, parseNumber } from "@/lib/clickhouse";
import { getDb } from "@/utils/bindings";
import { escapeLikePattern } from "@/utils/sql";
import { procedure } from "../base";

type ClickHouseStorePriceRow = {
	retailer_item_id: string;
	item_external_id?: string | null;
	item_name: string;
	brand?: string | null;
	current_price?: number | string | null;
	price_status?: "available" | "unavailable" | null;
	price_unavailable_reason?: "missing" | "invalid" | "non_positive" | null;
	discount_price?: number | string | null;
	unit_price?: number | string | null;
	last_seen_at?: string | null;
};

const ChainSlugSchema = z.string().min(1);

/**
 * Get prices for a specific store from ClickHouse.
 */
export const getStorePrices = procedure
	.input(
		z.object({
			chainSlug: ChainSlugSchema,
			storeId: z.string(),
			includeFutureDates: z.boolean().optional().default(false),
			limit: z.number().int().min(1).max(1000).default(100),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ input }) => {
		const clickhouse = getClickHouse();
		const dateGuard = input.includeFutureDates
			? ""
			: "AND target_date <= today()";

		const baseQuery = `
			SELECT
				retailer_item_id,
				external_id AS item_external_id,
				name AS item_name,
				brand,
				price_cents AS current_price,
				price_status,
				price_unavailable_reason,
				discount_price_cents AS discount_price,
				unit_price_cents AS unit_price,
				target_date AS last_seen_at
			FROM prices_current FINAL
			WHERE chain_slug = {chainSlug:String} AND store_id = {storeId:String} ${dateGuard}
		`;

		const rows = await clickhouse.query<ClickHouseStorePriceRow>(
			`${baseQuery} ORDER BY last_seen_at DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
			{
				chainSlug: input.chainSlug,
				storeId: input.storeId,
				limit: input.limit,
				offset: input.offset,
			},
		);

		const totals = await clickhouse.query<{ count: string }>(
			`SELECT count() AS count FROM (${baseQuery})`,
			{
				chainSlug: input.chainSlug,
				storeId: input.storeId,
			},
		);

		const prices = rows.map((row) => {
			const currentPrice = parseNumber(row.current_price);
			const isUnavailable =
				row.price_status === "unavailable" || currentPrice === null;
			const priceStatus: "available" | "unavailable" = isUnavailable
				? "unavailable"
				: "available";
			const rawReason = row.price_unavailable_reason;
			const reason =
				isUnavailable &&
				(rawReason === "missing" ||
					rawReason === "invalid" ||
					rawReason === "non_positive")
					? rawReason
					: null;

			return {
				retailerItemId: row.retailer_item_id,
				itemExternalId: row.item_external_id ?? null,
				itemName: row.item_name,
				brand: row.brand ?? null,
				currentPrice,
				priceStatus,
				priceUnavailableReason: reason,
				discountPrice: parseNumber(row.discount_price),
				unitPrice: parseNumber(row.unit_price),
				lastSeenAt: row.last_seen_at ?? null,
			};
		});

		return {
			prices,
			total: Number.parseInt(totals[0]?.count ?? "0", 10),
		};
	});

/**
 * Search for items by name or brand in Postgres metadata.
 */
export const searchItems = procedure
	.input(
		z.object({
			query: z.string().min(3, "Search query must be at least 3 characters"),
			chainSlug: ChainSlugSchema.optional(),
			limit: z.number().int().min(1).max(100).default(20),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const search = `%${escapeLikePattern(input.query)}%`;

		const conditions = [
			or(like(retailerItems.name, search), like(retailerItems.brand, search)),
		];

		if (input.chainSlug) {
			conditions.push(eq(retailerItems.chainSlug, input.chainSlug));
		}

		const whereClause =
			conditions.length === 1 ? conditions[0] : and(...conditions);

		const [items, totalResult] = await Promise.all([
			db
				.select({
					id: retailerItems.id,
					name: retailerItems.name,
					brand: retailerItems.brand,
					category: retailerItems.category,
					subcategory: retailerItems.subcategory,
					chainSlug: retailerItems.chainSlug,
					externalId: retailerItems.externalId,
					unit: retailerItems.unit,
					unitQuantity: retailerItems.unitQuantity,
					imageUrl: retailerItems.imageUrl,
				})
				.from(retailerItems)
				.where(whereClause)
				.orderBy(retailerItems.name)
				.limit(input.limit),
			db.select({ count: count() }).from(retailerItems).where(whereClause),
		]);

		const total = Number(totalResult[0]?.count ?? 0);

		return {
			items,
			total,
			query: input.query,
		};
	});
