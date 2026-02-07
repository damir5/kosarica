import * as z from "zod";
import { autocompleteSearch, fullSearch } from "@/lib/search/queries";
import { procedure } from "../base";

const EntityTypeSchema = z.enum(["product", "item", "store"]);

const SearchFiltersSchema = z
	.object({
		entityTypes: z.array(EntityTypeSchema).optional(),
		chainSlug: z.string().optional(),
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
});

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
		const { results, total } = await fullSearch(
			input.query,
			input.limit,
			input.offset,
			input.filters,
		);

		return {
			results,
			total,
			query: input.query,
		};
	});
