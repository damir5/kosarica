import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

interface TkDrawerProps {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	children: React.ReactNode;
}

function TkDrawer({ open, onOpenChange, children }: TkDrawerProps) {
	return (
		<DialogPrimitive.Root
			data-slot="tk-drawer"
			open={open}
			onOpenChange={onOpenChange}
		>
			{children}
		</DialogPrimitive.Root>
	);
}

function TkDrawerTrigger({
	...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
	return <DialogPrimitive.Trigger data-slot="tk-drawer-trigger" {...props} />;
}

function TkDrawerClose({
	...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
	return <DialogPrimitive.Close data-slot="tk-drawer-close" {...props} />;
}

function TkDrawerOverlay({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
	return (
		<DialogPrimitive.Overlay
			data-slot="tk-drawer-overlay"
			className={cn(
				"fixed inset-0 z-50 bg-black/40",
				"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
				className,
			)}
			{...props}
		/>
	);
}

function TkDrawerContent({
	className,
	children,
	title,
	showCloseButton = true,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
	title: string;
	showCloseButton?: boolean;
}) {
	return (
		<DialogPrimitive.Portal>
			<TkDrawerOverlay />
			<DialogPrimitive.Content
				data-slot="tk-drawer-content"
				className={cn(
					"fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col overflow-y-auto rounded-t-[var(--tk-radius-xl,20px)] bg-tk-surface shadow-tk-lg outline-none",
					"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
					"duration-300",
					className,
				)}
				{...props}
			>
				{/* Drag handle indicator */}
				<div className="flex shrink-0 justify-center pt-3 pb-1">
					<div className="h-1.5 w-10 rounded-full bg-tk-border" />
				</div>

				{/* Header with title */}
				<div className="flex items-center justify-between px-4 pb-3">
					<DialogPrimitive.Title
						data-slot="tk-drawer-title"
						className="text-lg font-semibold font-tk-sans text-tk-text"
					>
						{title}
					</DialogPrimitive.Title>
					{showCloseButton && (
						<DialogPrimitive.Close
							data-slot="tk-drawer-close"
							className="rounded-[var(--tk-radius-sm,6px)] p-1.5 text-tk-text-secondary opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-tk-accent/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5"
						>
							<XIcon />
							<span className="sr-only">Close</span>
						</DialogPrimitive.Close>
					)}
				</div>

				{/* Hidden description for accessibility */}
				<DialogPrimitive.Description className="sr-only">
					{title}
				</DialogPrimitive.Description>

				{/* Content body */}
				<div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	);
}

export {
	TkDrawer,
	TkDrawerTrigger,
	TkDrawerClose,
	TkDrawerOverlay,
	TkDrawerContent,
};
