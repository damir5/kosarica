/**
 * Geocoding Service - handles address to coordinates conversion
 *
 * Uses Photon (komoot) for geocoding - based on OpenStreetMap data.
 * More permissive than Nominatim for automated requests.
 */

import { ResultAsync } from "neverthrow";
import { type FetchError, fetchError } from "./errors";

export interface GeocodingResult {
	found: boolean;
	latitude?: string;
	longitude?: string;
	displayName?: string;
	confidence: "high" | "medium" | "low";
	provider: "photon" | "nominatim" | "google";
	street?: string;
	houseNumber?: string;
	city?: string;
	postcode?: string;
	country?: string;
	cityMatch?: boolean;
	raw?: unknown;
}

export interface GeocodingInput {
	address?: string | null;
	city?: string | null;
	postalCode?: string | null;
	country?: string;
	storeName?: string | null;
}

const PHOTON_BASE_URL = "https://photon.komoot.io/api";
const USER_AGENT = "Kosarica/1.0 (contact@kosarica.hr)";

const CITY_ABBREVIATIONS: Record<string, string> = {
	zg: "Zagreb",
	zagreb: "Zagreb",
	os: "Osijek",
	osijek: "Osijek",
	sb: "Slavonski Brod",
	ri: "Rijeka",
	rijeka: "Rijeka",
	vz: "Varaždin",
	varazdin: "Varaždin",
	sp: "Split",
	split: "Split",
	st: "Split",
	kc: "Koprivnica",
	kn: "Knin",
	zd: "Zadar",
	zadar: "Zadar",
	pu: "Pula",
	pula: "Pula",
	du: "Dubrovnik",
	dubrovnik: "Dubrovnik",
};

const CITY_DIACRITICS: Record<string, string> = {
	cakovec: "Čakovec",
	dakovo: "Đakovo",
	djakovo: "Đakovo",
	gospic: "Gospić",
	karlovac: "Karlovac",
	koprivnica: "Koprivnica",
	krapina: "Krapina",
	krizevci: "Križevci",
	labin: "Labin",
	lovinac: "Lovinac",
	ogulin: "Ogulin",
	ozalj: "Ozalj",
	petrinja: "Petrinja",
	pazin: "Pazin",
	porec: "Poreč",
	pozega: "Požega",
	rovinj: "Rovinj",
	sibenik: "Šibenik",
	sisak: "Sisak",
	slatina: "Slatina",
	split: "Split",
	varazdin: "Varaždin",
	vinkovci: "Vinkovci",
	virovitica: "Virovitica",
	vukovar: "Vukovar",
	zadar: "Zadar",
	zagreb: "Zagreb",
	zupanja: "Županja",
	celik: "Čelik",
	cepin: "Čepin",
	bjelovar: "Bjelovar",
	daridar: "Daruvar",
	delnic: "Delnice",
	kastav: "Kastav",
	makarska: "Makarska",
	medulin: "Medulin",
	metkovic: "Metković",
	nasice: "Našice",
	pakrac: "Pakrac",
	prelog: "Prelog",
	samobor: "Samobor",
	senj: "Senj",
	sesvete: "Sesvete",
	sinj: "Sinj",
	velika: "Velika Gorica",
	vrbovec: "Vrbovec",
	vrsar: "Vrsar",
	zabok: "Zabok",
	zapresic: "Zaprešić",
	zlatar: "Zlatar",
	kastel: "Kaštela",
	sukosan: "Sukošan",
	trogir: "Trogir",
	umag: "Umag",
	pula: "Pula",
	rijeka: "Rijeka",
	dubrovnik: "Dubrovnik",
	osijek: "Osijek",
	imotski: "Imotski",
	slunj: "Slunj",
	otocac: "Otočac",
	zminj: "Žminj",
	lovan: "Lovran",
	novigrad: "Novigrad",
	porecnovigrad: "Poreč",
	novi: "Novi Vinodolski",
	komiza: "Komiža",
	hvar: "Hvar",
	korcul: "Korčula",
	krk: "Krk",
	mali: "Mali Lošinj",
	pag: "Pag",
	rab: "Rab",
};

