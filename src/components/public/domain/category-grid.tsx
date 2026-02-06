"use client";

import { cn } from "@/lib/utils";

import { CategoryIcon } from "./category-icon";

interface CategoryGridProps {
	categories: Array<{ slug: string; label: string }>;
	onSelect?: (slug: string) => void;
	className?: string;
}

function CategoryGrid({ categories, onSelect, className }: CategoryGridProps) {
	return (
		<div
			data-slot="category-grid"
			className={cn("grid grid-cols-4 gap-2", className)}
		>
			{categories.map((cat) => (
				<button
					key={cat.slug}
					type="button"
					onClick={() => onSelect?.(cat.slug)}
					className="flex flex-col items-center gap-1 p-3 rounded-[var(--tk-radius-md,10px)] bg-tk-surface hover:bg-tk-surface-alt transition-colors cursor-pointer"
				>
					<CategoryIcon
						category={cat.slug}
						className="text-tk-text-secondary"
					/>
					<span className="text-xs text-tk-text-secondary text-center">
						{cat.label}
					</span>
				</button>
			))}
		</div>
	);
}

export { CategoryGrid };
export type { CategoryGridProps };
