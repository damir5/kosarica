import { cn } from "@/lib/utils";
import type { DragEndEventHandlerFn } from "leaflet";
import {
	Map,
	MapMarker,
	MapPopup,
	MapTileLayer,
	MapZoomControl,
} from "@/components/ui/map";
import { useEffect, useState } from "react";

interface StoreLocationMapProps {
	latitude: string | null;
	longitude: string | null;
	onCoordinateChange?: (lat: string, lng: string) => void;
	readOnly?: boolean;
	className?: string;
	defaultCenter?: [number, number];
	mapKey: string; // Stable key based on store ID
}

export function StoreLocationMap({
	latitude,
	longitude,
	onCoordinateChange,
	readOnly = false,
	className,
	defaultCenter = [45.8150, 15.9819], // Zagreb
	mapKey,
}: StoreLocationMapProps) {
	// State for map position and drag state
	const [position, setPosition] = useState<[number, number]>(() => {
		if (latitude && longitude) {
			return [parseFloat(latitude), parseFloat(longitude)];
		}
		return defaultCenter;
	});
	const [isDragging, setIsDragging] = useState(false);

	// Sync position when store coordinates change (after save)
	useEffect(() => {
		if (latitude && longitude) {
			setPosition([parseFloat(latitude), parseFloat(longitude)]);
		}
	}, [latitude, longitude]);

	// Coordinate validation
	const isValidCoordinate = (lat: number, lng: number): boolean => {
		return (
			!isNaN(lat) &&
			!isNaN(lng) &&
			lat >= -90 &&
			lat <= 90 &&
			lng >= -180 &&
			lng <= 180
		);
	};

	// Handle marker drag end
	const handleMarkerDragEnd: DragEndEventHandlerFn = (event) => {
		const marker = event.target;
		const newPos = marker.getLatLng();

		if (isValidCoordinate(newPos.lat, newPos.lng)) {
			const formattedLat = newPos.lat.toFixed(6);
			const formattedLng = newPos.lng.toFixed(6);
			setPosition([newPos.lat, newPos.lng]);
			onCoordinateChange?.(formattedLat, formattedLng);
		}
		setIsDragging(false);
	};

	return (
		<div className={cn("relative overflow-hidden rounded-lg border", className)}>
			<Map
				key={mapKey}
				center={position}
				zoom={16}
				className={cn(
					"h-[400px] w-full",
					isDragging && "cursor-grabbing"
				)}
			>
				<MapTileLayer />
				<MapZoomControl />

				{latitude && longitude ? (
					<MapMarker
						position={position}
						draggable={!readOnly}
						eventHandlers={{
							dragstart: () => setIsDragging(true),
							dragend: handleMarkerDragEnd,
						}}
					>
						<MapPopup>
							<div className="text-sm">
								<div className="font-medium">Store Location</div>
								<div className="font-mono text-xs text-muted-foreground">
									{position[0].toFixed(6)}, {position[1].toFixed(6)}
								</div>
							</div>
						</MapPopup>
					</MapMarker>
				) : (
					<MapMarker
						position={position}
						draggable={!readOnly}
						opacity={0.5}
						eventHandlers={{
							dragstart: () => setIsDragging(true),
							dragend: handleMarkerDragEnd,
						}}
					>
						<MapPopup>
							<div className="text-sm">
								<div className="font-medium">Set Store Location</div>
								<div className="text-xs text-muted-foreground">
									Drag this pin to the correct location
								</div>
							</div>
						</MapPopup>
					</MapMarker>
				)}
			</Map>

			{isDragging && (
				<div className="absolute bottom-2 left-2 right-2 rounded-md bg-background/95 p-2 text-xs shadow-md backdrop-blur">
					Drop the pin to set coordinates
				</div>
			)}
		</div>
	);
}
