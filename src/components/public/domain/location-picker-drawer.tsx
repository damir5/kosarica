"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, Navigation, X } from "lucide-react";
import { useState } from "react";

import { useLocation, type UserLocation } from "@/hooks/use-location";
import { orpc } from "@/orpc/client";
import { TkButton } from "../primitives/button";
import { TkDrawer, TkDrawerContent } from "../primitives/drawer";

type GeoState = "idle" | "loading" | "denied" | "error";

interface LocationPickerDrawerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function LocationPickerDrawer({
	open,
	onOpenChange,
}: LocationPickerDrawerProps) {
	const { location, setLocation, clearLocation, isSet } = useLocation();
	const [geoState, setGeoState] = useState<GeoState>("idle");

	const citiesQuery = useQuery({
		...orpc.stores.listCities.queryOptions({ input: undefined }),
		enabled: open,
		staleTime: 10 * 60 * 1000,
	});

	const cities = citiesQuery.data?.cities ?? [];

	function handleGeolocation() {
		if (!navigator.geolocation) {
			setGeoState("error");
			return;
		}

		setGeoState("loading");
		navigator.geolocation.getCurrentPosition(
			async (position) => {
				const { latitude, longitude } = position.coords;
				let city = "Moja lokacija";

				try {
					const response = await fetch(
						`https://photon.komoot.io/reverse?lat=${latitude}&lon=${longitude}`,
					);
					const data = (await response.json()) as {
						features?: Array<{
							properties?: { city?: string; name?: string };
						}>;
					};
					const props = data.features?.[0]?.properties;
					if (props?.city) {
						city = props.city;
					} else if (props?.name) {
						city = props.name;
					}
				} catch {
					// Reverse geocode failed — use fallback label
				}

				const loc: UserLocation = {
					lat: latitude,
					lng: longitude,
					city,
					label: city,
					radiusKm: 10,
					source: "geolocation",
				};
				setLocation(loc);
				setGeoState("idle");
				onOpenChange(false);
			},
			(error) => {
				if (error.code === error.PERMISSION_DENIED) {
					setGeoState("denied");
				} else {
					setGeoState("error");
				}
			},
			{ enableHighAccuracy: false, timeout: 10000 },
		);
	}

	function handleCitySelect(city: {
		city: string;
		lat: number;
		lng: number;
	}) {
		const loc: UserLocation = {
			lat: city.lat,
			lng: city.lng,
			city: city.city,
			label: city.city,
			radiusKm: 10,
			source: "city-select",
		};
		setLocation(loc);
		onOpenChange(false);
	}

	function handleClear() {
		clearLocation();
		onOpenChange(false);
	}

	return (
		<TkDrawer open={open} onOpenChange={onOpenChange}>
			<TkDrawerContent title="Odaberi lokaciju">
				<div className="space-y-4">
					{/* Geolocation button */}
					<TkButton
						variant="default"
						className="w-full"
						onClick={handleGeolocation}
						disabled={geoState === "loading"}
					>
						{geoState === "loading" ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Navigation className="size-4" />
						)}
						Koristi moju lokaciju
					</TkButton>

					{geoState === "denied" && (
						<p className="text-xs text-tk-deal-bad">
							Pristup lokaciji je odbijen. Odaberi grad iz popisa.
						</p>
					)}
					{geoState === "error" && (
						<p className="text-xs text-tk-deal-bad">
							Greška pri dohvatu lokacije. Odaberi grad iz popisa.
						</p>
					)}

					{/* City list */}
					<div>
						<p className="mb-2 text-xs font-medium text-tk-text-secondary uppercase tracking-wide">
							Ili odaberi grad
						</p>
						<div className="max-h-[40vh] space-y-1 overflow-y-auto">
							{citiesQuery.isLoading ? (
								<div className="flex items-center justify-center py-8">
									<Loader2 className="size-5 animate-spin text-tk-text-tertiary" />
								</div>
							) : (
								cities.map((city) => (
									<button
										key={city.city}
										type="button"
										onClick={() => handleCitySelect(city)}
										className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-tk-surface-alt"
									>
										<span className="flex items-center gap-2">
											<MapPin className="size-4 text-tk-text-tertiary" />
											<span className="text-tk-text">{city.city}</span>
										</span>
										<span className="text-xs text-tk-text-tertiary">
											{city.storeCount} trgovina
										</span>
									</button>
								))
							)}
						</div>
					</div>

					{/* Clear button */}
					{isSet && (
						<div className="border-t border-tk-border pt-3">
							<TkButton
								variant="ghost"
								size="sm"
								className="w-full text-tk-text-secondary"
								onClick={handleClear}
							>
								<X className="size-3.5" />
								Ukloni lokaciju ({location?.city})
							</TkButton>
						</div>
					)}
				</div>
			</TkDrawerContent>
		</TkDrawer>
	);
}
