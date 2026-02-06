import { cn } from "@/lib/utils";

interface SparklineProps {
	data: number[];
	width?: number;
	height?: number;
	className?: string;
	color?: string;
}

function Sparkline({
	data,
	width = 80,
	height = 24,
	className,
	color,
}: SparklineProps) {
	if (data.length < 2) return null;

	const min = Math.min(...data);
	const max = Math.max(...data);
	const range = max - min || 1;

	const points = data
		.map((value, i) => {
			const x = (i / (data.length - 1)) * width;
			const y = height - ((value - min) / range) * height;
			return `${x},${y}`;
		})
		.join(" ");

	const pathLength = data.length * 20;

	const prefersMotion =
		typeof window !== "undefined" &&
		!window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	const animatedStyle: React.CSSProperties = prefersMotion
		? {
				strokeDasharray: pathLength,
				strokeDashoffset: pathLength,
				animation: "sparkline-draw 1s ease-out forwards",
			}
		: {};

	return (
		<svg
			data-slot="sparkline"
			className={cn("inline-block", className)}
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			fill="none"
			aria-hidden="true"
		>
			{prefersMotion && (
				<style>
					{`@keyframes sparkline-draw { to { stroke-dashoffset: 0; } }`}
				</style>
			)}
			<polyline
				points={points}
				stroke={color ?? "currentColor"}
				strokeWidth={1.5}
				strokeLinecap="round"
				strokeLinejoin="round"
				fill="none"
				style={animatedStyle}
			/>
		</svg>
	);
}

export { Sparkline };
