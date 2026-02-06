import type * as React from "react";

import { cn } from "@/lib/utils";

export function PageContainer({
	className,
	children,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="page-container"
			className={cn("mx-auto max-w-[1200px] px-4 md:px-8 lg:px-6", className)}
			{...props}
		>
			{children}
		</div>
	);
}
