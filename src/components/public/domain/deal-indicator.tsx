import {
	AlertTriangle,
	CheckCircle2,
	Minus,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

import type { DealLevel } from "./price-display";

const dealConfig: Record<
	DealLevel,
	{
		icon: React.ComponentType<{ className?: string }>;
		label: (pct?: number) => string;
		colorClass: string;
	}
> = {
	best: {
		icon: CheckCircle2,
		label: () => "Najjeftinije",
		colorClass: "text-tk-deal-best",
	},
	good: {
		icon: TrendingDown,
		label: (pct) => (pct != null ? `-${pct}%` : "Jeftino"),
		colorClass: "text-tk-deal-good",
	},
	neutral: {
		icon: Minus,
		label: () => "\u2014",
		colorClass: "text-tk-deal-neutral",
	},
	bad: {
		icon: TrendingUp,
		label: (pct) => (pct != null ? `+${pct}%` : "Skupo"),
		colorClass: "text-tk-deal-bad",
	},
	worst: {
		icon: AlertTriangle,
		label: (pct) => (pct != null ? `+${pct}%` : "Najskuplje"),
		colorClass: "text-tk-deal-worst",
	},
};

interface DealIndicatorProps {
	level: DealLevel;
	percentage?: number;
	className?: string;
}

function DealIndicator({ level, percentage, className }: DealIndicatorProps) {
	const config = dealConfig[level];
	const Icon = config.icon;

	return (
		<span
			data-slot="deal-indicator"
			className={cn(
				"inline-flex items-center gap-1 text-xs",
				config.colorClass,
				className,
			)}
		>
			<Icon className="size-3.5 shrink-0" />
			<span>{config.label(percentage)}</span>
		</span>
	);
}

export { DealIndicator };