function normalizeCityName(city: string): string {
	const normalized = city.toLowerCase().trim();
	if (CITY_DIACRITICS[normalized]) {
		return CITY_DIACRITICS[normalized];
	}
	const parts = normalized.split(/[\s_]+/);
	const firstPart = parts[0];
	if (CITY_ABBREVIATIONS[firstPart]) {
		return CITY_ABBREVIATIONS[firstPart];
	}
	if (CITY_DIACRITICS[firstPart]) {
		return CITY_DIACRITICS[firstPart];
	}
	return city;
}

function extractCityFromGarbage(value: string): string | null {
	const lower = value.toLowerCase().trim();
	const cityAbbr = Object.keys(CITY_ABBREVIATIONS).find((abbr) =>
		lower.startsWith(`${abbr} `),
	);
	if (cityAbbr) {
		return CITY_ABBREVIATIONS[cityAbbr];
	}
	for (const [key, city] of Object.entries(CITY_DIACRITICS)) {
		if (lower.includes(key)) {
			return city;
		}
	}
	return null;
}

/**
 * Geocode an address using Photon (komoot) - OpenStreetMap based
 */
export function geocodeAddress(
	input: GeocodingInput,
): ResultAsync<GeocodingResult, FetchError> {
	return ResultAsync.fromPromise(
		(async () => {
			const { address, postalCode, storeName } = input;
			let city = input.city;

			const normalizedCity = city ? normalizeCityName(city) : null;
			if (normalizedCity && normalizedCity !== city) {
				city = normalizedCity;
			} else if (city) {
				const extractedCity = extractCityFromGarbage(city);
				if (extractedCity) {
					city = extractedCity;
				}
			}

			const queries: string[] = [];

			if (address && city) {
				queries.push(`${address}, ${city}, Croatia`);
			}
			if (city) {
				queries.push(`${city}, Croatia`);
			}
			if (postalCode && city) {
				queries.push(`${postalCode} ${city}, Croatia`);
			}
			if (storeName && city) {
				const chainMatch = storeName.match(
					/^(Konzum|Lidl|Plodine|Kaufland|Interspar|Studenac|Eurospin|KTC|Metro|Trgocentar)\s+(.+)$/i,
				);
				if (chainMatch) {
					queries.push(`${chainMatch[2]}, Croatia`);
				}
			}
			if (address && !city) {
				queries.push(`${address}, Croatia`);
			}

			const uniqueQueries = [...new Set(queries.filter(Boolean))];

			if (uniqueQueries.length === 0) {
				return {
					found: false,
					confidence: "low",
					provider: "photon",
				} satisfies GeocodingResult;
			}

			for (const query of uniqueQueries) {
				const result = await tryGeocode(query, input);
				if (result.found) {
					return result;
				}
			}

			return {
				found: false,
				confidence: "low",
				provider: "photon",
			} satisfies GeocodingResult;
		})(),
		(e: unknown) =>
			fetchError({
				url: PHOTON_BASE_URL,
				message: e instanceof Error ? e.message : "Geocoding failed",
				retryable: true,
				attempts: 1,
				cause: e,
			}),
	);
}

