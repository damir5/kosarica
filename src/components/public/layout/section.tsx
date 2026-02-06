import { Link } from "@tanstack/react-router";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const sectionVariants = cva("", {
	variants: {
		spacing: {
			default: "py-8",
			compact: "py-6",
			hero: "py-12",
		},
	},
	defaultVariants: {
		spacing: "default",
	},
});

export function Section({
	className,
	spacing,
	title,
	action,
	children,
	...props
}: React.ComponentProps<"section"> &
	VariantProps<typeof sectionVariants> & {
		title?: string;
		action?: { label: string; href: string };
	}) {
	return (
		<section
			data-slot="section"
			className={cn(sectionVariants({ spacing }), className)}
			{...props}
		>
			{title && (
				<div
					data-slot="section-header"
					className="mb-4 flex items-center justify-between"
				>
					<h2 className="text-lg font-semibold">{title}</h2>
					{action && (
						<Link
							to={action.href}
							className="text-sm font-medium text-tk-accent transition-colors hover:text-tk-accent/80"
						>
							{action.label} &rarr;
						</Link>
					)}
				</div>
			)}
			{children}
		</section>
	);
}
