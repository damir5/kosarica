"use client";

import { Search } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

interface SearchBarProps {
	value?: string;
	onChange?: (value: string) => void;
	placeholder?: string;
	filters?: React.ReactNode;
	className?: string;
}

function SearchBar({
	value,
	onChange,
	placeholder = "Tra\u017Ei proizvod\u2026",
	filters,
	className,
}: SearchBarProps) {
	return (
		<div
			data-slot="search-bar"
			className={cn(
				"sticky top-14 z-30 bg-tk-bg/95 backdrop-blur-sm pt-2 pb-2",
				className,
			)}
		>
			<div className="relative">
				<Search
					className="absolute left-3.5 top-1/2 -translate-y-1/2 size-5 text-tk-text-tertiary pointer-events-none"
					aria-hidden="true"
				/>
				<input
					type="search"
					data-slot="search-bar-input"
					className="h-12 w-full rounded-[var(--tk-radius-md,10px)] border border-tk-border bg-tk-surface-alt pl-11 pr-4 text-base font-tk-sans text-tk-text outline-none transition-[color,box-shadow,border-color] placeholder:text-tk-text-tertiary focus-visible:ring-2 focus-visible:ring-tk-accent/50 focus-visible:border-tk-accent"
					placeholder={placeholder}
					value={value}
					onChange={(e) => onChange?.(e.target.value)}
				/>
			</div>

			{filters && (
				<div className="overflow-x-auto flex gap-2 pb-2 pt-2 scrollbar-none">
					{filters}
				</div>
			)}
		</div>
	);
}

export { SearchBar };
export type { SearchBarProps };
