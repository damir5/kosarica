"use client";

import {
	MapMarker,
	MapPopup,
	MapTileLayer,
	MapView,
} from "@/components/ui/map";

interface StoreMarker {
	id: string;
	name: string;
	address: string | null;
	chainName: string;
	latitude: string | null;
	longitude: string | null;
	distanceKm: number;
}

interface StoreMapProps {
	center: [number, number];
	stores: StoreMarker[];
	zoom?: number;
	className?: string;
}

export default function StoreMap({
	center,
	stores,
	zoom = 12,
	className,
}: StoreMapProps) {
	return (
		<MapView
			center={center}
			zoom={zoom}
			className={className}
			scrollWheelZoom
		>
			<MapTileLayer />
			{stores.map((store) => {
				if (!store.latitude || !store.longitude) return null;
				const lat = Number.parseFloat(store.latitude);
				const lng = Number.parseFloat(store.longitude);
				if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
				return (
					<MapMarker key={store.id} position={[lat, lng]}>
						<MapPopup>
							<div className="text-sm">
								<p className="font-semibold">{store.name}</p>
								<p className="text-muted-foreground">{store.chainName}</p>
								{store.address && (
									<p className="text-muted-foreground">{store.address}</p>
								)}
								<p className="mt-1 text-xs">
									{store.distanceKm} km
								</p>
							</div>
						</MapPopup>
					</MapMarker>
				);
			})}
		</MapView>
	);
}
