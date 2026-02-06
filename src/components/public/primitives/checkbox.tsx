import type * as React from "react";

import { cn } from "@/lib/utils";

function TkCheckbox({ className, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type="checkbox"
			data-slot="tk-checkbox"
			className={cn(
				"size-6 shrink-0 cursor-pointer appearance-none rounded-[var(--tk-radius-sm,6px)] border border-tk-border bg-tk-surface accent-tk-accent transition-transform active:scale-95",
				"checked:border-tk-accent checked:bg-tk-accent",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tk-accent/50",
				"disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}

export { TkCheckbox };
