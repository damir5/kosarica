import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export type DealLevel = "best" | "good" | "neutral" | "bad" | "worst";

export function formatPrice(amount: number): string {
	return amount.toFixed(2).replace(".", ",");
}

const priceDisplayVariants = cva(
	"font-tk-mono tabular-nums tracking-tight inline-flex items-baseline gap-0.5",
	{
		variants: {
			size: {
				hero: "text-2xl font-bold",
				compact: "text-lg font-semibold",
				small: "text-sm",
			},
		},
		defaultVariants: {
			size: "compact",
		},
	},
);

const dealColorMap: Record<DealLevel, string> = {
	best: "text-tk-deal-best",
	good: "text-tk-deal-good",
	neutral: "text-tk-deal-neutral",
	bad: "text-tk-deal-bad",
	worst: "text-tk-deal-worst",
};

interface PriceDisplayProps extends VariantProps<typeof priceDisplayVariants> {
	amount: number;
	deal?: DealLevel;
	className?: string;
}

function PriceDisplay({
	amount,
	size = "compact",
	deal,
	className,
}: PriceDisplayProps) {
	const dealClass = deal ? dealColorMap[deal] : undefined;

	return (
		<span
			data-slot="price-display"
			className={cn(priceDisplayVariants({ size }), dealClass, className)}
			style={{ letterSpacing: "-0.02em" }}
		>
			<span className="opacity-70" style={{ fontSize: "0.75em" }}>
				&euro;
			</span>
			{formatPrice(amount)}
		</span>
	);
}

export { PriceDisplay, priceDisplayVariants };
