"use client";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageContainer, Section } from "@/components/public/layout";
import {
	Heading,
	Text,
	TkCard,
	TkCardContent,
	TkSkeleton,
} from "@/components/public/primitives";
import {
	CategoryGrid,
	PriceDisplay,
	SearchBar,
} from "@/components/public/domain";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_public/")({
	loader: ({ context }) => {
		context.queryClient.prefetchQuery(
			orpc.catalog.getFeatured.queryOptions({ input: {} }),
		);
	},
	head: () => ({
		meta: [{ title: "Tvoja Košarica — Obitelji proizvoda i pametne kolekcije" }],
	}),
	component: HomePage,
});

function HomePage() {
	const navigate = useNavigate();
	const featuredQuery = useQuery(orpc.catalog.getFeatured.queryOptions({ input: {} }));

	const categories = (featuredQuery.data?.categories ?? []).map((category) => ({
		slug: category,
		label: category.charAt(0).toUpperCase() + category.slice(1),
	}));

	return (
		<PageContainer>
			<Section spacing="hero">
				<div className="flex flex-col items-center gap-4 text-center">
					<Heading level={1} size="xl">
						Pretražuj proizvode onako kako ih ljudi kupuju.
					</Heading>
					<Text className="max-w-2xl text-tk-text-secondary">
						Jedna stranica za Coca-Colu, jedan hub za đumbir, jedan pregled za
						janjetinu ili tablete za perilicu. Pakiranja, bio varijante i
						povezane kolekcije su odmah nadohvat ruke.
					</Text>
					<div className="w-full max-w-2xl">
						<SearchBar
							onChange={(value) => {
								if (value.length >= 2) {
									navigate({ to: "/search", search: { q: value } });
								}
							}}
						/>
					</div>
				</div>
			</Section>

			<Section title="Kategorije">
				<CategoryGrid
					categories={categories}
					onSelect={(slug) => navigate({ to: "/search", search: { category: slug } })}
				/>
			</Section>

			<Section title="Pametne kolekcije">
				{featuredQuery.isLoading ? (
					<div className="grid gap-4 md:grid-cols-3">
						{Array.from({ length: 6 }).map((_, index) => (
							<TkSkeleton key={index} className="h-28 w-full" />
						))}
					</div>
				) : (
					<div className="grid gap-4 md:grid-cols-3">
						{(featuredQuery.data?.collections ?? []).map((collection) => (
							<Link
								key={collection.id}
								to="/search"
								search={{ collection: collection.slug }}
							>
								<TkCard hover className="h-full cursor-pointer">
									<TkCardContent className="pt-4">
										<Text variant="caption" className="text-tk-text-tertiary">
											{collection.collectionType}
										</Text>
										<Heading size="sm" className="mt-1">
											{collection.title}
										</Heading>
									</TkCardContent>
								</TkCard>
							</Link>
						))}
					</div>
				)}
			</Section>

			<Section title="Najbolje aktualne cijene" action={{ label: "Sve", href: "/search?deals=true" }}>
				{featuredQuery.isLoading ? (
					<div className="grid gap-4 md:grid-cols-2">
						{Array.from({ length: 6 }).map((_, index) => (
							<TkSkeleton key={index} className="h-28 w-full" />
						))}
					</div>
				) : (
					<div className="grid gap-4 md:grid-cols-2">
						{(featuredQuery.data?.deals ?? []).map((family) => (
							<Link
								key={family.id}
								to="/product/$productId"
								params={{ productId: family.slug }}
							>
								<TkCard hover className="cursor-pointer">
									<TkCardContent className="pt-4">
										<Heading size="sm">{family.displayName}</Heading>
										<div className="mt-2 flex items-center justify-between gap-3">
											<div>
												<Text variant="caption" className="text-tk-text-secondary">
													{family.variantCount} pakiranja • {family.chainCount} lanaca
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
				)}
			</Section>
		</PageContainer>
	);
}
