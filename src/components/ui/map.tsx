"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapContainerProps } from "react-leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";

// Override Leaflet's default high z-index to not interfere with modals
const mapStyles = `
.leaflet-pane,
.leaflet-top,
.leaflet-bottom {
  z-index: 1 !important;
}
`;

// Inject styles once
if (typeof document !== "undefined") {
	const styleId = "leaflet-z-index-fix";
	if (!document.getElementById(styleId)) {
		const style = document.createElement("style");
		style.id = styleId;
		style.textContent = mapStyles;
		document.head.appendChild(style);
	}
}

// Fix for default marker icon in leaflet with bundlers
// This must run before any markers are rendered
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: string })
	._getIconUrl;
L.Icon.Default.mergeOptions({
	iconRetinaUrl:
		"https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
	iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
	shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Loading skeleton for map
function MapSkeleton({ className }: { className?: string }) {
	return (
		<div
			className={`animate-pulse rounded-md bg-muted ${className ?? ""}`}
			style={{ minHeight: "300px" }}
		>
			<div className="flex h-full items-center justify-center text-muted-foreground text-sm">
				Loading map...
			</div>
		</div>
	);
}

export interface MapProps extends Omit<MapContainerProps, "children"> {
	children?: React.ReactNode;
	className?: string;
}

export function Map({ children, className, ...props }: MapProps) {
	return (
		<MapContainer
			className={`rounded-md ${className ?? ""}`}
			style={{ minHeight: "300px", width: "100%", zIndex: 0 }}
			{...props}
		>
			{children}
		</MapContainer>
	);
}

export interface MapTileLayerProps {
	url?: string;
	attribution?: string;
}

export function MapTileLayer({
	url = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
	attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
}: MapTileLayerProps) {
	return <TileLayer url={url} attribution={attribution} />;
}

export interface MapMarkerProps {
	position: [number, number];
	children?: React.ReactNode;
}

export function MapMarker({ position, children }: MapMarkerProps) {
	return <Marker position={position}>{children}</Marker>;
}

export interface MapPopupProps {
	children?: React.ReactNode;
}

export function MapPopup({ children }: MapPopupProps) {
	return <Popup>{children}</Popup>;
}

export { MapSkeleton };
