import { cn } from "@/lib/utils";

import { DealIndicator } from "./deal-indicator";
import { PriceBar } from "./price-bar";
import { type DealLevel, formatPrice, PriceDisplay } from "./price-display";
import { StoreChip } from "./store-chip";
import type { StoreSlug } from "./store-colors";

interface PriceComparisonRowProps {
	productName: string;
	category?: string;
	unit?: string;
	prices: Array<{
		store: StoreSlug;
		price: number;
		deal: DealLevel;
		itemName?: string;
		unitPrice?: number | null;
		unitLabel?: string | null;
	}>;
	className?: string;
}

function PriceComparisonRow({
	productName,
	category,
	unit,
	prices,
	className,
}: PriceComparisonRowProps) {
	const sorted = [...prices].sort((a, b) => a.price - b.price);
	const minPrice = sorted.length > 0 ? sorted[0].price : 0;
	const maxPrice = sorted.length > 0 ? sorted[sorted.length - 1].price : 0;

	const secondaryParts: string[] = [];
	if (unit) secondaryParts.push(unit);
	if (category) secondaryParts.push(category);

	return (
		<div
			data-slot="price-comparison-row"
			className={cn("space-y-2", className)}
		>
			<div className="px-4">
				<h3 className="font-semibold line-clamp-2 text-tk-text">
					{productName}
				</h3>
				{secondaryParts.length > 0 && (
					<p className="text-sm text-tk-text-secondary">
						{secondaryParts.join(" \u00B7 ")}
					</p>
				)}
			</div>

			<div className="space-y-0.5">
				{sorted.map((entry, index) => {
					const showItemName = entry.itemName && entry.itemName !== productName;
					return (
						<div
							key={entry.store}
							className={cn(
								"flex items-center gap-3 min-h-12 px-4 transition-colors",
								index === 0 && "bg-tk-deal-best-bg",
							)}
						>
							<StoreChip
								store={entry.store}
								variant="compact"
								className="shrink-0 w-16"
							/>

							<div className="shrink-0 w-16">
								<PriceDisplay
									amount={entry.price}
									size="small"
									deal={entry.deal}
								/>
								{entry.unitPrice != null && entry.unitLabel && (
									<span className="block text-[10px] text-tk-text-secondary leading-tight">
										{formatPrice(entry.unitPrice)}/{entry.unitLabel}
									</span>
								)}
							</div>

							<div className="flex-1 min-w-0">
								{showItemName && (
									<p className="text-[11px] text-tk-text-secondary truncate leading-tight mb-0.5">
										{entry.itemName}
									</p>
								)}
								<PriceBar
									price={entry.price}
									min={minPrice}
									max={maxPrice}
									deal={entry.deal}
								/>
							</div>

							<DealIndicator
								level={entry.deal}
								className="shrink-0 w-20 justify-end"
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
}

export { PriceComparisonRow };
export type { PriceComparisonRowProps };
