import { and, eq, inArray, sql } from "drizzle-orm";
import * as z from "zod";
import { chains, retailerItems, stores } from "@/db/schema";
import { getClickHouse, parseNumber } from "@/lib/clickhouse";
import { getDb } from "@/utils/bindings";
import { procedure } from "../base";

type ClickHouseCatalogRow = {
	chain_slug: string;
	store_id: string;
	retailer_item_id: string;
	name: string;
	brand?: string | null;
	category?: string | null;
	price_cents?: number | string | null;
	price_status?: "available" | "unavailable" | null;
	price_unavailable_reason?: "missing" | "invalid" | "non_positive" | null;
	discount_price_cents?: number | string | null;
	last_seen_at?: string | null;
};

const toDateOnly = (value?: string) => {
	if (!value) return undefined;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return undefined;
	return date.toISOString().slice(0, 10);
};

const BrowseSortSchema = z.enum([
	"relevance",
	"price_asc",
	"price_desc",
	"name_asc",
	"name_desc",
]).default("relevance");

export const listCatalogPrices = procedure
	.input(
		z.object({
			page: z.number().int().min(1).default(1),
			pageSize: z.number().int().min(1).max(100).default(20),
			includeFutureDates: z.boolean().optional().default(false),
			chainSlug: z.string().optional(),
			chainSlugs: z.array(z.string()).optional(),
			storeId: z.string().optional(),
			storeIds: z.array(z.string()).optional(),
			category: z.string().optional(),
			search: z.string().optional(),
			dealsOnly: z.boolean().optional().default(false),
			minPrice: z.number().int().min(0).optional(),
			maxPrice: z.number().int().min(0).optional(),
			dateFrom: z.string().datetime().optional(),
			dateTo: z.string().datetime().optional(),
			sort: BrowseSortSchema.optional(),
		}),
	)
	.handler(async ({ input }) => {
		const clickhouse = getClickHouse();
		const db = getDb();
		const offset = (input.page - 1) * input.pageSize;

		const conditions: string[] = [];
		const params: Record<string, string | number> = {};
		if (!input.includeFutureDates) {
			conditions.push("target_date <= today()");
		}

		if (input.chainSlugs && input.chainSlugs.length > 0) {
			conditions.push("chain_slug IN ({chainSlugs:Array(String)})");
			(params as Record<string, unknown>).chainSlugs = input.chainSlugs;
		} else if (input.chainSlug) {
			conditions.push("chain_slug = {chainSlug:String}");
			params.chainSlug = input.chainSlug;
		}

		if (input.storeId) {
			conditions.push("store_id = {storeId:String}");
			params.storeId = input.storeId;
		}

		if (input.storeIds && input.storeIds.length > 0) {
			conditions.push("store_id IN ({storeIds:Array(String)})");
			(params as Record<string, unknown>).storeIds = input.storeIds;
			// Constrain to recent data when filtering by store to avoid full-table scan
			if (!input.dateFrom) {
				conditions.push("target_date >= today() - 30");
			}
		}

		if (input.category) {
			conditions.push("category = {category:String}");
			params.category = input.category;
		}

		if (input.search) {
			conditions.push(
				"(positionCaseInsensitiveUTF8(name, {search:String}) > 0 OR positionCaseInsensitiveUTF8(ifNull(brand, ''), {search:String}) > 0)",
			);
			params.search = input.search;
		}

		// Filter to items with active discount prices
		if (input.dealsOnly) {
			conditions.push("discount_price_cents > 0");
		}

		const dateFrom = toDateOnly(input.dateFrom);
		const dateTo = toDateOnly(input.dateTo);

		// Prevent full table scan: add default date constraint when no filters provided
		const hasStoreFilter = input.storeIds && input.storeIds.length > 0;
		const hasChainFilter = Boolean(input.chainSlug) || (input.chainSlugs != null && input.chainSlugs.length > 0);
		const hasDateFilter = dateFrom || dateTo;

		if (!hasStoreFilter && !hasChainFilter && !hasDateFilter) {
			// No specific filters - constrain to last 90 days to avoid timeout
			conditions.push("target_date >= today() - 90");
		}

		if (dateFrom) {
			conditions.push("target_date >= {dateFrom:Date}");
			params.dateFrom = dateFrom;
		}
		if (dateTo) {
			conditions.push("target_date <= {dateTo:Date}");
			params.dateTo = dateTo;
		}

		if (input.minPrice !== undefined) {
			conditions.push("price_cents >= {minPrice:Int32}");
			params.minPrice = input.minPrice;
		}
		if (input.maxPrice !== undefined) {
			conditions.push("price_cents <= {maxPrice:Int32}");
			params.maxPrice = input.maxPrice;
		}

		const whereClause =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		// Deduplicate by retailer_item_id for deals view to avoid showing
		// the same product once per store. Pick the row with the lowest
		// discount price (best deal) across all stores.
		const baseQuery = input.dealsOnly
			? `
			SELECT
				argMin(chain_slug, discount_price_cents) AS chain_slug,
				argMin(store_id, discount_price_cents) AS store_id,
				retailer_item_id,
				any(name) AS name,
				any(brand) AS brand,
				any(category) AS category,
				argMin(price_cents, discount_price_cents) AS price_cents,
				any(price_status) AS price_status,
				any(price_unavailable_reason) AS price_unavailable_reason,
				min(discount_price_cents) AS discount_price_cents,
				max(target_date) AS last_seen_at
			FROM prices_current FINAL
			${whereClause}
			GROUP BY retailer_item_id
		`
			: `
			SELECT
				chain_slug,
				store_id,
				retailer_item_id,
				name,
				brand,
				category,
				price_cents,
				price_status,
				price_unavailable_reason,
				discount_price_cents,
				target_date AS last_seen_at
			FROM prices_current FINAL
			${whereClause}
		`;

		const hasStoreIdFilter = input.storeIds && input.storeIds.length > 0;

		const sortValue = input.sort ?? "relevance";
		let orderBy: string;
		if (input.dealsOnly && sortValue === "relevance") {
			orderBy = "ORDER BY discount_price_cents ASC";
		} else if (sortValue === "price_asc") {
			orderBy = "ORDER BY if(discount_price_cents > 0, discount_price_cents, price_cents) ASC";
		} else if (sortValue === "price_desc") {
			orderBy = "ORDER BY if(discount_price_cents > 0, discount_price_cents, price_cents) DESC";
		} else if (sortValue === "name_asc") {
			orderBy = "ORDER BY name ASC";
		} else if (sortValue === "name_desc") {
			orderBy = "ORDER BY name DESC";
		} else {
			orderBy = "ORDER BY last_seen_at DESC";
		}

		const rowsPromise = clickhouse.query<ClickHouseCatalogRow>(
			`${baseQuery} ${orderBy} LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
			{
				...params,
				limit: input.pageSize,
				offset,
			},
		);

		// Skip expensive count subquery when filtering by storeIds — use result length instead
		const totalsPromise = hasStoreIdFilter
			? Promise.resolve([{ count: "0" }])
			: clickhouse.query<{ count: string }>(
					`SELECT count() AS count FROM (${baseQuery})`,
					params,
				);

		const [rows, totals] = await Promise.all([rowsPromise, totalsPromise]);

		const storeIds = Array.from(new Set(rows.map((row) => row.store_id)));
		const storeMap = new Map<
			string,
			{
				name: string;
				city: string | null;
				chainSlug: string;
				chainName: string;
			}
		>();
		if (storeIds.length > 0) {
			const storeRows = await db
				.select({
					id: stores.id,
					name: stores.name,
					city: stores.city,
					chainSlug: stores.chainSlug,
					chainName: chains.name,
				})
				.from(stores)
				.innerJoin(chains, eq(stores.chainSlug, chains.slug))
				.where(inArray(stores.id, storeIds));

			for (const store of storeRows) {
				storeMap.set(store.id, store);
			}
		}

		const prices = rows.map((row) => {
			const store = storeMap.get(row.store_id);
			const currentPrice = parseNumber(row.price_cents);
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
				id: `${row.store_id}:${row.retailer_item_id}`,
				productName: row.name,
				brand: row.brand ?? null,
				category: row.category ?? null,
				chainName: store?.chainName ?? row.chain_slug,
				chainSlug: row.chain_slug,
				storeId: row.store_id,
				storeName: store?.name ?? row.store_id,
				storeCity: store?.city ?? null,
				currentPrice,
				priceStatus,
				priceUnavailableReason: reason,
				discountPrice: parseNumber(row.discount_price_cents),
				lastSeenAt: row.last_seen_at ?? null,
			};
		});

		// When storeIds filter is active, estimate total from result count
		const total = hasStoreIdFilter
			? (offset + rows.length + (rows.length === input.pageSize ? 1 : 0))
			: Number.parseInt(totals[0]?.count ?? "0", 10);

		return {
			prices,
			total,
			page: input.page,
			pageSize: input.pageSize,
			totalPages: Math.ceil(total / input.pageSize),
		};
	});

export const getStoresByChain = procedure
	.input(z.object({ chainSlug: z.string().min(1) }))
	.handler(async ({ input }) => {
		const db = getDb();

		const storesList = await db
			.select({
				id: stores.id,
				name: stores.name,
				city: stores.city,
				isVirtual: stores.isVirtual,
			})
			.from(stores)
			.where(eq(stores.chainSlug, input.chainSlug))
			.orderBy(stores.name);

		return { stores: storesList };
	});

export const getCategories = procedure
	.input(
		z.object({
			chainSlug: z.string().optional(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();

		const conditions = [
			sql`${retailerItems.category} is not null`,
			sql`${retailerItems.category} != ''`,
		];

		if (input.chainSlug) {
			conditions.push(eq(retailerItems.chainSlug, input.chainSlug));
		}

		const categories = await db
			.select({ category: retailerItems.category })
			.from(retailerItems)
			.where(and(...conditions))
			.groupBy(retailerItems.category)
			.orderBy(retailerItems.category);

		return {
			categories: categories
				.map((item) => item.category)
				.filter((category): category is string => Boolean(category)),
		};
	});
