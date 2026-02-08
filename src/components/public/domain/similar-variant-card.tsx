import { Link } from "@tanstack/react-router";

import { formatPrice, PriceDisplay } from "./price-display";
import { StoreChip } from "./store-chip";
import type { StoreSlug } from "./store-colors";

interface SimilarVariantCardProps {
	id: string;
	name: string;
	packDescription: string;
	bestPriceCents: number;
	unitPriceCents: number | null;
	unitLabel: string | null;
	bestChainSlug: string | null;
}

function SimilarVariantCard({
	id,
	name,
	packDescription,
	bestPriceCents,
	unitPriceCents,
	unitLabel,
	bestChainSlug,
}: SimilarVariantCardProps) {
	return (
		<Link
			to="/product/$productId"
			params={{ productId: id }}
			className="flex-none snap-start w-56 rounded-lg border border-tk-border bg-tk-surface p-3 hover:bg-tk-surface-alt transition-colors"
		>
			<p className="text-sm font-medium text-tk-text line-clamp-1">{name}</p>
			{packDescription && (
				<p className="text-xs text-tk-text-secondary mt-0.5">
					{packDescription}
				</p>
			)}
			<div className="flex items-center gap-2 mt-2">
				<PriceDisplay amount={bestPriceCents / 100} size="small" deal="best" />
				{unitPriceCents != null && unitLabel && (
					<span className="text-[10px] text-tk-text-secondary">
						{formatPrice(unitPriceCents / 100)}/{unitLabel}
					</span>
				)}
				{bestChainSlug && (
					<StoreChip
						store={bestChainSlug as StoreSlug}
						variant="compact"
						className="ml-auto"
					/>
				)}
			</div>
		</Link>
	);
}

export { SimilarVariantCard };
export type { SimilarVariantCardProps };
