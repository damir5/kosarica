"use client";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "@/orpc/client";
import { PageContainer, Section } from "@/components/public/layout";
import { Heading, Text, TkCard, TkCardContent, TkSkeleton } from "@/components/public/primitives";
import { SearchBar, CategoryGrid, PriceDisplay, StoreChip, DealIndicator, type StoreSlug } from "@/components/public/domain";
import { STORE_DISPLAY_NAMES } from "@/components/public/domain/store-colors";

export const Route = createFileRoute("/_public/")({
	loader: async ({ context }) => {
		const categories = await context.queryClient.ensureQueryData(
			orpc.catalogPrices.getCategories.queryOptions({ input: {} }),
		);
		return { categories };
	},
	head: () => ({
		meta: [{ title: "Tvoja Košarica — Usporedi cijene u Hrvatskoj" }],
	}),
	component: HomePage,
});

function HomePage() {
	const { categories } = Route.useLoaderData();
	const [searchValue, setSearchValue] = useState("");
	const navigate = useNavigate();

	const categoryItems = categories.categories.map((cat) => ({
		slug: cat,
		label: cat.charAt(0).toUpperCase() + cat.slice(1),
	}));

	const dealsQuery = useQuery(
		orpc.catalogPrices.list.queryOptions({
			input: { page: 1, pageSize: 20, includeFutureDates: false },
		}),
	);

	const deals = (dealsQuery.data?.prices ?? []).filter(
		(p) => p.discountPrice != null && p.discountPrice > 0,
	).slice(0, 10);

	return (
		<PageContainer>
			<Section spacing="hero">
				<div className="flex flex-col items-center text-center gap-4">
					<Heading level={1} size="xl">
						Svaki dućan. Svaka cijena. Tvoja ušteda.
					</Heading>
					<Text className="max-w-lg text-tk-text-secondary">
						Usporedi cijene namirnica u {Object.keys(STORE_DISPLAY_NAMES).length}{" "}
						trgovačkih lanaca — u sekundi.
					</Text>
					<div className="w-full max-w-xl">
						<SearchBar
							value={searchValue}
							onChange={(v) => {
								setSearchValue(v);
								if (v.length >= 2) {
									navigate({ to: "/search", search: { q: v } });
								}
							}}
						/>
					</div>
					<div className="flex flex-wrap items-center justify-center gap-2 mt-2">
						{(Object.entries(STORE_DISPLAY_NAMES) as [StoreSlug, string][]).map(
							([slug]) => (
								<StoreChip key={slug} store={slug} variant="compact" />
							),
						)}
					</div>
				</div>
			</Section>

			<Section title="Kategorije">
				<CategoryGrid
					categories={categoryItems}
					onSelect={(slug) => {
						navigate({ to: "/search", search: { category: slug } });
					}}
				/>
			</Section>

			<Section
				title="Današnje akcije"
				action={{ label: "Sve", href: "/search?deals=true" }}
			>
				{dealsQuery.isLoading ? (
					<div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none">
						{Array.from({ length: 5 }).map((_, index) => (
							<TkSkeleton
								key={index}
								className="h-40 w-48 shrink-0"
							/>
						))}
					</div>
				) : deals.length === 0 ? (
					<Text variant="small" className="text-tk-text-tertiary">
						Trenutno nema aktivnih akcija.
					</Text>
				) : (
					<div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none">
						{deals.map((deal) => (
							<TkCard
								key={deal.id}
								hover
								className="w-48 shrink-0 cursor-pointer"
							>
								<TkCardContent className="pt-4">
									<Text variant="small" className="line-clamp-2 mb-2">
										{deal.productName}
									</Text>
									<div className="flex items-center gap-2 mb-1">
										<PriceDisplay
											amount={(deal.discountPrice ?? deal.currentPrice ?? 0) / 100}
											size="compact"
											deal="good"
										/>
										{deal.discountPrice != null && deal.currentPrice != null && (
											<Text
												as="span"
												variant="caption"
												className="line-through"
											>
												{(deal.currentPrice / 100).toFixed(2).replace(".", ",")} €
											</Text>
										)}
									</div>
									<div className="flex items-center justify-between">
										<StoreChip
											store={deal.chainSlug as StoreSlug}
											variant="compact"
										/>
										<DealIndicator level="good" />
									</div>
								</TkCardContent>
							</TkCard>
						))}
					</div>
				)}
			</Section>
		</PageContainer>
	);
}
