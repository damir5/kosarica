import { cn } from "@/lib/utils";

import type { DealLevel } from "./price-display";

const dealBarColorMap: Record<DealLevel, string> = {
	best: "bg-tk-deal-best",
	good: "bg-tk-deal-good",
	neutral: "bg-tk-deal-neutral",
	bad: "bg-tk-deal-bad",
	worst: "bg-tk-deal-worst",
};

interface PriceBarProps {
	price: number;
	min: number;
	max: number;
	deal?: DealLevel;
	className?: string;
}

function PriceBar({ price, min, max, deal, className }: PriceBarProps) {
	const range = max - min;
	const rawPct = range > 0 ? ((price - min) / range) * 100 : 50;
	const widthPct = Math.max(8, Math.min(100, rawPct));

	const barColor = deal ? dealBarColorMap[deal] : "bg-tk-deal-neutral";

	return (
		<div
			data-slot="price-bar"
			className={cn("bg-tk-surface-alt rounded-full h-1.5 w-full", className)}
			role="presentation"
		>
			<div
				className={cn(
					"h-1.5 rounded-full transition-all duration-500 ease-out",
					barColor,
				)}
				style={{ width: `${widthPct}%` }}
			/>
		</div>
	);
}

export { PriceBar };
