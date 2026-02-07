"use client";

import type { ReactNode } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import * as z from "zod";

import { orpc } from "@/orpc/client";
import { useDebounce } from "@/hooks/use-debounce";
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
	SearchBar,
	FilterChip,
	EmptyState,
	PriceDisplay,
	StoreChip,
	type StoreSlug,
} from "@/components/public/domain";

const searchSchema = z.object({
	q: z.string().optional().default(""),
	category: z.string().optional(),
	chain: z.string().optional(),
	deals: z.boolean().optional(),
	page: z.number().int().min(1).optional().default(1),
});

export const Route = createFileRoute("/_public/search")({
	validateSearch: searchSchema,
	head: () => ({
		meta: [{ title: "Traži | Tvoja Košarica" }],
	}),
	component: SearchPage,
});

const PAGE_SIZE = 20;

function SearchPage() {
	const { q, category, chain, deals, page } = Route.useSearch();
	const navigate = useNavigate({ from: "/search" });

	const debouncedQ = useDebounce(q, 300);

	const categoriesQuery = useQuery(
		orpc.catalogPrices.getCategories.queryOptions({ input: {} }),
	);
	const categories = categoriesQuery.data?.categories ?? [];

	// Full-text search
	const searchEnabled = debouncedQ.length >= 2;
	const searchQuery = useQuery({
		...orpc.search.search.queryOptions({
			input: {
				query: debouncedQ,
				limit: PAGE_SIZE,
				offset: (page - 1) * PAGE_SIZE,
				filters: {
					category: category ?? undefined,
					chainSlug: chain ?? undefined,
				},
			},
		}),
		enabled: searchEnabled,
	});

	// Category-based browsing when no text query
	const browseQuery = useQuery({
		...orpc.catalogPrices.list.queryOptions({
			input: {
				page,
				pageSize: PAGE_SIZE,
				includeFutureDates: false,
				category: category ?? undefined,
				chainSlug: chain ?? undefined,
			},
		}),
		enabled: !searchEnabled,
	});

	const isLoading = searchEnabled
		? searchQuery.isLoading
		: browseQuery.isLoading;
	const hasResults = searchEnabled
		? (searchQuery.data?.results?.length ?? 0) > 0
		: (browseQuery.data?.prices?.length ?? 0) > 0;
	const totalResults = searchEnabled
		? (searchQuery.data?.total ?? 0)
		: (browseQuery.data?.total ?? 0);

	function updateSearch(updates: Partial<z.infer<typeof searchSchema>>) {
		navigate({
			search: (prev) => ({
				...prev,
				...updates,
				// Reset page when filters change
				page: "page" in updates ? updates.page : 1,
			}),
			replace: true,
		});
	}

	return (
		<PageContainer>
			<SearchBar
				value={q}
				onChange={(v) => updateSearch({ q: v })}
				filters={
					<>
						<FilterChip
							label="Samo akcije"
							active={deals === true}
							onClick={() => updateSearch({ deals: deals ? undefined : true })}
						/>
						{categories.map((cat) => (
							<FilterChip
								key={cat}
								label={cat.charAt(0).toUpperCase() + cat.slice(1)}
								active={category === cat}
								onClick={() =>
									updateSearch({
										category: category === cat ? undefined : cat,
									})
								}
							/>
						))}
					</>
				}
			/>

			<Section>
				{isLoading ? (
					<div className="space-y-3">
						{Array.from({ length: 5 }).map((_, index) => (
							<TkSkeleton
								key={index}
								className="h-24 w-full"
							/>
						))}
					</div>
				) : !hasResults ? (
					<EmptyState
						variant="search-empty"
						action={
							q || category || chain || deals
								? {
										label: "Obriši filtere",
										onClick: () =>
											navigate({
												search: { q: "", page: 1 },
												replace: true,
											}),
									}
								: undefined
						}
					/>
				) : (
					<>
						<Text variant="small" className="text-tk-text-secondary mb-4">
							{totalResults} rezultata
						</Text>

						{searchEnabled ? (
							<SearchResults results={searchQuery.data?.results ?? []} />
						) : (
							<BrowseResults prices={browseQuery.data?.prices ?? []} />
						)}

						{page * PAGE_SIZE < totalResults && (
							<div className="flex justify-center mt-6">
								<TkButton
									variant="outline"
									onClick={() => updateSearch({ page: page + 1 })}
								>
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

function SearchResults({
	results,
}: {
	results: Array<{
		id: string;
		entityType: string;
		entityId: string;
		title: string;
		subtitle: string | null;
		chainSlug: string | null;
		category: string | null;
		score: number;
		highlights: { title: string | null; body: string | null };
	}>;
}) {
	return (
		<div className="space-y-3">
			{results.map((result) => (
				<Link
					key={result.id}
					to="/product/$productId"
					params={{ productId: result.entityId }}
					className="block"
				>
					<TkCard hover className="cursor-pointer">
						<TkCardContent className="pt-4">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0 flex-1">
									<Heading size="sm" className="line-clamp-2">
									{result.highlights.title
										? renderHighlight(result.highlights.title)
										: result.title}
								</Heading>
									<div className="flex items-center gap-2 mt-1">
										{result.subtitle && (
											<Text variant="caption" className="line-clamp-1">
												{result.subtitle}
											</Text>
										)}
										{result.chainSlug && (
											<StoreChip
												store={result.chainSlug as StoreSlug}
												variant="compact"
											/>
										)}
										{result.category && (
											<Text
												as="span"
												variant="caption"
												className="text-tk-text-tertiary"
											>
												{result.category}
											</Text>
										)}
									</div>
								</div>
							</div>
						</TkCardContent>
					</TkCard>
				</Link>
			))}
		</div>
	);
}

/**
 * Safely render search highlights by splitting on <mark> tags
 * and returning React elements instead of using dangerouslySetInnerHTML.
 */
function renderHighlight(html: string): ReactNode[] {
	const parts = html.split(/(<mark>|<\/mark>)/);
	const nodes: ReactNode[] = [];
	let inMark = false;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === "<mark>") {
			inMark = true;
			continue;
		}
		if (part === "</mark>") {
			inMark = false;
			continue;
		}
		if (part) {
			nodes.push(
				inMark ? (
					<mark key={i} className="bg-tk-accent/20 text-tk-text">
						{part}
					</mark>
				) : (
					part
				),
			);
		}
	}
	return nodes;
}

function BrowseResults({
	prices,
}: {
	prices: Array<{
		id: string;
		productName: string;
		brand: string | null;
		category: string | null;
		chainSlug: string;
		storeName: string;
		currentPrice: number | null;
		discountPrice: number | null;
	}>;
}) {
	return (
		<div className="space-y-3">
			{prices.map((item) => {
				const displayPrice =
					(item.discountPrice ?? item.currentPrice ?? 0) / 100;
				const hasDiscount =
					item.discountPrice != null && item.discountPrice > 0;

				return (
					<TkCard key={item.id} hover className="cursor-pointer">
						<TkCardContent className="pt-4">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0 flex-1">
									<Heading size="sm" className="line-clamp-2">
										{item.productName}
									</Heading>
									<div className="flex items-center gap-2 mt-1">
										{item.brand && (
											<Text variant="caption">{item.brand}</Text>
										)}
										<StoreChip
											store={item.chainSlug as StoreSlug}
											variant="compact"
										/>
										{item.category && (
											<Text
												as="span"
												variant="caption"
												className="text-tk-text-tertiary"
											>
												{item.category}
											</Text>
										)}
									</div>
								</div>
								<div className="shrink-0 text-right">
									<PriceDisplay
										amount={displayPrice}
										size="compact"
										deal={hasDiscount ? "good" : undefined}
									/>
									{hasDiscount && item.currentPrice != null && (
										<Text
											as="span"
											variant="caption"
											className="line-through block"
										>
											{(item.currentPrice / 100).toFixed(2).replace(".", ",")} €
										</Text>
									)}
								</div>
							</div>
						</TkCardContent>
					</TkCard>
				);
			})}
		</div>
	);
}
