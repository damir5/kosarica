"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "tk-theme";

const icons = {
	light: Sun,
	dark: Moon,
	system: Monitor,
} as const;

const cycle: Record<Theme, Theme> = {
	light: "dark",
	dark: "system",
	system: "light",
};

function applyTheme(theme: Theme) {
	const root = document.documentElement;
	if (theme === "system") {
		const prefersDark = window.matchMedia(
			"(prefers-color-scheme: dark)",
		).matches;
		root.classList.toggle("dark", prefersDark);
	} else {
		root.classList.toggle("dark", theme === "dark");
	}
}

export function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>("system");

	useEffect(() => {
		const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
		if (stored && stored in cycle) {
			setTheme(stored);
			applyTheme(stored);
		}
	}, []);

	useEffect(() => {
		if (theme !== "system") return;
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = () => applyTheme("system");
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, [theme]);

	const toggle = useCallback(() => {
		const next = cycle[theme];
		setTheme(next);
		localStorage.setItem(STORAGE_KEY, next);
		applyTheme(next);
	}, [theme]);

	const Icon = icons[theme];

	return (
		<button
			type="button"
			onClick={toggle}
			className="flex size-9 items-center justify-center rounded-full text-tk-text-secondary transition-colors hover:bg-tk-surface-alt hover:text-tk-text"
			aria-label={`Tema: ${theme}`}
		>
			<Icon className="size-5" />
		</button>
	);
}
