"use client";

import { cn } from "@/lib/utils";

import { TkCheckbox } from "../primitives/checkbox";

import { type DealLevel, PriceDisplay } from "./price-display";
import { Sparkline } from "./sparkline";
import { StoreChip } from "./store-chip";
import type { StoreSlug } from "./store-colors";

interface ShoppingListItemProps {
	name: string;
	checked?: boolean;
	onToggle?: () => void;
	price?: number;
	store?: StoreSlug;
	deal?: DealLevel;
	priceHistory?: number[];
	className?: string;
}

function ShoppingListItem({
	name,
	checked = false,
	onToggle,
	price,
	store,
	deal,
	priceHistory,
	className,
}: ShoppingListItemProps) {
	return (
		<div
			data-slot="shopping-list-item"
			className={cn("flex items-center gap-3 min-h-12 px-4", className)}
		>
			<TkCheckbox
				checked={checked}
				onChange={onToggle}
				className="size-6 shrink-0"
				aria-label={`Označi ${name}`}
			/>

			<span
				className={cn(
					"flex-1 min-w-0 line-clamp-1 text-sm",
					checked && "line-through opacity-50",
				)}
			>
				{name}
			</span>

			<div className="flex items-center gap-2 shrink-0">
				{price != null && (
					<PriceDisplay amount={price} size="small" deal={deal} />
				)}
				{store && <StoreChip store={store} variant="dot" />}
				{priceHistory && priceHistory.length >= 2 && (
					<Sparkline
						data={priceHistory}
						width={48}
						height={16}
						className="text-tk-text-tertiary"
					/>
				)}
			</div>
		</div>
	);
}

export { ShoppingListItem };
export type { ShoppingListItemProps };
