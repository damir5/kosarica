/**
 * Store Display Name Generator
 *
 * Builds human-readable display names for stores using tiered collision resolution.
 * Names are auto-generated from chain + city + street, with disambiguation
 * when multiple stores share the same base name.
 */

interface StoreForNaming {
	id: string;
	chainSlug: string;
	name: string;
	address: string | null;
	city: string | null;
	postalCode: string | null;
	displayNameManual: boolean | null;
}

interface StoreWithChainName extends StoreForNaming {
	chainName: string;
}

/**
 * Normalize a string for grouping/comparison: lowercase, strip diacritics,
 * trim, collapse whitespace. Display keeps original casing.
 */
function normalizeForGrouping(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim()
		.replace(/\s+/g, " ");
}

/**
 * Extract street name from address string (before house number).
 * Croatian addresses typically: "Ulica Grada Vukovara 271"
 */
function extractStreet(address: string): string | null {
	const trimmed = address.trim();
	if (!trimmed) return null;

	// Remove trailing house number (digits, possibly with letter suffix like "12a")
	const match = trimmed.match(/^(.+?)\s+\d+[a-zA-Z]?\s*$/);
	if (match) return match[1].trim();

	return trimmed;
}

/**
 * Extract house number from address string.
 */
function extractHouseNumber(address: string): string | null {
	const match = address.trim().match(/\s+(\d+[a-zA-Z]?)\s*$/);
	return match ? match[1] : null;
}

/**
 * Generate a display name for a single store given knowledge of whether
 * disambiguation is needed.
 */
export function generateDisplayName(
	store: StoreWithChainName,
	needsDisambiguation: boolean,
): string {
	const { chainName, city, address, postalCode, id } = store;

	// If no city, fall back to raw name
	if (!city?.trim()) {
		return store.name;
	}

	const base = `${chainName} ${city.trim()}`;

	if (!needsDisambiguation) {
		return base;
	}

	// Tier 2: append street
	const street = address ? extractStreet(address) : null;
	if (street) {
		const withStreet = `${base}, ${street}`;
		return withStreet;
	}

	// Tier 3: append house number or postal code
	const houseNumber = address ? extractHouseNumber(address) : null;
	if (houseNumber) {
		return `${base} ${houseNumber}`;
	}
	if (postalCode?.trim()) {
		return `${base} (${postalCode.trim()})`;
	}

	// Tier 4: append last 4 chars of store ID
	const idSuffix = id.slice(-4);
	return `${base} #${idSuffix}`;
}

/**
 * Batch generate display names for a list of stores with collision detection.
 * Groups stores by (chainSlug, normalizedCity) and applies disambiguation tiers.
 *
 * Only generates names for stores where displayNameManual is false/null.
 */
export function generateDisplayNames(
	stores: StoreWithChainName[],
): Map<string, string> {
	const result = new Map<string, string>();

	// Group by (chainSlug, normalizedCity)
	const groups = new Map<string, StoreWithChainName[]>();
	for (const store of stores) {
		if (store.displayNameManual) continue;

		const normalizedCity = store.city
			? normalizeForGrouping(store.city)
			: "__no_city__";
		const key = `${store.chainSlug}::${normalizedCity}`;
		const group = groups.get(key);
		if (group) {
			group.push(store);
		} else {
			groups.set(key, [store]);
		}
	}

	for (const group of groups.values()) {
		if (group.length === 1) {
			// No collision — simple name
			result.set(group[0].id, generateDisplayName(group[0], false));
			continue;
		}

		// Multiple stores in same chain+city — need disambiguation
		// First pass: try street-level disambiguation
		const streetNames = new Map<string, StoreWithChainName[]>();
		for (const store of group) {
			const street = store.address ? extractStreet(store.address) : null;
			const streetKey = street ? normalizeForGrouping(street) : "__no_street__";
			const existing = streetNames.get(streetKey);
			if (existing) {
				existing.push(store);
			} else {
				streetNames.set(streetKey, [store]);
			}
		}

		for (const [streetKey, streetGroup] of streetNames) {
			if (streetGroup.length === 1 && streetKey !== "__no_street__") {
				// Unique street — street-level name is sufficient
				result.set(
					streetGroup[0].id,
					generateDisplayName(streetGroup[0], true),
				);
			} else {
				// Still colliding or no street — use full disambiguation
				for (const store of streetGroup) {
					const name = generateFullyDisambiguatedName(store);
					result.set(store.id, name);
				}
			}
		}
	}

	return result;
}

/**
 * Generate a fully disambiguated name using all available information.
 */
function generateFullyDisambiguatedName(store: StoreWithChainName): string {
	const { chainName, city, address, postalCode, id } = store;

	if (!city?.trim()) {
		return store.name;
	}

	const parts = [chainName, city.trim()];

	const street = address ? extractStreet(address) : null;
	const houseNumber = address ? extractHouseNumber(address) : null;

	if (street) {
		parts.push(street);
		if (houseNumber) {
			// Replace street-only with full address
			parts.pop();
			parts.push(address!.trim());
		}
	} else if (postalCode?.trim()) {
		parts.push(`(${postalCode.trim()})`);
	} else {
		parts.push(`#${id.slice(-4)}`);
	}

	return parts.join(", ").replace(/,\s*,/g, ",");
}

/**
 * CHAIN_NAME_FALLBACK: hardcoded fallback map for chain names.
 * Used only when chain name is not available from the DB join.
 */
const CHAIN_NAME_FALLBACK: Record<string, string> = {
	konzum: "Konzum",
	lidl: "Lidl",
	plodine: "Plodine",
	kaufland: "Kaufland",
	spar: "Spar",
	interspar: "Interspar",
	studenac: "Studenac",
	eurospin: "Eurospin",
	tommy: "Tommy",
	ktc: "KTC",
	dm: "DM",
	metro: "Metro",
	trgocentar: "Trgocentar",
};

/**
 * Resolve chain name from DB value or fallback map.
 */
export function resolveChainName(
	chainSlug: string,
	dbChainName?: string | null,
): string {
	if (dbChainName?.trim()) return dbChainName.trim();
	return CHAIN_NAME_FALLBACK[chainSlug] ?? chainSlug.toUpperCase();
}
