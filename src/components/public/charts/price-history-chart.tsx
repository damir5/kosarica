"use client";

import { scaleLinear, scaleTime } from "d3-scale";
import { area, line } from "d3-shape";
import { timeFormat } from "d3-time-format";
import { useId, useMemo, useRef } from "react";

import { cn } from "@/lib/utils";

import { useChartColors } from "./use-chart-colors";

interface DataPoint {
	date: string;
	value: number;
}

interface StoreOverlay {
	store: string;
	color: string;
	data: DataPoint[];
}

interface PriceHistoryChartProps {
	data: DataPoint[];
	height?: number;
	overlays?: StoreOverlay[];
	className?: string;
}

const PADDING = { top: 12, right: 12, bottom: 28, left: 48 };
const MONTH_FORMAT = timeFormat("%b");
const SHORT_FORMAT = timeFormat("%d.%m.");

function PriceHistoryChart({
	data,
	height = 200,
	overlays,
	className,
}: PriceHistoryChartProps) {
	const svgRef = useRef<SVGSVGElement>(null);
	const colors = useChartColors(svgRef);
	const gradientId = useId();

	const chart = useMemo(() => {
		if (data.length < 2) return null;

		const dates = data.map((d) => new Date(d.date));
		const values = data.map((d) => d.value);

		// Include overlay values in domain calculation
		let allValues = [...values];
		if (overlays) {
			for (const overlay of overlays) {
				allValues = allValues.concat(overlay.data.map((d) => d.value));
			}
		}

		const minVal = Math.min(...allValues);
		const maxVal = Math.max(...allValues);
		const valPadding = (maxVal - minVal) * 0.1 || 1;

		const xScale = scaleTime()
			.domain([dates[0], dates[dates.length - 1]])
			.range([PADDING.left, 600 - PADDING.right]);

		const yScale = scaleLinear()
			.domain([minVal - valPadding, maxVal + valPadding])
			.range([height - PADDING.bottom, PADDING.top]);

		// Main area path
		const areaGen = area<DataPoint>()
			.x((d) => xScale(new Date(d.date)))
			.y0(height - PADDING.bottom)
			.y1((d) => yScale(d.value));

		const lineGen = line<DataPoint>()
			.x((d) => xScale(new Date(d.date)))
			.y((d) => yScale(d.value));

		const areaPath = areaGen(data) || "";
		const linePath = lineGen(data) || "";

		// Overlay line paths
		const overlayPaths = overlays?.map((overlay) => ({
			store: overlay.store,
			color: overlay.color,
			path: lineGen(overlay.data) || "",
		}));

		// X-axis labels (spread evenly)
		const span = dates[dates.length - 1].getTime() - dates[0].getTime();
		const isShortRange = span < 30 * 24 * 60 * 60 * 1000;
		const fmt = isShortRange ? SHORT_FORMAT : MONTH_FORMAT;
		const tickCount = Math.min(data.length, 6);
		const step = Math.max(1, Math.floor(data.length / tickCount));
		const xLabels: Array<{ x: number; label: string }> = [];
		for (let i = 0; i < data.length; i += step) {
			xLabels.push({
				x: xScale(dates[i]),
				label: fmt(dates[i]),
			});
		}

		// Y-axis labels (min and max)
		const yLabels = [
			{
				y: yScale(minVal),
				label: `€${minVal.toFixed(2).replace(".", ",")}`,
			},
			{
				y: yScale(maxVal),
				label: `€${maxVal.toFixed(2).replace(".", ",")}`,
			},
		];

		// Current price dot
		const lastPoint = data[data.length - 1];
		const dot = {
			cx: xScale(new Date(lastPoint.date)),
			cy: yScale(lastPoint.value),
			label: `€${lastPoint.value.toFixed(2).replace(".", ",")}`,
		};

		return {
			areaPath,
			linePath,
			overlayPaths,
			xLabels,
			yLabels,
			dot,
		};
	}, [data, height, overlays]);

	if (!chart) {
		return (
			<div
				className={cn(
					"flex items-center justify-center text-sm text-tk-text-tertiary",
					className,
				)}
				style={{ height }}
			>
				Nedovoljno podataka
			</div>
		);
	}

	return (
		<svg
			ref={svgRef}
			data-slot="price-history-chart"
			viewBox={`0 0 600 ${height}`}
			className={cn("w-full", className)}
			role="img"
			aria-label="Grafikon povijesti cijena"
		>
			{/* Gradient fill */}
			<defs>
				<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor={colors.fill} stopOpacity={0.2} />
					<stop offset="100%" stopColor={colors.fill} stopOpacity={0} />
				</linearGradient>
			</defs>

			{/* Area fill */}
			<path d={chart.areaPath} fill={`url(#${gradientId})`} />

			{/* Main line */}
			<path
				d={chart.linePath}
				fill="none"
				stroke={colors.line}
				strokeWidth={2}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>

			{/* Store overlays */}
			{chart.overlayPaths?.map((overlay) => (
				<path
					key={overlay.store}
					d={overlay.path}
					fill="none"
					stroke={overlay.color}
					strokeWidth={1.5}
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeDasharray="4 3"
				/>
			))}

			{/* Current price dot */}
			<circle
				cx={chart.dot.cx}
				cy={chart.dot.cy}
				r={4}
				fill={colors.dot}
				stroke={colors.dot}
				strokeWidth={2}
			/>
			<text
				x={chart.dot.cx}
				y={chart.dot.cy - 10}
				textAnchor="middle"
				fontSize={12}
				fontWeight={600}
				fontFamily="var(--tk-font-mono, ui-monospace, monospace)"
				fill={colors.label}
			>
				{chart.dot.label}
			</text>

			{/* X-axis labels */}
			{chart.xLabels.map((tick) => (
				<text
					key={tick.x}
					x={tick.x}
					y={height - 6}
					textAnchor="middle"
					fontSize={11}
					fill={colors.label}
					fontFamily="var(--tk-font-sans, system-ui, sans-serif)"
				>
					{tick.label}
				</text>
			))}

			{/* Y-axis labels */}
			{chart.yLabels.map((tick) => (
				<text
					key={tick.y}
					x={PADDING.left - 6}
					y={tick.y + 4}
					textAnchor="end"
					fontSize={11}
					fill={colors.label}
					fontFamily="var(--tk-font-mono, ui-monospace, monospace)"
				>
					{tick.label}
				</text>
			))}

			{/* Baseline */}
			<line
				x1={PADDING.left}
				y1={height - PADDING.bottom}
				x2={600 - PADDING.right}
				y2={height - PADDING.bottom}
				stroke={colors.axis}
				strokeWidth={1}
			/>
		</svg>
	);
}

export { PriceHistoryChart };
export type { PriceHistoryChartProps, DataPoint, StoreOverlay };
