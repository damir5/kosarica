"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { formatPrice } from "./price-display";

interface SavingsCounterProps {
	amount: number;
	className?: string;
}

function SavingsCounter({ amount, className }: SavingsCounterProps) {
	const [displayed, setDisplayed] = useState(0);
	const rafRef = useRef<number | null>(null);
	const startTimeRef = useRef<number | null>(null);

	useEffect(() => {
		const duration = 1200;
		startTimeRef.current = null;

		function animate(timestamp: number) {
			if (startTimeRef.current === null) {
				startTimeRef.current = timestamp;
			}

			const elapsed = timestamp - startTimeRef.current;
			const progress = Math.min(elapsed / duration, 1);

			// ease-out cubic
			const eased = 1 - (1 - progress) ** 3;
			setDisplayed(eased * amount);

			if (progress < 1) {
				rafRef.current = requestAnimationFrame(animate);
			}
		}

		rafRef.current = requestAnimationFrame(animate);

		return () => {
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
			}
		};
	}, [amount]);

	return (
		<div
			data-slot="savings-counter"
			className={cn("flex flex-col items-center", className)}
		>
			<span className="text-sm text-tk-text-secondary mb-1">U&scaron;teda</span>
			<span
				className="font-tk-mono text-3xl font-bold tabular-nums tracking-tight text-tk-text"
				style={{ letterSpacing: "-0.02em" }}
			>
				<span className="opacity-70" style={{ fontSize: "0.75em" }}>
					&euro;
				</span>
				{formatPrice(displayed)}
			</span>
		</div>
	);
}

export { SavingsCounter };
export type { SavingsCounterProps };
