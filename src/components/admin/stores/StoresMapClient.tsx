"use client";

import { MapTileLayer, MapView } from "@/components/ui/map";
import { MarkerClusterGroup } from "@/components/ui/map-cluster";

interface MarkerData {
	id: string;
	lat: number;
	lng: number;
	popup?: string;
	color?: string;
	onClick?: () => void;
}

interface StoresMapClientProps {
	markers: MarkerData[];
}

// Center of Croatia
const CROATIA_CENTER: [number, number] = [45.1, 16.0];
const DEFAULT_ZOOM = 7;

export default function StoresMapClient({ markers }: StoresMapClientProps) {
	return (
		<MapView
			center={CROATIA_CENTER}
			zoom={DEFAULT_ZOOM}
			scrollWheelZoom
			className="rounded-md min-h-[500px]"
		>
			<MapTileLayer />
			<MarkerClusterGroup markers={markers} />
		</MapView>
	);
}
