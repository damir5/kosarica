import L from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

export function FullscreenControl() {
	const map = useMap();

	useEffect(() => {
		const control = new (L.Control.extend({
			onAdd() {
				const container = L.DomUtil.create(
					"div",
					"leaflet-bar leaflet-control",
				);
				const button = L.DomUtil.create("a", "", container);
				button.innerHTML = "&#x26F6;";
				button.href = "#";
				button.title = "Toggle fullscreen";
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
					const mapContainer = map.getContainer();
					if (!document.fullscreenElement) {
						mapContainer.requestFullscreen?.();
					} else {
						document.exitFullscreen?.();
					}
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
