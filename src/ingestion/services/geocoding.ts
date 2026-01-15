/**
 * Geocoding Service - handles address to coordinates conversion
 *
 * Uses Nominatim (OpenStreetMap) for geocoding.
 * Future: could add Google Maps API support with confidence-based selection.
 */

export interface GeocodingResult {
	found: boolean;
	latitude?: string;
	longitude?: string;
	displayName?: string;
	confidence: "high" | "medium" | "low";
	provider: "nominatim" | "google";
	raw?: unknown;
}

export interface GeocodingInput {
	address?: string | null;
	city?: string | null;
	postalCode?: string | null;
	country?: string; // defaults to 'hr' (Croatia)
}

const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Kosarica/1.0 (price-tracker@example.com)";

/**
 * Geocode an address using Nominatim (OpenStreetMap)
 */
export async function geocodeAddress(
	input: GeocodingInput,
): Promise<GeocodingResult> {
	const { address, city, postalCode, country = "hr" } = input;

	// Build full address string
	const addressParts = [address, city, postalCode].filter(Boolean);
	const fullAddress = addressParts.join(", ");

	if (!fullAddress.trim()) {
		return {
			found: false,
			confidence: "low",
			provider: "nominatim",
		};
	}

	const url = new URL(NOMINATIM_BASE_URL);
	url.searchParams.set("q", fullAddress);
	url.searchParams.set("format", "json");
	url.searchParams.set("limit", "1");
	url.searchParams.set("countrycodes", country);
	url.searchParams.set("addressdetails", "1");

	const response = await globalThis.fetch(url.toString(), {
		headers: {
			"User-Agent": USER_AGENT,
		},
	});

	if (!response.ok) {
		throw new Error(
			`Geocoding API error: ${response.status} ${response.statusText}`,
		);
	}

	const results = (await response.json()) as NominatimResult[];

	if (results.length === 0) {
		return {
			found: false,
			confidence: "low",
			provider: "nominatim",
		};
	}

	const result = results[0];
	const confidence = calculateConfidence(result, input);

	return {
		found: true,
		latitude: result.lat,
		longitude: result.lon,
		displayName: result.display_name,
		confidence,
		provider: "nominatim",
		raw: result,
	};
}

/**
 * Calculate confidence based on the geocoding result quality
 */
function calculateConfidence(
	result: NominatimResult,
	input: GeocodingInput,
): "high" | "medium" | "low" {
	// High confidence: exact address match with good importance score
	if (result.importance > 0.5 && result.type === "house") {
		return "high";
	}

	// Medium confidence: street-level match or good importance
	if (
		result.importance > 0.3 ||
		["street", "road", "building", "commercial"].includes(result.type)
	) {
		// Check if city matches
		const resultCity =
			result.address?.city || result.address?.town || result.address?.village;
		if (
			resultCity &&
			input.city &&
			resultCity.toLowerCase().includes(input.city.toLowerCase())
		) {
			return "medium";
		}
		return "medium";
	}

	// Low confidence: city-level or worse
	return "low";
}

/**
 * Reverse geocode coordinates to get address
 */
export async function reverseGeocode(
	latitude: string,
	longitude: string,
): Promise<ReverseGeocodingResult> {
	const url = new URL("https://nominatim.openstreetmap.org/reverse");
	url.searchParams.set("lat", latitude);
	url.searchParams.set("lon", longitude);
	url.searchParams.set("format", "json");
	url.searchParams.set("addressdetails", "1");

	const response = await globalThis.fetch(url.toString(), {
		headers: {
			"User-Agent": USER_AGENT,
		},
	});

	if (!response.ok) {
		throw new Error(
			`Reverse geocoding API error: ${response.status} ${response.statusText}`,
		);
	}

	const result = (await response.json()) as NominatimReverseResult;

	return {
		displayName: result.display_name,
		address: {
			road: result.address?.road,
			houseNumber: result.address?.house_number,
			city:
				result.address?.city || result.address?.town || result.address?.village,
			postalCode: result.address?.postcode,
			country: result.address?.country,
		},
		raw: result,
	};
}

// Types for Nominatim API responses

interface NominatimResult {
	lat: string;
	lon: string;
	display_name: string;
	type: string;
	class: string;
	importance: number;
	address?: {
		road?: string;
		house_number?: string;
		city?: string;
		town?: string;
		village?: string;
		postcode?: string;
		country?: string;
	};
}

interface NominatimReverseResult {
	display_name: string;
	address?: {
		road?: string;
		house_number?: string;
		city?: string;
		town?: string;
		village?: string;
		postcode?: string;
		country?: string;
	};
}

export interface ReverseGeocodingResult {
	displayName: string;
	address: {
		road?: string;
		houseNumber?: string;
		city?: string;
		postalCode?: string;
		country?: string;
	};
	raw?: unknown;
}
