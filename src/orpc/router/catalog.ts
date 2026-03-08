import * as z from "zod";
import {
	getCatalogCollection,
	getCatalogFamily,
	getCatalogFamilyGraph,
	getCatalogFamilyOffers,
	getFeaturedCollections,
	listCatalogCategories,
	listCatalogFamilies,
	type CatalogSort,
} from "@/lib/catalog/public";
import { procedure } from "../base";

const SortSchema = z
	.enum(["relevance", "price_asc", "price_desc", "name_asc", "name_desc"])
	.default("relevance");

export const getCategories = procedure
	.input(z.object({}).optional())
	.handler(async () => {
		return { categories: await listCatalogCategories() };
	});

export const getFeatured = procedure
	.input(
		z
			.object({
				collectionLimit: z.number().int().min(1).max(12).default(6),
				dealLimit: z.number().int().min(1).max(24).default(8),
			})
			.optional(),
	)
	.handler(async ({ input }) => {
		const collectionLimit = input?.collectionLimit ?? 6;
		const dealLimit = input?.dealLimit ?? 8;
		const [categories, collections, deals] = await Promise.all([
			listCatalogCategories(),
			getFeaturedCollections(collectionLimit),
			listCatalogFamilies({
				page: 1,
				pageSize: dealLimit,
				dealsOnly: true,
				sort: "price_asc",
			}),
		]);

		return {
			categories,
			collections,
			deals: deals.families,
		};
	});

export const listFamilies = procedure
	.input(
		z.object({
			page: z.number().int().min(1).default(1),
			pageSize: z.number().int().min(1).max(100).default(20),
			search: z.string().optional(),
			category: z.string().optional(),
			chainSlugs: z.array(z.string()).optional(),
			collectionSlug: z.string().optional(),
			dealsOnly: z.boolean().optional().default(false),
			sort: SortSchema.optional(),
		}),
	)
	.handler(async ({ input }) => {
		return await listCatalogFamilies({
			...input,
			sort: (input.sort ?? "relevance") as CatalogSort,
		});
	});

export const getFamily = procedure
	.input(
		z.object({
			familyIdOrSlug: z.string(),
		}),
	)
	.handler(async ({ input }) => {
		const family = await getCatalogFamily(input);
		if (!family) {
			throw new Error("Family not found");
		}
		return { family };
	});

export const getFamilyGraph = procedure
	.input(
		z.object({
			familyId: z.string(),
		}),
	)
	.handler(async ({ input }) => {
		return await getCatalogFamilyGraph(input);
	});

export const getFamilyOffers = procedure
	.input(
		z.object({
			familyId: z.string(),
			variantId: z.string().optional(),
		}),
	)
	.handler(async ({ input }) => {
		return {
			offers: await getCatalogFamilyOffers(input),
		};
	});

export const getCollection = procedure
	.input(
		z.object({
			slug: z.string(),
			page: z.number().int().min(1).default(1),
			pageSize: z.number().int().min(1).max(100).default(24),
		}),
	)
	.handler(async ({ input }) => {
		return await getCatalogCollection(input);
	});

