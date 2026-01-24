import {
	Map as MapComponent,
	MapMarker,
	MapPopup,
	MapTileLayer,
} from "@/components/ui/map";

export interface StoreLocationMapClientProps {
	latitude: number;
	longitude: number;
	storeName?: string;
	className?: string;
}

const DEFAULT_ZOOM = 15;

export function StoreLocationMapClient({
	latitude,
	longitude,
	storeName,
	className,
}: StoreLocationMapClientProps) {
	const position: [number, number] = [latitude, longitude];

	return (
		<MapComponent
			center={position}
			zoom={DEFAULT_ZOOM}
			scrollWheelZoom={false}
			className={className}
		>
			<MapTileLayer />
			<MapMarker position={position}>
				{storeName && (
					<MapPopup>
						<div className="font-medium">{storeName}</div>
						<div className="font-mono text-muted-foreground text-xs">
							{latitude.toFixed(6)}, {longitude.toFixed(6)}
						</div>
					</MapPopup>
				)}
			</MapMarker>
		</MapComponent>
	);
}
