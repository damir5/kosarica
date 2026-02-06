"use client";

import { Suspense, lazy } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { orpc } from "@/orpc/client";
import { computeDealLevel, type DealLevel } from "@/lib/deal-levels";
import { PageContainer, Section } from "@/components/public/layout";
import {
	Heading,
	Text,
	TkButton,
	TkSkeleton,
} from "@/components/public/primitives";
import {
	PriceComparisonRow,
	DataFreshnessBadge,
	type StoreSlug,
} from "@/components/public/domain";

const PriceHistoryChart = lazy(() =>
	import("@/components/public/charts").then((m) => ({
		default: m.PriceHistoryChart,
	})),
);

export const Route = createFileRoute("/_public/product/$productId")({
	loader: async ({ context, params }) => {
		const data = await context.queryClient.ensureQueryData(
			orpc.products.get.queryOptions({ input: { productId: params.productId } }),
		);
		return data;
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title: loaderData
					? `${loaderData.product.name} | Tvoja Košarica`
					: "Proizvod | Tvoja Košarica",
			},
		],
	}),
	component: ProductDetailPage,
});

function ProductDetailPage() {
	const data = Route.useLoaderData();
	const router = useRouter();

	const { product, storePrices, priceHistory } = data;

	// Deduplicate store prices: keep the lowest effective price per chain
	const bestByChain = new Map<
		string,
		(typeof storePrices)[number]
	>();
	for (const sp of storePrices) {
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

	const bestPrice = uniquePrices.length > 0 ? (uniquePrices[0].effectivePrice ?? 0) : 0;

	const comparisonPrices: Array<{
		store: StoreSlug;
		price: number;
		deal: DealLevel;
	}> = uniquePrices.map((sp) => {
		const priceEur = (sp.effectivePrice ?? 0) / 100;
		return {
			store: sp.chainSlug as StoreSlug,
			price: priceEur,
			deal: computeDealLevel(sp.effectivePrice ?? 0, bestPrice),
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
					<Suspense
						fallback={<TkSkeleton className="h-[200px] w-full" />}
					>
						<PriceHistoryChart data={priceHistory} />
					</Suspense>
				</Section>
			)}

			{comparisonPrices.length > 0 && (
				<Section title="Cijene po trgovinama">
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

			{comparisonPrices.length > 0 && (
				<div className="flex gap-2 mt-6 mb-8">
					<TkButton>Dodaj u košaricu</TkButton>
					<TkButton variant="outline">Postavi alarm</TkButton>
				</div>
			)}
		</PageContainer>
	);
}
