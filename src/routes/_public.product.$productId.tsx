"use client";

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { Check, ShoppingBasket } from "lucide-react";
import { toast } from "sonner";
import {
	DataFreshnessBadge,
	PriceComparisonRow,
	SimilarVariantCard,
	type StoreSlug,
} from "@/components/public/domain";
import { PageContainer, Section } from "@/components/public/layout";
import {
	Heading,
	Text,
	TkButton,
	TkSkeleton,
} from "@/components/public/primitives";
import { computeDealLevel } from "@/lib/deal-levels";
import { useNearbyStores } from "@/hooks/use-nearby-stores";
import { useBasket } from "@/hooks/use-basket";
import { orpc } from "@/orpc/client";

const PriceHistoryChart = lazy(() =>
	import("@/components/public/charts").then((m) => ({
		default: m.PriceHistoryChart,
	})),
);

export const Route = createFileRoute("/_public/product/$productId")({
	loader: ({ context, params }) => {
		context.queryClient.prefetchQuery(
			orpc.products.get.queryOptions({
				input: { productId: params.productId },
			}),
		);
	},
	head: () => ({
		meta: [
			{
				title: "Proizvod | Tvoja Košarica",
			},
		],
	}),
	component: ProductDetailPage,
});

function ProductDetailPage() {
	const { productId } = Route.useParams();
	const router = useRouter();
	const { priceStoreIds, isActive: locationActive } = useNearbyStores();
	const [showAll, setShowAll] = useState(false);
	const { addItem, items } = useBasket();
	const isInBasket = items.some((i) => i.productId === productId);

	const { data, isLoading } = useQuery(
		orpc.products.get.queryOptions({
			input: { productId },
		}),
	);

	if (isLoading || !data) {
		return (
			<PageContainer>
				<TkSkeleton className="h-8 w-48 mb-4" />
				<TkSkeleton className="h-6 w-32 mb-6" />
				<TkSkeleton className="h-[200px] w-full mb-4" />
				<TkSkeleton className="h-24 w-full mb-2" />
				<TkSkeleton className="h-24 w-full mb-2" />
				<TkSkeleton className="h-24 w-full" />
			</PageContainer>
		);
	}

	const { product, storePrices, priceHistory } = data;

	// Filter store prices by nearby stores when location is active
	const filteredStorePrices = locationActive && !showAll
		? storePrices.filter((sp) => priceStoreIds.includes(sp.storeId))
		: storePrices;

	// Deduplicate store prices: keep the lowest effective price per chain
	const bestByChain = new Map<string, (typeof storePrices)[number]>();
	for (const sp of filteredStorePrices) {
		const existing = bestByChain.get(sp.chainSlug);
		if (
			!existing ||
			(sp.effectivePrice != null &&
				(existing.effectivePrice == null ||
					sp.effectivePrice < existing.effectivePrice))
		) {
			bestByChain.set(sp.chainSlug, sp);
		}
	}

	const uniquePrices = Array.from(bestByChain.values())
		.filter((sp) => sp.effectivePrice != null)
		.sort((a, b) => (a.effectivePrice ?? 0) - (b.effectivePrice ?? 0));

	const bestPrice =
		uniquePrices.length > 0 ? (uniquePrices[0].effectivePrice ?? 0) : 0;

	const comparisonPrices = uniquePrices.map((sp) => {
		const priceEur = (sp.effectivePrice ?? 0) / 100;
		return {
			store: sp.chainSlug as StoreSlug,
			price: priceEur,
			deal: computeDealLevel(sp.effectivePrice ?? 0, bestPrice),
			itemName: sp.itemName || undefined,
			unitPrice: sp.unitPriceCents != null ? sp.unitPriceCents / 100 : null,
			unitLabel: sp.unitLabel,
		};
	});

	const latestDate = storePrices.reduce<string | null>((latest, sp) => {
		if (!latest || sp.lastSeenAt > latest) return sp.lastSeenAt;
		return latest;
	}, null);

	return (
		<PageContainer>
			<div className="mb-4">
				<TkButton
					variant="ghost"
					size="sm"
					onClick={() => router.history.back()}
				>
					&larr; Natrag
				</TkButton>
			</div>

			<Heading level={1} size="xl">
				{product.name}
			</Heading>
			<div className="flex items-center gap-2 mt-1 mb-6">
				{product.category && (
					<Text as="span" variant="caption" className="text-tk-text-secondary">
						{product.category}
					</Text>
				)}
				{product.unit && (
					<Text as="span" variant="caption" className="text-tk-text-secondary">
						{product.unit}
						{product.unitQuantity ? ` ${product.unitQuantity}` : ""}
					</Text>
				)}
				{latestDate && <DataFreshnessBadge lastUpdated={latestDate} />}
			</div>

			{priceHistory.length >= 2 && (
				<Section title="Povijest cijena">
					<Suspense fallback={<TkSkeleton className="h-[200px] w-full" />}>
						<PriceHistoryChart data={priceHistory} />
					</Suspense>
				</Section>
			)}

			{comparisonPrices.length > 0 && (
				<Section title="Cijene po trgovinama">
					{locationActive && (
						<div className="flex justify-end mb-2">
							<button
								type="button"
								onClick={() => setShowAll((prev) => !prev)}
								className="text-xs font-medium text-tk-accent hover:underline"
							>
								{showAll ? "Samo bliske trgovine" : "Sve trgovine"}
							</button>
						</div>
					)}
					<PriceComparisonRow
						productName={product.name}
						category={product.category ?? undefined}
						unit={
							product.unit
								? `${product.unit}${product.unitQuantity ? ` ${product.unitQuantity}` : ""}`
								: undefined
						}
						prices={comparisonPrices}
					/>
				</Section>
			)}

			{comparisonPrices.length === 0 && (
				<Section>
					<Text className="text-tk-text-secondary">
						Trenutno nema dostupnih cijena za ovaj proizvod.
					</Text>
				</Section>
			)}

			<SimilarVariantsSection productId={product.id} />

			{comparisonPrices.length > 0 && (
				<div className="flex gap-2 mt-6 mb-8">
					<TkButton
						onClick={() => {
							addItem.mutate(
								{
									productId: product.id,
									name: product.name,
									bestPrice: bestPrice > 0 ? bestPrice : undefined,
									bestStore:
										uniquePrices.length > 0
											? (uniquePrices[0].chainSlug as StoreSlug)
											: undefined,
								},
								{
									onSuccess: () => {
										toast.success(`${product.name} dodan u košaricu`);
									},
								},
							);
						}}
					>
						{isInBasket ? (
							<>
								<Check className="size-4" />
								U košarici &mdash; dodaj još
							</>
						) : (
							<>
								<ShoppingBasket className="size-4" />
								Dodaj u košaricu
							</>
						)}
					</TkButton>
					<TkButton variant="outline">Postavi alarm</TkButton>
				</div>
			)}
		</PageContainer>
	);
}

function SimilarVariantsSection({ productId }: { productId: string }) {
	const { data: variants, isLoading } = useQuery(
		orpc.products.getSimilarVariants.queryOptions({
			input: { productId },
		}),
	);

	if (!isLoading && (!variants || variants.length === 0)) {
		return null;
	}

	return (
		<Section title="Druge veličine">
			<div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-none">
				{isLoading
					? Array.from({ length: 3 }).map((_, i) => (
							<TkSkeleton key={i} className="flex-none w-56 h-24 rounded-lg" />
						))
					: variants?.map((v) => (
							<SimilarVariantCard
								key={v.id}
								id={v.id}
								name={v.name}
								packDescription={v.packDescription}
								bestPriceCents={v.bestPriceCents}
								unitPriceCents={v.unitPriceCents}
								unitLabel={v.unitLabel}
								bestChainSlug={v.bestChainSlug}
							/>
						))}
			</div>
		</Section>
	);
}
