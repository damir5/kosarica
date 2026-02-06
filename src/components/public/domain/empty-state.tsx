"use client";

import type * as React from "react";

import { cn } from "@/lib/utils";

import { TkButton } from "../primitives/button";

type EmptyStateVariant =
	| "search-empty"
	| "list-empty"
	| "alerts-empty"
	| "generic";

const defaultContent: Record<
	EmptyStateVariant,
	{ title: string; description: string }
> = {
	"search-empty": {
		title: "Nismo na\u0161li ni\u0161ta",
		description:
			"Poku\u0161aj s drugim pojmom. Ili nam reci \u0161to tra\u017Ei\u0161 \u2014 nismo AI, ali smo bliizu.",
	},
	"list-empty": {
		title: "Tvoja ko\u0161arica je prazna",
		description: "Kao i tvoj fridge, pretpostavljamo.",
	},
	"alerts-empty": {
		title: "Nema alarma",
		description:
			"Postavi alarm i mi \u0107emo te probuditi kad cijena padne. Figurativno.",
	},
	generic: {
		title: "Ni\u0161ta za vidjeti",
		description: "Pomakni se dalje, ni\u0161ta uzbudljivo ovdje.",
	},
};

interface EmptyStateProps {
	variant?: EmptyStateVariant;
	icon?: React.ReactNode;
	title?: string;
	description?: string;
	action?: { label: string; onClick: () => void };
	className?: string;
}

function EmptyStateIllustration() {
	return (
		<svg
			width="120"
			height="120"
			viewBox="0 0 120 120"
			fill="none"
			className="text-tk-text-tertiary opacity-40"
			aria-hidden="true"
		>
			<circle cx="60" cy="60" r="40" stroke="currentColor" strokeWidth="1.5" />
			<circle
				cx="60"
				cy="60"
				r="24"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeDasharray="4 4"
			/>
			<line
				x1="20"
				y1="60"
				x2="40"
				y2="60"
				stroke="currentColor"
				strokeWidth="1.5"
			/>
			<line
				x1="80"
				y1="60"
				x2="100"
				y2="60"
				stroke="currentColor"
				strokeWidth="1.5"
			/>
			<line
				x1="60"
				y1="20"
				x2="60"
				y2="40"
				stroke="currentColor"
				strokeWidth="1.5"
			/>
			<line
				x1="60"
				y1="80"
				x2="60"
				y2="100"
				stroke="currentColor"
				strokeWidth="1.5"
			/>
		</svg>
	);
}

function EmptyState({
	variant = "generic",
	icon,
	title,
	description,
	action,
	className,
}: EmptyStateProps) {
	const defaults = defaultContent[variant];
	const resolvedTitle = title ?? defaults.title;
	const resolvedDescription = description ?? defaults.description;

	return (
		<div
			data-slot="empty-state"
			className={cn(
				"flex flex-col items-center justify-center text-center py-12 px-6",
				className,
			)}
		>
			{icon ? (
				<div className="mb-4">{icon}</div>
			) : (
				<div className="mb-4">
					<EmptyStateIllustration />
				</div>
			)}

			<h3 className="text-lg font-semibold text-tk-text mb-1">
				{resolvedTitle}
			</h3>
			<p className="text-sm text-tk-text-secondary max-w-xs">
				{resolvedDescription}
			</p>

			{action && (
				<TkButton
					variant="secondary"
					size="sm"
					className="mt-6"
					onClick={action.onClick}
				>
					{action.label}
				</TkButton>
			)}
		</div>
	);
}

export { EmptyState };
export type { EmptyStateProps, EmptyStateVariant };
