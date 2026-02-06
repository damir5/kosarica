"use client";

import { cn } from "@/lib/utils";

import {
	TkCard,
	TkCardContent,
	TkCardFooter,
	TkCardHeader,
	Heading,
	Text,
} from "../primitives";

import { PriceDisplay } from "./price-display";

// ============================================================================
// Types — aligned with basket.ts API response shapes
// ============================================================================

interface ItemPriceInfo {
	itemId: string;
	itemName: string;
	quantity: number;
	effectivePrice: number;
	hasDiscount: boolean;
	lineTotal: number;
}

export interface SingleStoreResultItem {
	storeId: string;
	realTotal: number;
	coverageRatio: number;
	items?: ItemPriceInfo[];
}

export interface StoreAllocationResult {
	storeId: string;
	items: ItemPriceInfo[];
	storeTotal: number;
}

interface SingleStoreResultProps {
	results: SingleStoreResultItem[];
	className?: string;
}

interface MultiStoreResultProps {
	stores: StoreAllocationResult[];
	combinedTotal: number;
	coverageRatio: number;
	singleStoreBest?: number;
	className?: string;
}

// ============================================================================
// Single-Store Results
// ============================================================================

function SingleStoreResults({ results, className }: SingleStoreResultProps) {
	if (results.length === 0) return null;

	return (
		<div className={cn("space-y-3", className)}>
			<Heading level={3} size="sm">
				Jedna trgovina
			</Heading>
			<Text variant="small" className="text-tk-text-secondary mb-3">
				Najbolje opcije ako kupuješ sve na jednom mjestu
			</Text>
			{results.slice(0, 5).map((result, idx) => (
				<TkCard key={result.storeId}>
					<TkCardHeader>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								{idx === 0 && (
									<span className="text-xs font-semibold text-tk-accent">
										Najbolje
									</span>
								)}
								<Text variant="small" className="text-tk-text-secondary">
									{result.storeId}
								</Text>
							</div>
							<PriceDisplay
								amount={result.realTotal / 100}
								size="compact"
								deal={idx === 0 ? "best" : "neutral"}
							/>
						</div>
					</TkCardHeader>
					{result.items && result.items.length > 0 && (
						<TkCardContent>
							<div className="space-y-1">
								{result.items.map((item) => (
									<div
										key={item.itemId}
										className="flex items-center justify-between text-sm"
									>
										<span className="text-tk-text-secondary line-clamp-1 flex-1 mr-2">
											{item.quantity > 1 ? `${item.quantity}x ` : ""}
											{item.itemName}
										</span>
										<span className="tabular-nums text-tk-text shrink-0">
											{(item.lineTotal / 100).toFixed(2).replace(".", ",")} &euro;
										</span>
									</div>
								))}
							</div>
						</TkCardContent>
					)}
					<TkCardFooter>
						<Text variant="caption" className="text-tk-text-tertiary">
							Pokriva {Math.round(result.coverageRatio * 100)}% košarice
						</Text>
					</TkCardFooter>
				</TkCard>
			))}
		</div>
	);
}

// ============================================================================
// Multi-Store Results
// ============================================================================

function MultiStoreResults({
	stores,
	combinedTotal,
	coverageRatio,
	singleStoreBest,
	className,
}: MultiStoreResultProps) {
	if (stores.length === 0) return null;

	const savings =
		singleStoreBest != null ? singleStoreBest - combinedTotal : 0;

	return (
		<div className={cn("space-y-3", className)}>
			<Heading level={3} size="sm">
				Više trgovina
			</Heading>
			<Text variant="small" className="text-tk-text-secondary mb-3">
				Optimalna kombinacija — obilazi {stores.length}{" "}
				{stores.length === 1 ? "trgovinu" : stores.length < 5 ? "trgovine" : "trgovina"}
			</Text>

			{stores.map((store) => (
				<TkCard key={store.storeId}>
					<TkCardHeader>
						<div className="flex items-center justify-between">
							<Text variant="small" className="text-tk-text-secondary">
								{store.storeId}
							</Text>
							<PriceDisplay
								amount={store.storeTotal / 100}
								size="compact"
							/>
						</div>
					</TkCardHeader>
					<TkCardContent>
						<div className="space-y-1">
							{store.items.map((item) => (
								<div
									key={item.itemId}
									className="flex items-center justify-between text-sm"
								>
									<span className="text-tk-text-secondary line-clamp-1 flex-1 mr-2">
										{item.quantity > 1 ? `${item.quantity}x ` : ""}
										{item.itemName}
									</span>
									<span className="tabular-nums text-tk-text shrink-0">
										{(item.lineTotal / 100).toFixed(2).replace(".", ",")} &euro;
									</span>
								</div>
							))}
						</div>
					</TkCardContent>
				</TkCard>
			))}

			{/* Summary */}
			<TkCard>
				<TkCardContent className="pt-4">
					<div className="flex items-center justify-between">
						<Text variant="body" className="font-semibold">
							Ukupno
						</Text>
						<PriceDisplay
							amount={combinedTotal / 100}
							size="compact"
							deal="best"
						/>
					</div>
					{savings > 0 && (
						<Text
							variant="small"
							className="text-tk-accent mt-1"
						>
							Ušteda: {(savings / 100).toFixed(2).replace(".", ",")} &euro; vs.
							jedna trgovina
						</Text>
					)}
					<Text variant="caption" className="text-tk-text-tertiary mt-1">
						Pokriva {Math.round(coverageRatio * 100)}% košarice
					</Text>
				</TkCardContent>
			</TkCard>
		</div>
	);
}

// ============================================================================
// Combined Export
// ============================================================================

export function BasketOptimizationResults({
	mode,
	singleResults,
	multiResults,
	className,
}: {
	mode: "single" | "multi";
	singleResults?: SingleStoreResultItem[];
	multiResults?: {
		stores: StoreAllocationResult[];
		combinedTotal: number;
		coverageRatio: number;
	};
	singleStoreBest?: number;
	className?: string;
}) {
	return (
		<div className={cn("space-y-6", className)}>
			{mode === "single" && singleResults && (
				<SingleStoreResults results={singleResults} />
			)}
			{mode === "multi" && multiResults && (
				<MultiStoreResults
					stores={multiResults.stores}
					combinedTotal={multiResults.combinedTotal}
					coverageRatio={multiResults.coverageRatio}
					singleStoreBest={
						singleResults?.[0]?.realTotal
					}
				/>
			)}
		</div>
	);
}
