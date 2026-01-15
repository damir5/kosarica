import { and, count, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import * as z from "zod";
import { chains, retailerItems, storeItemState, stores } from "@/db/schema";
import { getDb } from "@/utils/bindings";
import { procedure } from "../base";

export const listCatalogPrices = procedure
	.input(
		z.object({
			page: z.number().int().min(1).default(1),
			pageSize: z.number().int().min(1).max(100).default(20),
			chainSlug: z.string().optional(),
			storeId: z.string().optional(),
			category: z.string().optional(),
			search: z.string().optional(),
			minPrice: z.number().int().min(0).optional(),
			maxPrice: z.number().int().min(0).optional(),
			dateFrom: z.string().datetime().optional(),
			dateTo: z.string().datetime().optional(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const offset = (input.page - 1) * input.pageSize;

		const conditions = [];

		if (input.chainSlug) {
			conditions.push(eq(stores.chainSlug, input.chainSlug));
		}
		if (input.storeId) {
			conditions.push(eq(stores.id, input.storeId));
		}
		if (input.category) {
			conditions.push(eq(retailerItems.category, input.category));
		}
		if (input.search) {
			conditions.push(
				or(
					like(retailerItems.name, `%${input.search}%`),
					like(retailerItems.brand, `%${input.search}%`),
				),
			);
		}
		if (input.minPrice !== undefined) {
			conditions.push(gte(storeItemState.currentPrice, input.minPrice));
		}
		if (input.maxPrice !== undefined) {
			conditions.push(lte(storeItemState.currentPrice, input.maxPrice));
		}
		if (input.dateFrom) {
			conditions.push(
				gte(storeItemState.lastSeenAt, new Date(input.dateFrom)),
			);
		}
		if (input.dateTo) {
			conditions.push(
				lte(storeItemState.lastSeenAt, new Date(input.dateTo)),
			);
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

		const [prices, totalResult] = await Promise.all([
			db
				.select({
					id: storeItemState.id,
					productName: retailerItems.name,
					brand: retailerItems.brand,
					category: retailerItems.category,
					chainName: chains.name,
					chainSlug: chains.slug,
					storeId: stores.id,
					storeName: stores.name,
					storeCity: stores.city,
					currentPrice: storeItemState.currentPrice,
					discountPrice: storeItemState.discountPrice,
					lastSeenAt: storeItemState.lastSeenAt,
				})
				.from(storeItemState)
				.innerJoin(
					retailerItems,
					eq(storeItemState.retailerItemId, retailerItems.id),
				)
				.innerJoin(stores, eq(storeItemState.storeId, stores.id))
				.innerJoin(chains, eq(stores.chainSlug, chains.slug))
				.where(whereClause)
				.orderBy(desc(storeItemState.lastSeenAt))
				.limit(input.pageSize)
				.offset(offset),
			db
				.select({ count: count() })
				.from(storeItemState)
				.innerJoin(
					retailerItems,
					eq(storeItemState.retailerItemId, retailerItems.id),
				)
				.innerJoin(stores, eq(storeItemState.storeId, stores.id))
				.innerJoin(chains, eq(stores.chainSlug, chains.slug))
				.where(whereClause),
		]);

		const total = totalResult[0]?.count ?? 0;

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
