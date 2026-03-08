"use client";

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Check, ShoppingBasket } from "lucide-react";
import { toast } from "sonner";
import { PageContainer, Section } from "@/components/public/layout";
import {
	Heading,
	Text,
	TkButton,
	TkCard,
	TkCardContent,
	TkSkeleton,
} from "@/components/public/primitives";
import { PriceDisplay } from "@/components/public/domain";
import { useBasket } from "@/hooks/use-basket";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_public/product/$productId")({
	head: () => ({
		meta: [{ title: "Obitelj proizvoda | Tvoja Košarica" }],
	}),
	component: ProductFamilyPage,
});

function ProductFamilyPage() {
	const { productId } = Route.useParams();
	const router = useRouter();
	const { addItem, items } = useBasket();
	const familyQuery = useQuery(
		orpc.catalog.getFamily.queryOptions({
			input: { familyIdOrSlug: productId },
		}),
	);

	const familyId = familyQuery.data?.family.id;
	const graphQuery = useQuery({
		...orpc.catalog.getFamilyGraph.queryOptions({
			input: { familyId: familyId ?? "" },
		}),
		enabled: Boolean(familyId),
	});

	const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(undefined);
	const activeVariantId =
		selectedVariantId ?? graphQuery.data?.variants[0]?.id ?? undefined;

	const offersQuery = useQuery({
		...orpc.catalog.getFamilyOffers.queryOptions({
			input: {
				familyId: familyId ?? "",
				variantId: activeVariantId,
			},
		}),
		enabled: Boolean(familyId),
	});

	const family = familyQuery.data?.family;
	const variants = graphQuery.data?.variants ?? [];
	const offers = offersQuery.data?.offers ?? [];

	const isInBasket = items.some((item) => item.productId === family?.id);
	const bestOffer = offers[0];

	const groupedOffers = useMemo(() => {
		const byChain = new Map<string, (typeof offers)[number]>();
		for (const offer of offers) {
			const existing = byChain.get(offer.chainSlug);
			if (
				!existing ||
				(offer.effectivePrice != null &&
					(existing.effectivePrice == null ||
						offer.effectivePrice < existing.effectivePrice))
			) {
				byChain.set(offer.chainSlug, offer);
			}
		}
		return Array.from(byChain.values()).sort(
			(a, b) => (a.effectivePrice ?? 0) - (b.effectivePrice ?? 0),
		);
	}, [offers]);

	if (familyQuery.isLoading || !family) {
		return (
			<PageContainer>
				<TkSkeleton className="mb-4 h-8 w-48" />
				<TkSkeleton className="mb-3 h-10 w-80" />
				<TkSkeleton className="h-32 w-full" />
			</PageContainer>
		);
	}

	return (
		<PageContainer>
			<div className="mb-4">
				<TkButton variant="ghost" size="sm" onClick={() => router.history.back()}>
					&larr; Natrag
				</TkButton>
			</div>

			<Heading level={1} size="xl">
				{family.displayName}
			</Heading>
			<div className="mt-2 flex flex-wrap gap-2">
				{family.taxonomy && (
					<Text variant="caption" className="text-tk-text-secondary">
						{family.taxonomy}
					</Text>
				)}
				{family.qualityLabel && (
					<Text variant="caption" className="text-tk-accent">
						{family.qualityLabel}
					</Text>
				)}
				<Text variant="caption" className="text-tk-text-secondary">
					{family.chainCount} lanaca
				</Text>
			</div>

			<Section title="Pakiranja i odabir varijante">
				<div className="flex flex-wrap gap-2">
					{variants.map((variant) => (
						<button
							key={variant.id}
							type="button"
							onClick={() => setSelectedVariantId(variant.id)}
							className={`rounded-full border px-3 py-2 text-sm ${
								activeVariantId === variant.id
									? "border-tk-accent bg-tk-accent-light text-tk-accent"
									: "border-tk-border bg-tk-surface text-tk-text-secondary"
							}`}
						>
							{variant.packLabel ?? variant.displayName}
							{variant.bestPriceCents != null && (
								<span className="ml-2 font-medium">
									{(variant.bestPriceCents / 100).toFixed(2).replace(".", ",")} €
								</span>
							)}
						</button>
					))}
				</div>
			</Section>

			<Section title="Cijene po lancima">
				{offersQuery.isLoading ? (
					<div className="grid gap-3 md:grid-cols-2">
						{Array.from({ length: 6 }).map((_, index) => (
							<TkSkeleton key={index} className="h-24 w-full" />
						))}
					</div>
				) : groupedOffers.length === 0 ? (
					<Text className="text-tk-text-secondary">
						Trenutno nema dostupnih cijena za ovu varijantu.
					</Text>
				) : (
					<div className="grid gap-3 md:grid-cols-2">
						{groupedOffers.map((offer) => (
							<TkCard key={`${offer.chainSlug}:${offer.variantId}`}>
								<TkCardContent className="pt-4">
									<div className="flex items-start justify-between gap-3">
										<div>
											<Heading size="sm">{offer.chainName}</Heading>
											<Text variant="caption" className="text-tk-text-secondary">
												{offer.itemName}
											</Text>
											{offer.unitPriceCents != null && offer.unitLabel && (
												<Text
													variant="caption"
													className="mt-1 block text-tk-text-tertiary"
												>
													{(offer.unitPriceCents / 100).toFixed(2).replace(".", ",")} € /{" "}
													{offer.unitLabel}
												</Text>
											)}
										</div>
										{offer.effectivePrice != null && (
											<PriceDisplay
												amount={offer.effectivePrice / 100}
												size="compact"
												deal={
													offer.discountPrice != null &&
													offer.discountPrice !== offer.effectivePrice
														? "good"
														: undefined
												}
											/>
										)}
									</div>
								</TkCardContent>
							</TkCard>
						))}
					</div>
				)}
			</Section>

			<div className="mb-8 mt-6 flex gap-2">
				<TkButton
					onClick={() => {
						addItem.mutate(
							{
								productId: family.id,
								name: family.displayName,
								bestPrice: bestOffer?.effectivePrice ?? undefined,
								bestStore: undefined,
							},
							{
								onSuccess: () => toast.success(`${family.displayName} dodan u košaricu`),
							},
						);
					}}
				>
					{isInBasket ? (
						<>
							<Check className="size-4" />
							U košarici
						</>
					) : (
						<>
							<ShoppingBasket className="size-4" />
							Dodaj u košaricu
						</>
					)}
				</TkButton>
			</div>

			{(graphQuery.data?.relatedFamilies.length ?? 0) > 0 && (
				<Section title="Povezane obitelji">
					<div className="grid gap-3 md:grid-cols-3">
						{graphQuery.data?.relatedFamilies.map((related) => (
							<Link
								key={related.id}
								to="/product/$productId"
								params={{ productId: related.slug }}
							>
								<TkCard hover className="h-full cursor-pointer">
									<TkCardContent className="pt-4">
										<Heading size="sm">{related.displayName}</Heading>
										<Text variant="caption" className="mt-2 block text-tk-text-secondary">
											{related.variantCount} pakiranja
										</Text>
									</TkCardContent>
								</TkCard>
							</Link>
						))}
					</div>
				</Section>
			)}

			{(graphQuery.data?.collectionPreviews.length ?? 0) > 0 && (
				<Section title="Pametne kolekcije">
					<div className="space-y-4">
						{graphQuery.data?.collectionPreviews.map((collection) => (
							<div key={collection.id}>
								<div className="mb-2 flex items-center justify-between">
									<Heading size="sm">{collection.title}</Heading>
									<Link
										to="/search"
										search={{ collection: collection.slug }}
										className="text-sm text-tk-accent"
									>
										Otvori kolekciju
									</Link>
								</div>
								<div className="grid gap-3 md:grid-cols-3">
									{collection.families.map((related) => (
										<Link
											key={related.id}
											to="/product/$productId"
											params={{ productId: related.slug }}
										>
											<TkCard hover className="cursor-pointer">
												<TkCardContent className="pt-4">
													<Heading size="sm">{related.displayName}</Heading>
													{related.bestPriceCents != null && (
														<div className="mt-2">
															<PriceDisplay
																amount={related.bestPriceCents / 100}
																size="compact"
															/>
														</div>
													)}
												</TkCardContent>
											</TkCard>
										</Link>
									))}
								</div>
							</div>
						))}
					</div>
				</Section>
			)}
		</PageContainer>
	);
}
