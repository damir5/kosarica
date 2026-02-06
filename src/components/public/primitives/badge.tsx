import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const tkBadgeVariants = cva(
	"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium font-tk-sans",
	{
		variants: {
			variant: {
				default: "bg-tk-surface-alt text-tk-text",
				best: "bg-tk-deal-best-bg text-tk-deal-best",
				good: "bg-tk-deal-good-bg text-tk-deal-good",
				neutral: "bg-tk-deal-neutral-bg text-tk-deal-neutral",
				bad: "bg-tk-deal-bad-bg text-tk-deal-bad",
				worst: "bg-tk-deal-worst-bg text-tk-deal-worst",
				accent: "bg-tk-accent-light text-tk-accent",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function TkBadge({
	className,
	variant,
	asChild = false,
	...props
}: React.ComponentProps<"span"> &
	VariantProps<typeof tkBadgeVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot : "span";

	return (
		<Comp
			data-slot="tk-badge"
			className={cn(tkBadgeVariants({ variant }), className)}
			{...props}
		/>
	);
}

export { TkBadge, tkBadgeVariants };
