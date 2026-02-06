import type * as React from "react";

import { cn } from "@/lib/utils";

function TkSkeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="tk-skeleton"
			className={cn(
				"animate-pulse rounded-[var(--tk-radius-md,10px)] bg-tk-surface-alt",
				className,
			)}
			{...props}
		/>
	);
}

export { TkSkeleton };
