"use client";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import * as z from "zod";
import { PageContainer, Section } from "@/components/public/layout";
import {
	Heading,
	Text,
	TkButton,
	TkCard,
	TkCardContent,
	TkSkeleton,
} from "@/components/public/primitives";
import {
	EmptyState,
	FilterChip,
	PriceDisplay,
	SearchBar,
} from "@/components/public/domain";
import { orpc } from "@/orpc/client";

const SORT_OPTIONS = [
	{ value: "relevance", label: "Relevantnost" },
	{ value: "price_asc", label: "Najniža cijena" },
	{ value: "price_desc", label: "Najviša cijena" },
	{ value: "name_asc", label: "Naziv A-Z" },
	{ value: "name_desc", label: "Naziv Z-A" },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]["value"];

const searchSchema = z.object({
	q: z.string().optional().default(""),
	category: z.string().optional(),
	collection: z.string().optional(),
	deals: z.boolean().optional(),
	sort: z.string().optional(),
	page: z.number().int().min(1).optional().default(1),
});

export const Route = createFileRoute("/_public/search")({
	validateSearch: searchSchema,
	head: () => ({
		meta: [{ title: "Pretraži obitelji proizvoda | Tvoja Košarica" }],
	}),
	component: SearchPage,
});

const PAGE_SIZE = 24;

function SearchPage() {
	const { q, category, collection, deals, sort, page } = Route.useSearch();
	const navigate = useNavigate({ from: "/search" });
	const activeSort = (sort as SortValue) || "relevance";

	const categoriesQuery = useQuery(orpc.catalog.getCategories.queryOptions({ input: {} }));
	const searchQuery = useQuery(
		orpc.catalog.listFamilies.queryOptions({
			input: {
				page,
				pageSize: PAGE_SIZE,
				search: q.length >= 2 ? q : undefined,
				category: category ?? undefined,
				collectionSlug: collection ?? undefined,
				dealsOnly: deals === true,
				sort: activeSort,
			},
		}),
	);
	const collectionQuery = useQuery({
		...orpc.catalog.getCollection.queryOptions({
			input: { slug: collection ?? "", page: 1, pageSize: 1 },
		}),
		enabled: Boolean(collection),
	});

	function updateSearch(updates: Partial<z.infer<typeof searchSchema>>) {
		navigate({
			search: (prev) => ({
				...prev,
				...updates,
				page: "page" in updates ? updates.page : 1,
			}),
			replace: true,
		});
	}

	return (
		<PageContainer>
			<SearchBar
				value={q}
				onChange={(value) => updateSearch({ q: value })}
				filters={
					<>
						<FilterChip
							label="Samo akcije"
							active={deals === true}
							onClick={() => updateSearch({ deals: deals ? undefined : true })}
						/>
						{(categoriesQuery.data?.categories ?? []).map((item) => (
							<FilterChip
								key={item}
								label={item.charAt(0).toUpperCase() + item.slice(1)}
								active={category === item}
								onClick={() =>
									updateSearch({ category: category === item ? undefined : item })
								}
							/>
						))}
					</>
				}
			/>

			<Section>
				{collectionQuery.data?.collection && (
					<div className="mb-4">
						<Heading size="sm">{collectionQuery.data.collection.title}</Heading>
						<Text variant="caption" className="text-tk-text-secondary">
							Automatski generirana kolekcija iz produktnog grafa.
						</Text>
					</div>
				)}
				<div className="mb-4 flex items-center justify-between">
					<Text variant="small" className="text-tk-text-secondary">
						{searchQuery.data?.total ?? 0} obitelji proizvoda
					</Text>
					<select
						value={activeSort}
						onChange={(event) =>
							updateSearch({ sort: event.target.value === "relevance" ? undefined : event.target.value })
						}
						className="rounded-full border border-tk-border bg-tk-surface px-3 py-1.5 text-xs text-tk-text-secondary"
					>
						{SORT_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</div>

				{searchQuery.isLoading ? (
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
						{Array.from({ length: 9 }).map((_, index) => (
							<TkSkeleton key={index} className="h-36 w-full" />
						))}
					</div>
				) : (searchQuery.data?.families.length ?? 0) === 0 ? (
					<EmptyState
						variant="search-empty"
						action={{
							label: "Obriši filtere",
							onClick: () => navigate({ search: { q: "", page: 1 }, replace: true }),
						}}
					/>
				) : (
					<>
						<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
							{(searchQuery.data?.families ?? []).map((family) => (
								<Link
									key={family.id}
									to="/product/$productId"
									params={{ productId: family.slug }}
								>
									<TkCard hover className="h-full cursor-pointer">
										<TkCardContent className="pt-4">
											<Heading size="sm" className="line-clamp-2">
												{family.displayName}
											</Heading>
											<div className="mt-2 flex flex-wrap gap-2">
												{family.taxonomy && (
													<Text variant="caption" className="text-tk-text-tertiary">
														{family.taxonomy}
													</Text>
												)}
												{family.qualityLabel && (
													<Text variant="caption" className="text-tk-accent">
														{family.qualityLabel}
													</Text>
												)}
											</div>
											<div className="mt-4 flex items-end justify-between gap-3">
												<div>
													<Text variant="caption" className="text-tk-text-secondary">
														{family.variantCount} pakiranja
													</Text>
													<Text variant="caption" className="block text-tk-text-secondary">
														{family.chainCount} lanaca
													</Text>
												</div>
												{family.bestPriceCents != null && (
													<PriceDisplay
														amount={family.bestPriceCents / 100}
														size="compact"
														deal={
															family.discountPriceCents != null &&
															family.discountPriceCents !== family.bestPriceCents
																? "good"
																: undefined
														}
													/>
												)}
											</div>
										</TkCardContent>
									</TkCard>
								</Link>
							))}
						</div>

						{(searchQuery.data?.page ?? 1) < (searchQuery.data?.totalPages ?? 1) && (
							<div className="mt-6 flex justify-center">
								<TkButton variant="outline" onClick={() => updateSearch({ page: page + 1 })}>
									Učitaj više
								</TkButton>
							</div>
						)}
					</>
				)}
			</Section>
		</PageContainer>
	);
}
