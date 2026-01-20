/**
 * Geocoding Service - handles address to coordinates conversion
 *
 * Uses Photon (komoot) for geocoding - based on OpenStreetMap data.
 * More permissive than Nominatim for automated requests.
 */

export interface GeocodingResult {
	found: boolean;
	latitude?: string;
	longitude?: string;
	displayName?: string;
	confidence: "high" | "medium" | "low";
	provider: "photon" | "nominatim" | "google";
	raw?: unknown;
}

export interface GeocodingInput {
	address?: string | null;
	city?: string | null;
	postalCode?: string | null;
	country?: string; // defaults to 'hr' (Croatia)
}

const PHOTON_BASE_URL = "https://photon.komoot.io/api";

/**
 * Geocode an address using Photon (komoot) - OpenStreetMap based
 */
export async function geocodeAddress(
	input: GeocodingInput,
): Promise<GeocodingResult> {
	const { address, city, postalCode } = input;

	// Build full address string
	const addressParts = [address, city, postalCode].filter(Boolean);
	const fullAddress = addressParts.join(", ");

	if (!fullAddress.trim()) {
		return {
			found: false,
			confidence: "low",
			provider: "photon",
		};
	}

	const url = new URL(PHOTON_BASE_URL);
	url.searchParams.set("q", fullAddress);
	url.searchParams.set("limit", "1");
	url.searchParams.set("lang", "en");
	// Bias results towards Croatia
	url.searchParams.set("lat", "45.1");
	url.searchParams.set("lon", "15.2");

	const response = await globalThis.fetch(url.toString(), {
		headers: {
			Accept: "application/json",
		},
	});

	if (!response.ok) {
		throw new Error(
			`Geocoding API error: ${response.status} ${response.statusText}`,
		);
	}

	const data = (await response.json()) as PhotonResponse;

	if (!data.features || data.features.length === 0) {
		return {
			found: false,
			confidence: "low",
			provider: "photon",
		};
	}

	const result = data.features[0];
	const [lon, lat] = result.geometry.coordinates;
	const props = result.properties;
	const confidence = calculatePhotonConfidence(props, input);

	// Build display name from properties
	const displayParts = [
		props.name,
		props.street,
		props.housenumber,
		props.city || props.town || props.village,
		props.postcode,
		props.country,
	].filter(Boolean);

	return {
		found: true,
		latitude: lat.toString(),
		longitude: lon.toString(),
		displayName: displayParts.join(", "),
		confidence,
		provider: "photon",
		raw: result,
	};
}

/**
 * Calculate confidence based on Photon result quality
 */
function calculatePhotonConfidence(
	props: PhotonProperties,
	input: GeocodingInput,
): "high" | "medium" | "low" {
	const osm_type = props.osm_type;
	const osm_value = props.osm_value;

	// High confidence: exact address match (house/building)
	if (osm_type === "N" && ["house", "building"].includes(osm_value || "")) {
		return "high";
	}

	// Check if city matches
	const resultCity = props.city || props.town || props.village;
	const cityMatches =
		resultCity &&
		input.city &&
		resultCity.toLowerCase().includes(input.city.toLowerCase());

	// Medium confidence: street-level or city matches
	if (
		["street", "road", "shop", "amenity"].includes(osm_value || "") ||
		cityMatches
	) {
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

// Types for Photon API responses

interface PhotonResponse {
	features: PhotonFeature[];
}

interface PhotonFeature {
	geometry: {
		coordinates: [number, number]; // [lon, lat]
	};
	properties: PhotonProperties;
}

interface PhotonProperties {
	name?: string;
	street?: string;
	housenumber?: string;
	city?: string;
	town?: string;
	village?: string;
	postcode?: string;
	country?: string;
	osm_type?: string;
	osm_value?: string;
}

// Types for Nominatim reverse geocoding (still used)

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
