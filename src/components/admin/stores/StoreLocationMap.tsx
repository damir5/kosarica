import { lazy, Suspense } from "react";

export interface StoreLocationMapProps {
	latitude: string | null;
	longitude: string | null;
	storeName?: string;
	className?: string;
}

function MapSkeleton({ className }: { className?: string }) {
	return (
		<div
			className={`animate-pulse rounded-md bg-muted ${className ?? ""}`}
			style={{ minHeight: "300px" }}
		>
			<div className="flex h-full min-h-[300px] items-center justify-center text-muted-foreground text-sm">
				Loading map...
			</div>
		</div>
	);
}

// Lazy load the actual map implementation to avoid SSR issues with leaflet
const StoreLocationMapClient = lazy(() =>
	import("./StoreLocationMapClient").then((mod) => ({
		default: mod.StoreLocationMapClient,
	})),
);

export function StoreLocationMap({
	latitude,
	longitude,
	storeName,
	className,
}: StoreLocationMapProps) {
	const hasCoordinates = latitude !== null && longitude !== null;

	if (!hasCoordinates) {
		return (
			<div
				className={`flex items-center justify-center rounded-md border border-dashed bg-muted/50 text-muted-foreground text-sm ${className ?? ""}`}
				style={{ minHeight: "300px" }}
			>
				No coordinates available
			</div>
		);
	}

	const lat = Number.parseFloat(latitude);
	const lng = Number.parseFloat(longitude);

	// Validate coordinates
	if (Number.isNaN(lat) || Number.isNaN(lng)) {
		return (
			<div
				className={`flex items-center justify-center rounded-md border border-dashed bg-muted/50 text-muted-foreground text-sm ${className ?? ""}`}
				style={{ minHeight: "300px" }}
			>
				Invalid coordinates
			</div>
		);
	}

	return (
		<Suspense fallback={<MapSkeleton className={className} />}>
			<StoreLocationMapClient
				latitude={lat}
				longitude={lng}
				storeName={storeName}
				className={className}
			/>
		</Suspense>
	);
}
