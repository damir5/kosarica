"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface UserLocation {
	lat: number;
	lng: number;
	city: string;
	label: string;
	radiusKm: number;
	source: "geolocation" | "manual" | "city-select";
}

const LOCATION_KEY = ["user-location"] as const;
const STORAGE_KEY = "tk-location";

function readLocation(): UserLocation | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (
			parsed &&
			typeof parsed === "object" &&
			"lat" in parsed &&
			"lng" in parsed
		) {
			return parsed as UserLocation;
		}
		return null;
	} catch {
		return null;
	}
}

function writeLocation(location: UserLocation | null): void {
	if (typeof window === "undefined") return;
	if (location) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
	} else {
		localStorage.removeItem(STORAGE_KEY);
	}
}

export function useLocation() {
	const queryClient = useQueryClient();

	const { data: location = null } = useQuery({
		queryKey: LOCATION_KEY,
		queryFn: readLocation,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
	});

	function setLocation(loc: UserLocation) {
		writeLocation(loc);
		queryClient.setQueryData(LOCATION_KEY, loc);
	}

	function clearLocation() {
		writeLocation(null);
		queryClient.setQueryData(LOCATION_KEY, null);
	}

	return {
		location,
		setLocation,
		clearLocation,
		isSet: location != null,
	};
}
