"use client";

import type { ReactNode } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShoppingBasket, Check, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";
import * as z from "zod";

import { orpc } from "@/orpc/client";
import { useDebounce } from "@/hooks/use-debounce";
import { useNearbyStores } from "@/hooks/use-nearby-stores";
import { useBasket } from "@/hooks/use-basket";
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
import {
	STORE_DISPLAY_NAMES,
	STORE_COLORS,
} from "@/components/public/domain/store-colors";

const ALL_CHAIN_SLUGS = Object.keys(STORE_DISPLAY_NAMES) as StoreSlug[];

/** Parse comma-separated chain slugs from URL param */
function parseChainsParam(value: string | undefined): StoreSlug[] {
	if (!value) return [];
	return value
		.split(",")
		.map((s) => s.trim())
		.filter((s): s is StoreSlug => s in STORE_COLORS);
}

/** Serialize chain slug array to comma-separated URL param */
function serializeChainsParam(slugs: StoreSlug[]): string | undefined {
	return slugs.length > 0 ? slugs.join(",") : undefined;
}

const SORT_OPTIONS = [
	{ value: "relevance", label: "Relevantnost" },
	{ value: "price_asc", label: "Cijena: najni\u017Ea" },
	{ value: "price_desc", label: "Cijena: najvi\u0161a" },
	{ value: "name_asc", label: "Naziv A-Z" },
	{ value: "name_desc", label: "Naziv Z-A" },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]["value"];

