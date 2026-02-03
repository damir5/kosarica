import type * as React from "react";

import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
	return (
		/* biome-ignore lint/a11y/noLabelWithoutControl: User is expected to pass htmlFor prop when using this component */
		<label
			data-slot="label"
			className={cn(
				"text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 font-medium",
				className,
			)}
			{...props}
		/>
	);
}

export { Label };
