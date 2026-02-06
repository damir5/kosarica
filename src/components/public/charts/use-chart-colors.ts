"use client";

import { type RefObject, useEffect, useState } from "react";

interface ChartColors {
	line: string;
	fill: string;
	axis: string;
	label: string;
	grid: string;
	dot: string;
}

const FALLBACK_COLORS: ChartColors = {
	line: "#16A34A",
	fill: "#16A34A",
	axis: "#E8E8E3",
	label: "#5A5D6B",
	grid: "#F5F5F0",
	dot: "#16A34A",
};

function resolveTokenRoot(ref?: RefObject<HTMLElement | SVGElement | null>): Element {
	const el = ref?.current;
	if (el) {
		const ancestor = el.closest(".tk-public");
		if (ancestor) return ancestor;
	}
	// Fall back to first .tk-public on the page, then documentElement
	return document.querySelector(".tk-public") ?? document.documentElement;
}

function readCssVar(root: Element, prop: string, fallback: string): string {
	const value = getComputedStyle(root).getPropertyValue(prop).trim();
	return value || fallback;
}

function getColors(root: Element): ChartColors {
	return {
		line: readCssVar(root, "--tk-accent", FALLBACK_COLORS.line),
		fill: readCssVar(root, "--tk-accent", FALLBACK_COLORS.fill),
		axis: readCssVar(root, "--tk-border", FALLBACK_COLORS.axis),
		label: readCssVar(root, "--tk-text-secondary", FALLBACK_COLORS.label),
		grid: readCssVar(root, "--tk-surface-alt", FALLBACK_COLORS.grid),
		dot: readCssVar(root, "--tk-accent", FALLBACK_COLORS.dot),
	};
}

export function useChartColors(
	ref?: RefObject<HTMLElement | SVGElement | null>,
): ChartColors {
	const [colors, setColors] = useState<ChartColors>(FALLBACK_COLORS);

	useEffect(() => {
		const root = resolveTokenRoot(ref);
		setColors(getColors(root));

		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = () => setColors(getColors(resolveTokenRoot(ref)));
		mq.addEventListener("change", handler);

		// Also observe class changes on html element for theme toggle
		const observer = new MutationObserver(() => {
			setColors(getColors(resolveTokenRoot(ref)));
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});

		return () => {
			mq.removeEventListener("change", handler);
			observer.disconnect();
		};
	}, [ref]);

	return colors;
}
