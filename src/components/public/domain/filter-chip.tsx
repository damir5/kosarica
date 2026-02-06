"use client";

import { cn } from "@/lib/utils";

interface FilterChipProps {
	label: string;
	active?: boolean;
	onClick?: () => void;
	className?: string;
}

function FilterChip({
	label,
	active = false,
	onClick,
	className,
}: FilterChipProps) {
	return (
		<button
			type="button"
			data-slot="filter-chip"
			onClick={onClick}
			className={cn(
				"rounded-full px-3 py-1.5 text-xs transition-colors cursor-pointer whitespace-nowrap",
				active
					? "bg-tk-accent-light text-tk-accent font-medium"
					: "bg-tk-surface-alt text-tk-text-secondary",
				className,
			)}
		>
			{label}
		</button>
	);
}

export { FilterChip };
export type { FilterChipProps };
