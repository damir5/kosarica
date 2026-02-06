"use client";

import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";

import { orpc } from "@/orpc/client";
import { useBasket } from "@/hooks/use-basket";
import type {
	SingleStoreResult,
	MultiStoreResult,
} from "@/orpc/router/basket";
import { PageContainer, Section } from "@/components/public/layout";
import {
	Heading,
	Text,
	TkButton,
	TkDrawer,
	TkDrawerContent,
} from "@/components/public/primitives";
import {
	EmptyState,
	ShoppingListItem,
	BasketOptimizationResults,
} from "@/components/public/domain";
import { formatPrice } from "@/components/public/domain/price-display";

export const Route = createFileRoute("/_public/basket")({
	head: () => ({
		meta: [{ title: "Košarica | Tvoja Košarica" }],
	}),
	component: BasketPage,
});

function BasketPage() {
	const navigate = useNavigate();
	const { items, removeItem, updateQuantity, toggleChecked, clear } =
		useBasket();

	const [drawerOpen, setDrawerOpen] = useState(false);
	const [optimizeMode, setOptimizeMode] = useState<"single" | "multi">(
		"single",
	);

	// Estimated total from cached best prices (cents)
	const estimatedTotal = items.reduce(
		(sum, item) => sum + (item.bestPrice ?? 0) * item.quantity,
		0,
	);

	// Build basket items for optimization API
	const basketApiItems = items.map((item) => ({
		itemId: item.productId,
		name: item.name,
		quantity: item.quantity,
	}));

	// TODO: The basket optimization API requires a specific chainSlug.
	// For V1, this uses "konzum" as default. A chain picker should be added.
	const defaultChainSlug = "konzum";

	// Single-store optimization
	const singleOptimize = useMutation({
		mutationFn: async () => {
			const result = await orpc.basket.optimizeSingle.call({
				chainSlug: defaultChainSlug,
				basketItems: basketApiItems,
			});
			return result as { results: SingleStoreResult[]; total: number };
		},
		onSuccess: () => {
			setOptimizeMode("single");
			setDrawerOpen(true);
		},
	});

	// Multi-store optimization
	const multiOptimize = useMutation({
		mutationFn: async () => {
			const result = await orpc.basket.optimizeMulti.call({
				chainSlug: defaultChainSlug,
				basketItems: basketApiItems,
			});
			return result as MultiStoreResult;
		},
		onSuccess: () => {
			setOptimizeMode("multi");
			setDrawerOpen(true);
		},
	});

	const isOptimizing =
		singleOptimize.isPending || multiOptimize.isPending;

	if (items.length === 0) {
		return (
			<PageContainer>
				<Heading level={1} size="xl" className="mb-6">
					Tvoja košarica
				</Heading>
				<EmptyState
					variant="list-empty"
					action={{
						label: "Pretraži proizvode",
						onClick: () => navigate({ to: "/search" }),
					}}
				/>
			</PageContainer>
		);
	}

	return (
		<PageContainer>
			<div className="flex items-baseline justify-between mb-6">
				<div>
					<Heading level={1} size="xl">
						Tvoja košarica
					</Heading>
					<Text variant="small" className="text-tk-text-secondary mt-1">
						{items.length} {items.length === 1 ? "proizvod" : "proizvoda"}
					</Text>
				</div>
				{estimatedTotal > 0 && (
					<div className="text-right">
						<Text variant="caption" className="text-tk-text-secondary">
							Procjena
						</Text>
						<Text className="font-semibold tabular-nums">
							{formatPrice(estimatedTotal / 100)} &euro;
						</Text>
					</div>
				)}
			</div>

			{/* Shopping list */}
			<Section>
				<div className="divide-y divide-tk-border rounded-[var(--tk-radius-lg,12px)] border border-tk-border bg-tk-surface">
					{items.map((item) => (
						<div
							key={item.productId}
							className="flex items-center"
						>
							<ShoppingListItem
								name={item.name}
								checked={item.checked}
								onToggle={() => toggleChecked.mutate(item.productId)}
								price={
									item.bestPrice != null
										? item.bestPrice / 100
										: undefined
								}
								store={item.bestStore}
								className="flex-1"
							/>
							<div className="flex items-center gap-1 pr-3 shrink-0">
								<TkButton
									variant="ghost"
									size="icon-sm"
									onClick={() =>
										updateQuantity.mutate({
											productId: item.productId,
											quantity: item.quantity - 1,
										})
									}
									aria-label="Smanji količinu"
								>
									-
								</TkButton>
								<span className="w-6 text-center text-sm tabular-nums">
									{item.quantity}
								</span>
								<TkButton
									variant="ghost"
									size="icon-sm"
									onClick={() =>
										updateQuantity.mutate({
											productId: item.productId,
											quantity: item.quantity + 1,
										})
									}
									aria-label="Povećaj količinu"
								>
									+
								</TkButton>
								<TkButton
									variant="ghost"
									size="icon-sm"
									onClick={() => removeItem.mutate(item.productId)}
									aria-label={`Ukloni ${item.name}`}
									className="text-tk-text-tertiary ml-1"
								>
									&times;
								</TkButton>
							</div>
						</div>
					))}
				</div>

				<div className="flex justify-end mt-3">
					<TkButton
						variant="ghost"
						size="sm"
						onClick={() => clear.mutate()}
						className="text-tk-text-tertiary"
					>
						Isprazni košaricu
					</TkButton>
				</div>
			</Section>

			{/* Optimization section */}
			<Section title="Optimizacija">
				<div className="flex gap-3">
					<TkButton
						onClick={() => singleOptimize.mutate()}
						disabled={isOptimizing}
					>
						{singleOptimize.isPending ? "Računam..." : "Jedna trgovina"}
					</TkButton>
					<TkButton
						variant="outline"
						onClick={() => multiOptimize.mutate()}
						disabled={isOptimizing}
					>
						{multiOptimize.isPending ? "Računam..." : "Više trgovina"}
					</TkButton>
				</div>

				{(singleOptimize.isError || multiOptimize.isError) && (
					<Text variant="small" className="text-red-500 mt-2">
						Optimizacija nije uspjela. Pokušaj ponovo.
					</Text>
				)}
			</Section>

			{/* Optimization results drawer (bottom sheet on mobile) */}
			<TkDrawer open={drawerOpen} onOpenChange={setDrawerOpen}>
				<TkDrawerContent title="Rezultati optimizacije">
					<BasketOptimizationResults
						mode={optimizeMode}
						singleResults={singleOptimize.data?.results}
						multiResults={
							multiOptimize.data
								? {
										stores: multiOptimize.data.stores,
										combinedTotal: multiOptimize.data.combinedTotal,
										coverageRatio: multiOptimize.data.coverageRatio,
									}
								: undefined
						}
					/>
				</TkDrawerContent>
			</TkDrawer>
		</PageContainer>
	);
}
