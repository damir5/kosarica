import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const tkCardVariants = cva(
	"bg-tk-surface rounded-[var(--tk-radius-lg,14px)] shadow-tk-sm border border-tk-border transition-shadow",
	{
		variants: {
			hover: {
				true: "hover:shadow-tk-md",
				false: "",
			},
		},
		defaultVariants: {
			hover: false,
		},
	},
);

function TkCard({
	className,
	hover = false,
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof tkCardVariants>) {
	return (
		<div
			data-slot="tk-card"
			className={cn(tkCardVariants({ hover, className }))}
			{...props}
		/>
	);
}

function TkCardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="tk-card-header"
			className={cn("flex flex-col gap-1.5 p-4", className)}
			{...props}
		/>
	);
}

function TkCardContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="tk-card-content"
			className={cn("px-4 pb-4", className)}
			{...props}
		/>
	);
}

function TkCardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="tk-card-footer"
			className={cn(
				"flex items-center border-t border-tk-border px-4 pt-3 pb-3",
				className,
			)}
			{...props}
		/>
	);
}

export { TkCard, TkCardHeader, TkCardContent, TkCardFooter, tkCardVariants };