async function tryGeocode(
	query: string,
	input: GeocodingInput,
): Promise<GeocodingResult> {
	const url = new URL(PHOTON_BASE_URL);
	url.searchParams.set("q", query);
	url.searchParams.set("limit", "3");
	url.searchParams.set("lang", "en");
	url.searchParams.set("lat", "45.1");
	url.searchParams.set("lon", "15.2");

	const response = await globalThis.fetch(url.toString(), {
		headers: {
			Accept: "application/json",
			"User-Agent": USER_AGENT,
		},
	});

	if (!response.ok) {
		return {
			found: false,
			confidence: "low",
			provider: "photon",
		};
	}

	const data = (await response.json()) as PhotonResponse;

	if (!data.features || data.features.length === 0) {
		return {
			found: false,
			confidence: "low",
			provider: "photon",
		};
	}

	for (const feature of data.features) {
		const [lon, lat] = feature.geometry.coordinates;
		const props = feature.properties;

		if (props.country && props.country.toLowerCase() !== "croatia") {
			continue;
		}

		const confidence = calculatePhotonConfidence(props, input);
		const resultCity = props.city || props.town || props.village;
		const cityMatch = citiesMatch(props, input);

		if (confidence === "high" || (confidence === "medium" && cityMatch)) {
			const displayParts = [
				props.name,
				props.street,
				props.housenumber,
				resultCity,
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
				street: props.street ?? undefined,
				houseNumber: props.housenumber ?? undefined,
				city: resultCity ?? undefined,
				postcode: props.postcode ?? undefined,
				country: props.country ?? undefined,
				cityMatch,
				raw: feature,
			} satisfies GeocodingResult;
		}
	}

	const result = data.features[0];
	const [lon, lat] = result.geometry.coordinates;
	const props = result.properties;
	const confidence = calculatePhotonConfidence(props, input);
	const resultCity = props.city || props.town || props.village;
	const displayParts = [
		props.name,
		props.street,
		props.housenumber,
		resultCity,
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
		street: props.street ?? undefined,
		houseNumber: props.housenumber ?? undefined,
		city: resultCity ?? undefined,
		postcode: props.postcode ?? undefined,
		country: props.country ?? undefined,
		cityMatch: citiesMatch(props, input),
		raw: result,
	} satisfies GeocodingResult;
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
	const hasInputCity = Boolean(input.city?.trim());

	// High confidence: exact address match (house/building)
	if (
		osm_type === "N" &&
		["house", "building"].includes(osm_value || "") &&
		(hasInputCity ? citiesMatch(props, input) : true)
	) {
		return "high";
	}

	// Check if city matches
	const cityMatches = citiesMatch(props, input);
	const hasStreet = Boolean(props.street?.trim());
	const isStreetLevel = ["street", "road", "shop", "amenity"].includes(
		osm_value || "",
	);

	// Medium confidence: plausible street-level match.
	if ((hasStreet || isStreetLevel) && (cityMatches || !hasInputCity)) {
		return "medium";
	}

	// Low confidence: city-only match or unknown quality.
	if (cityMatches) {
		return "low";
	}

	return "low";
}

function normalizeLocationPart(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim();
}

function citiesMatch(props: PhotonProperties, input: GeocodingInput): boolean {
	const resultCity = props.city || props.town || props.village;
	const inputCity = input.city;
	if (!resultCity || !inputCity) {
		return false;
	}

	const normalizedResultCity = normalizeLocationPart(resultCity);
	const normalizedInputCity = normalizeLocationPart(inputCity);
	if (!normalizedResultCity || !normalizedInputCity) {
		return false;
	}

	return (
		normalizedResultCity.includes(normalizedInputCity) ||
		normalizedInputCity.includes(normalizedResultCity)
	);
}

/**
 * Reverse geocode coordinates to get address
 */
export function reverseGeocode(
	latitude: string,
	longitude: string,
): ResultAsync<ReverseGeocodingResult, FetchError> {
	const nominatimUrl = "https://nominatim.openstreetmap.org/reverse";
	return ResultAsync.fromPromise(
		(async () => {
			const url = new URL(nominatimUrl);
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
				return {
					displayName: "",
					address: {},
					raw: {
						error: `Reverse geocoding API error: ${response.status} ${response.statusText}`,
						status: response.status,
						statusText: response.statusText,
					},
				} satisfies ReverseGeocodingResult;
			}

			const result = (await response.json()) as NominatimReverseResult;

			return {
				displayName: result.display_name,
				address: {
					road: result.address?.road,
					houseNumber: result.address?.house_number,
					city:
						result.address?.city ||
						result.address?.town ||
						result.address?.village,
					postalCode: result.address?.postcode,
					country: result.address?.country,
				},
				raw: result,
			} satisfies ReverseGeocodingResult;
		})(),
		(e: unknown) =>
			fetchError({
				url: nominatimUrl,
				message: e instanceof Error ? e.message : "Reverse geocoding failed",
				retryable: true,
				attempts: 1,
				cause: e,
			}),
	);
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