const searchSchema = z.object({
	q: z.string().optional().default(""),
	category: z.string().optional(),
	chains: z.string().optional(),
	deals: z.boolean().optional(),
	sort: z.string().optional(),
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
	const { q, category, chains, deals, sort, page } = Route.useSearch();
	const activeSort = (sort as SortValue) || "relevance";
	const navigate = useNavigate({ from: "/search" });

	const debouncedQ = useDebounce(q, 300);
	const { priceStoreIds, chainSlugs: nearbyChainSlugs, isActive: locationActive } = useNearbyStores();

	// Parse the comma-separated chains URL param into an array
	const selectedChains = parseChainsParam(chains);
	const hasChainFilter = selectedChains.length > 0;

	const categoriesQuery = useQuery(
		orpc.catalogPrices.getCategories.queryOptions({ input: {} }),
	);
	const categories = categoriesQuery.data?.categories ?? [];

	// Toggle a chain in the multi-select filter
	function toggleChain(slug: StoreSlug) {
		const updated = selectedChains.includes(slug)
			? selectedChains.filter((s) => s !== slug)
			: [...selectedChains, slug];
		updateSearch({ chains: serializeChainsParam(updated) });
	}

	// Full-text search is disabled when the deals filter is active because
	// full-text search does not support price/discount filtering. When deals
	// is on we fall through to the catalog browse query which supports both
	// text search (via the `search` param) and discount filtering.
	const hasSearchTerm = debouncedQ.length >= 2;
	const searchEnabled = hasSearchTerm && !deals;
	const searchQuery = useQuery({
		...orpc.search.search.queryOptions({
			input: {
				query: debouncedQ,
				limit: PAGE_SIZE,
				offset: (page - 1) * PAGE_SIZE,
				filters: {
					entityTypes: ["product", "item"],
					category: category ?? undefined,
					chainSlugs: hasChainFilter
						? selectedChains
						: locationActive
							? nearbyChainSlugs
							: undefined,
				},
				sort: activeSort,
			},
		}),
		enabled: searchEnabled,
	});

	// Catalog browsing: used when no text query, or when deals filter is
	// active. Deals filter requires ClickHouse price data so the catalog
	// query (which supports both text search and discount filtering) is used.
	const browseEnabled = !searchEnabled;
	const browseQuery = useQuery({
		...orpc.catalogPrices.list.queryOptions({
			input: {
				page,
				pageSize: PAGE_SIZE,
				includeFutureDates: false,
				category: category ?? undefined,
				chainSlugs: hasChainFilter ? selectedChains : undefined,
				dealsOnly: deals === true,
				search: browseEnabled && hasSearchTerm ? debouncedQ : undefined,
				storeIds: !hasChainFilter && locationActive ? priceStoreIds : undefined,
				sort: activeSort,
			},
		}),
		enabled: browseEnabled,
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

			{/* Chain / retailer filter row */}
			<div className="overflow-x-auto flex gap-2 pb-2 scrollbar-none -mt-1">
				{ALL_CHAIN_SLUGS.map((slug) => {
					const active = selectedChains.includes(slug);
					return (
						<ChainFilterChip
							key={slug}
							slug={slug}
							active={active}
							onClick={() => toggleChain(slug)}
						/>
					);
				})}
			</div>

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
							q || category || hasChainFilter || deals
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
						<div className="flex items-center justify-between mb-4">
							<Text variant="small" className="text-tk-text-secondary">
								{totalResults} rezultata
							</Text>
							<SortDropdown
								value={activeSort}
								onChange={(value) => updateSearch({ sort: value === "relevance" ? undefined : value })}
							/>
						</div>

						{searchEnabled ? (
							<SearchResultsWithBasket results={searchQuery.data?.results ?? []} />
						) : (
							<BrowseResultsWithBasket prices={browseQuery.data?.prices ?? []} />
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

/** Compact sort dropdown styled to match the page aesthetic */
function SortDropdown({
	value,
	onChange,
}: {
	value: SortValue;
	onChange: (value: SortValue) => void;
}) {
	return (
		<div className="relative inline-flex items-center gap-1.5">
			<ArrowUpDown className="size-3.5 text-tk-text-tertiary pointer-events-none" aria-hidden="true" />
			<select
				value={value}
				onChange={(e) => onChange(e.target.value as SortValue)}
				className="appearance-none bg-transparent text-xs text-tk-text-secondary cursor-pointer pr-4 py-1 outline-none border-none font-medium"
				aria-label="Sortiranje"
			>
				{SORT_OPTIONS.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			{/* Chevron indicator for the native select */}
			<svg
				className="absolute right-0 top-1/2 -translate-y-1/2 size-3 text-tk-text-tertiary pointer-events-none"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 20 20"
				fill="currentColor"
				aria-hidden="true"
			>
				<path
					fillRule="evenodd"
					d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
					clipRule="evenodd"
				/>
			</svg>
		</div>
	);
}

function SearchResultsWithBasket({
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
		currentPrice: number | null;
		discountPrice: number | null;
	}>;
}) {
	const { addItem, items } = useBasket();
	const basketProductIds = new Set(items.map((i) => i.productId));

	return (
		<div className="space-y-3">
			{results.map((result) => {
				const inBasket = basketProductIds.has(result.entityId);
				const effectivePriceCents = result.discountPrice ?? result.currentPrice;
				const displayPrice = effectivePriceCents != null
					? effectivePriceCents / 100
					: null;
				const hasDiscount =
					result.discountPrice != null && result.discountPrice > 0;

				return (
					<div key={result.id} className="relative">
						<Link
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
										<div className="shrink-0 flex items-start gap-2">
											{displayPrice != null && (
												<div className="text-right">
													<PriceDisplay
														amount={displayPrice}
														size="compact"
														deal={hasDiscount ? "good" : undefined}
													/>
													{hasDiscount && result.currentPrice != null && (
														<Text
															as="span"
															variant="caption"
															className="line-through block"
														>
															{(result.currentPrice / 100).toFixed(2).replace(".", ",")} €
														</Text>
													)}
												</div>
											)}
										</div>
									</div>
								</TkCardContent>
							</TkCard>
						</Link>
						<TkButton
							variant={inBasket ? "secondary" : "ghost"}
							size="icon-sm"
							className="absolute right-3 top-3"
							aria-label={inBasket ? `${result.title} je u košarici` : `Dodaj ${result.title} u košaricu`}
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								addItem.mutate(
									{
										productId: result.entityId,
										name: result.title,
										bestPrice: effectivePriceCents ?? undefined,
										bestStore: result.chainSlug as StoreSlug | undefined,
									},
									{
										onSuccess: () => {
											toast.success(`${result.title} dodan u košaricu`);
										},
									},
								);
							}}
						>
							{inBasket ? (
								<Check className="size-4 text-tk-accent" />
							) : (
								<ShoppingBasket className="size-4" />
							)}
						</TkButton>
					</div>
				);
			})}
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

/** A chain filter chip with a colored dot badge matching the homepage style */
function ChainFilterChip({
	slug,
	active,
	onClick,
}: {
	slug: StoreSlug;
	active: boolean;
	onClick: () => void;
}) {
	const color = STORE_COLORS[slug];
	const code = slug.slice(0, 2).toUpperCase();

	return (
		<button
			type="button"
			onClick={onClick}
			className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs transition-colors cursor-pointer whitespace-nowrap ${
				active
					? "bg-tk-accent-light text-tk-accent font-medium ring-1 ring-tk-accent/30"
					: "bg-tk-surface-alt text-tk-text-secondary"
			}`}
		>
			<span
				className="size-2.5 rounded-full inline-block shrink-0"
				style={{ backgroundColor: color }}
				aria-hidden="true"
			/>
			<span>{code}</span>
		</button>
	);
}

function BrowseResultsWithBasket({
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
	const { addItem, items } = useBasket();
	const basketProductIds = new Set(items.map((i) => i.productId));

	return (
		<div className="space-y-3">
			{prices.map((item) => {
				const displayPrice =
					(item.discountPrice ?? item.currentPrice ?? 0) / 100;
				const hasDiscount =
					item.discountPrice != null && item.discountPrice > 0;
				const effectivePriceCents =
					item.discountPrice ?? item.currentPrice ?? undefined;
				const inBasket = basketProductIds.has(item.id);

				return (
					<div key={item.id} className="relative">
						<TkCard hover className="cursor-pointer">
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
									<div className="shrink-0 flex items-start gap-2">
										<div className="text-right">
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
										<TkButton
											variant={inBasket ? "secondary" : "ghost"}
											size="icon-sm"
											aria-label={inBasket ? `${item.productName} je u košarici` : `Dodaj ${item.productName} u košaricu`}
											onClick={(e) => {
												e.preventDefault();
												e.stopPropagation();
												addItem.mutate(
													{
														productId: item.id,
														name: item.productName,
														bestPrice: effectivePriceCents,
														bestStore: item.chainSlug as StoreSlug,
													},
													{
														onSuccess: () => {
															toast.success(`${item.productName} dodan u košaricu`);
														},
													},
												);
											}}
										>
											{inBasket ? (
												<Check className="size-4 text-tk-accent" />
											) : (
												<ShoppingBasket className="size-4" />
											)}
										</TkButton>
									</div>
								</div>
							</TkCardContent>
						</TkCard>
					</div>
				);
			})}
		</div>
	);
}
