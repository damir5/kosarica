import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const tkButtonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium font-tk-sans transition-all outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 focus-visible:ring-2 focus-visible:ring-tk-accent/50",
	{
		variants: {
			variant: {
				default:
					"bg-tk-accent text-tk-accent-foreground hover:bg-tk-accent-hover shadow-tk-sm",
				secondary: "bg-tk-surface-alt text-tk-text hover:bg-tk-border",
				outline:
					"border border-tk-border bg-tk-surface text-tk-text hover:bg-tk-surface-alt",
				ghost: "text-tk-text hover:bg-tk-surface-alt",
				link: "text-tk-accent underline-offset-4 hover:underline",
			},
			size: {
				default: "h-12 rounded-[var(--tk-radius-md,10px)] px-5 text-sm",
				sm: "h-9 rounded-[var(--tk-radius-sm,6px)] px-3 text-xs",
				lg: "h-14 rounded-[var(--tk-radius-md,10px)] px-8 text-base",
				icon: "size-12 rounded-[var(--tk-radius-md,10px)]",
				"icon-sm": "size-9 rounded-[var(--tk-radius-sm,6px)]",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function TkButton({
	className,
	variant = "default",
	size = "default",
	asChild = false,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof tkButtonVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot : "button";

	return (
		<Comp
			data-slot="tk-button"
			data-variant={variant}
			data-size={size}
			className={cn(tkButtonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { TkButton, tkButtonVariants };
