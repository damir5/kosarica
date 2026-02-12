"use client";

import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";

interface MarkerData {
	id: string;
	lat: number;
	lng: number;
	popup?: string;
	color?: string;
	onClick?: () => void;
}

interface MarkerClusterGroupProps {
	markers: MarkerData[];
}

function createColoredIcon(color: string): L.DivIcon {
	return L.divIcon({
		html: `<div style="
			background-color: ${color};
			width: 12px;
			height: 12px;
			border-radius: 50%;
			border: 2px solid white;
			box-shadow: 0 1px 3px rgba(0,0,0,0.3);
		"></div>`,
		className: "",
		iconSize: [16, 16],
		iconAnchor: [8, 8],
		popupAnchor: [0, -8],
	});
}

/**
 * Imperative MarkerClusterGroup for react-leaflet.
 * Accepts an array of markers and renders them clustered on the map.
 */
export function MarkerClusterGroup({ markers }: MarkerClusterGroupProps) {
	const map = useMap();
	const clusterRef = useRef<L.MarkerClusterGroup | null>(null);

	useEffect(() => {
		const cluster = L.markerClusterGroup({
			chunkedLoading: true,
			maxClusterRadius: 50,
			spiderfyOnMaxZoom: true,
			showCoverageOnHover: false,
		});

		const leafletMarkers: L.Marker[] = [];
		for (const m of markers) {
			const icon = m.color ? createColoredIcon(m.color) : new L.Icon.Default();
			const marker = L.marker([m.lat, m.lng], { icon });

			if (m.popup) {
				marker.bindPopup(m.popup);
			}
			if (m.onClick) {
				const handler = m.onClick;
				marker.on("click", () => handler());
			}
			leafletMarkers.push(marker);
		}

		cluster.addLayers(leafletMarkers);
		map.addLayer(cluster);
		clusterRef.current = cluster;

		return () => {
			map.removeLayer(cluster);
			clusterRef.current = null;
		};
	}, [map, markers]);

	return null;
}
