import { cn } from "@/lib/utils";

interface DataFreshnessBadgeProps {
	lastUpdated: Date | string;
	className?: string;
}

function DataFreshnessBadge({
	lastUpdated,
	className,
}: DataFreshnessBadgeProps) {
	const updatedDate =
		typeof lastUpdated === "string" ? new Date(lastUpdated) : lastUpdated;
	const hoursSince = (Date.now() - updatedDate.getTime()) / (1000 * 60 * 60);

	let dotColor: string;
	let label: string;

	if (hoursSince < 6) {
		dotColor = "bg-green-500";
		label = "Svje\u017Ee";
	} else if (hoursSince < 24) {
		dotColor = "bg-yellow-500";
		label = "Danas";
	} else {
		dotColor = "bg-red-500";
		label = "\u26A0 Provjerite";
	}

	return (
		<span
			data-slot="data-freshness-badge"
			className={cn(
				"inline-flex items-center gap-1.5 text-xs text-tk-text-secondary",
				className,
			)}
		>
			<span
				className={cn("size-1.5 rounded-full shrink-0", dotColor)}
				aria-hidden="true"
			/>
			{label}
		</span>
	);
}

export { DataFreshnessBadge };
