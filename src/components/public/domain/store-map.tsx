"use client";

import L from "leaflet";
import { useEffect, useMemo } from "react";
import { useMap } from "react-leaflet";
import {
	STORE_COLORS,
	type StoreSlug,
} from "@/components/public/domain/store-colors";
import { FullscreenControl } from "@/components/ui/fullscreen-control";
import { MapTileLayer, MapView } from "@/components/ui/map";
import { MarkerClusterGroup } from "@/components/ui/map-cluster";
import { escapeHtml } from "@/utils/html";

interface StoreMarker {
	id: string;
	name: string;
	displayName?: string | null;
	address: string | null;
	chainName: string;
	chainSlug?: string;
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

function LocateControl() {
	const map = useMap();

	useEffect(() => {
		const control = new (L.Control.extend({
			onAdd() {
				const container = L.DomUtil.create(
					"div",
					"leaflet-bar leaflet-control",
				);
				const button = L.DomUtil.create("a", "", container);
				button.innerHTML = "&#x2316;";
				button.href = "#";
				button.title = "Find my location";
				button.style.fontSize = "18px";
				button.style.lineHeight = "26px";
				button.style.textAlign = "center";
				button.style.width = "26px";
				button.style.height = "26px";
				button.style.display = "block";
				button.style.textDecoration = "none";
				button.style.color = "#333";

				L.DomEvent.on(button, "click", (e) => {
					L.DomEvent.preventDefault(e);
					map.locate({ setView: true, maxZoom: 14 });
				});

				return container;
			},
		}))({ position: "topright" });

		map.addControl(control);
		return () => {
			map.removeControl(control);
		};
	}, [map]);

	return null;
}

export default function StoreMap({
	center,
	stores,
	zoom = 12,
	className,
}: StoreMapProps) {
	const markers = useMemo(() => {
		return stores
			.filter((s) => s.latitude && s.longitude)
			.map((store) => {
				const lat = Number.parseFloat(store.latitude!);
				const lng = Number.parseFloat(store.longitude!);
				if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

				const color = store.chainSlug
					? (STORE_COLORS[store.chainSlug as StoreSlug] ?? "#6b7280")
					: "#6b7280";

				const displayName = store.displayName ?? store.name;
				const popup = `
					<div style="font-size:13px;line-height:1.4">
						<strong>${escapeHtml(displayName)}</strong>
						<div style="color:#666">${escapeHtml(store.chainName)}</div>
						${store.address ? `<div style="color:#888;font-size:12px">${escapeHtml(store.address)}</div>` : ""}
						<div style="font-size:11px;margin-top:4px">${store.distanceKm} km</div>
					</div>
				`;

				return {
					id: store.id,
					lat,
					lng,
					popup,
					color,
				};
			})
			.filter(Boolean) as Array<{
			id: string;
			lat: number;
			lng: number;
			popup: string;
			color: string;
		}>;
	}, [stores]);

	return (
		<MapView center={center} zoom={zoom} className={className} scrollWheelZoom>
			<MapTileLayer />
			<FullscreenControl />
			<LocateControl />
			<MarkerClusterGroup markers={markers} />
		</MapView>
	);
}
