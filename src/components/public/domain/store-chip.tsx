import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

import { STORE_COLORS, type StoreSlug } from "./store-colors";

const storeChipVariants = cva("inline-flex items-center gap-1.5", {
	variants: {
		variant: {
			full: "bg-tk-surface-alt rounded-full px-2 py-0.5 text-xs font-medium",
			compact: "bg-tk-surface-alt rounded-full px-2 py-0.5 text-xs font-medium",
			dot: "",
		},
	},
	defaultVariants: {
		variant: "full",
	},
});

interface StoreChipProps extends VariantProps<typeof storeChipVariants> {
	store: StoreSlug;
	className?: string;
}

function StoreChip({ store, variant = "full", className }: StoreChipProps) {
	const color = STORE_COLORS[store];
	const code = store.slice(0, 2).toUpperCase();

	return (
		<span
			data-slot="store-chip"
			className={cn(storeChipVariants({ variant }), className)}
		>
			<span
				className="size-2.5 rounded-full inline-block shrink-0"
				style={{ backgroundColor: color }}
				aria-hidden="true"
			/>
			{variant === "full" && <span>{store}</span>}
			{variant === "compact" && <span>{code}</span>}
		</span>
	);
}

export { StoreChip, storeChipVariants };
