import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Heading                                                                   */
/* -------------------------------------------------------------------------- */

const headingVariants = cva("font-tk-sans font-semibold text-tk-text", {
	variants: {
		size: {
			xl: "text-2xl",
			lg: "text-xl",
			md: "text-lg",
			sm: "text-base",
		},
	},
	defaultVariants: {
		size: "md",
	},
});

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

function Heading({
	level = 2,
	size,
	className,
	...props
}: React.ComponentProps<"h1"> &
	VariantProps<typeof headingVariants> & {
		level?: HeadingLevel;
	}) {
	const Tag = `h${level}` as const;

	return (
		<Tag
			data-slot="tk-heading"
			className={cn(headingVariants({ size, className }))}
			{...props}
		/>
	);
}

/* -------------------------------------------------------------------------- */
/*  Text                                                                      */
/* -------------------------------------------------------------------------- */

const textVariants = cva("font-tk-sans text-tk-text", {
	variants: {
		variant: {
			body: "text-base",
			small: "text-sm",
			caption: "text-xs text-tk-text-secondary",
		},
	},
	defaultVariants: {
		variant: "body",
	},
});

function Text({
	as = "p",
	variant,
	className,
	ref,
	...props
}: React.ComponentProps<"p"> &
	VariantProps<typeof textVariants> & {
		as?: "p" | "span";
	}) {
	if (as === "span") {
		return (
			<span
				ref={ref as React.Ref<HTMLSpanElement>}
				data-slot="tk-text"
				className={cn(textVariants({ variant, className }))}
				{...props}
			/>
		);
	}

	return (
		<p
			ref={ref}
			data-slot="tk-text"
			className={cn(textVariants({ variant, className }))}
			{...props}
		/>
	);
}

/* -------------------------------------------------------------------------- */
/*  Price                                                                     */
/* -------------------------------------------------------------------------- */

const priceVariants = cva("font-tk-mono tabular-nums tracking-tight", {
	variants: {
		size: {
			hero: "text-2xl font-bold",
			compact: "text-lg font-semibold",
			small: "text-sm",
		},
	},
	defaultVariants: {
		size: "compact",
	},
});

function Price({
	size,
	className,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof priceVariants>) {
	return (
		<span
			data-slot="tk-price"
			className={cn(priceVariants({ size, className }))}
			{...props}
		/>
	);
}

export { Heading, headingVariants, Text, textVariants, Price, priceVariants };
