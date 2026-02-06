import type * as React from "react";

import { cn } from "@/lib/utils";

function TkInput({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="tk-input"
			className={cn(
				"h-12 w-full min-w-0 rounded-[var(--tk-radius-md,10px)] border border-tk-border bg-tk-surface-alt px-4 text-base font-tk-sans text-tk-text shadow-none outline-none transition-[color,box-shadow,border-color]",
				"placeholder:text-tk-text-tertiary",
				"focus-visible:ring-2 focus-visible:ring-tk-accent/50 focus-visible:border-tk-accent",
				"disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
				"file:inline-flex file:h-8 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-tk-text",
				className,
			)}
			{...props}
		/>
	);
}

export { TkInput };
