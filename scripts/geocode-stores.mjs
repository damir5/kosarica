/**
 * Batch Geocode Script (ESM module for production)
 *
 * Geocodes stores missing latitude/longitude using Photon (komoot).
 * Auto-approves high-confidence results.
 */
import postgres from "postgres";

const PHOTON_BASE_URL = "https://photon.komoot.io/api";
const USER_AGENT = "Kosarica/1.0 (contact@kosarica.hr)";
const BASELINE_DELAY_MS = 1500;

function normalizeLocationPart(value) {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim()
		.replace(/\s+/g, " ");
}

function calculatePhotonConfidence(props, input) {
	const osm_type = props.osm_type;
	const osm_value = props.osm_value;
	const hasInputCity = Boolean(input.city && input.city.trim());

	if (
		osm_type === "N" &&
		["house", "building"].includes(osm_value || "") &&
		(hasInputCity ? citiesMatch(props, input) : true)
	) {
		return "high";
	}

	const cityMatches = citiesMatch(props, input);
	const hasStreet = Boolean(props.street && props.street.trim());
	const isStreetLevel = ["street", "road", "shop", "amenity"].includes(osm_value || "");

	if ((hasStreet || isStreetLevel) && (cityMatches || !hasInputCity)) {
		return "medium";
	}

	if (cityMatches) {
		return "low";
	}

	return "low";
}

function citiesMatch(props, input) {
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

async function geocodeAddress(store) {
	const { address, city, postalCode } = store;

	const addressParts = [address, city, postalCode].filter(Boolean);
	const fullAddress = addressParts.join(", ");

	if (!fullAddress.trim()) {
		return { found: false, confidence: "low" };
	}

	const url = new URL(PHOTON_BASE_URL);
	url.searchParams.set("q", fullAddress);
	url.searchParams.set("limit", "1");
	url.searchParams.set("lang", "en");
	url.searchParams.set("lat", "45.1");
	url.searchParams.set("lon", "15.2");

	const response = await fetch(url.toString(), {
		headers: {
			Accept: "application/json",
			"User-Agent": USER_AGENT,
		},
	});

	if (!response.ok) {
		return { found: false, confidence: "low", error: `${response.status} ${response.statusText}` };
	}

	const data = await response.json();

	if (!data.features || data.features.length === 0) {
		return { found: false, confidence: "low" };
	}

	const result = data.features[0];
	const [lon, lat] = result.geometry.coordinates;
	const props = result.properties;
	const confidence = calculatePhotonConfidence(props, { address, city });
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
		street: props.street || undefined,
		houseNumber: props.housenumber || undefined,
		city: resultCity || undefined,
		postcode: props.postcode || undefined,
		cityMatch: citiesMatch(props, { address, city }),
	};
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	const DATABASE_URL = process.env.DATABASE_URL;
	if (!DATABASE_URL) {
		console.error("DATABASE_URL environment variable is required");
		process.exit(1);
	}

	const sqlInstance = postgres(DATABASE_URL, {
		max: 10,
		idle_timeout: 20,
		connect_timeout: 10,
	});

	try {
		console.log("=== Batch Geocode Stores ===");

		// Query stores missing coordinates
		const storesResult = await sqlInstance.unsafe(
			`SELECT id, chain_slug, name, address, city, postal_code
			 FROM stores
			 WHERE latitude IS NULL OR longitude IS NULL
			 ORDER BY id`
		);

		console.log(`Found ${storesResult.length} stores missing coordinates.`);

		if (storesResult.length === 0) {
			console.log("No stores to geocode.");
			return;
		}

		const stats = {
			processed: 0,
			geocodedHigh: 0,
			geocodedMedium: 0,
			skippedLow: 0,
			skippedNoData: 0,
			errors: 0,
			coordsWritten: 0,
			addressFieldsWritten: 0,
		};

		let consecutiveFailures = 0;

		for (const store of storesResult) {
			stats.processed += 1;

			if (!store.city && !store.address) {
				stats.skippedNoData += 1;
				if (stats.processed % 50 === 0) {
					printProgress(stats, storesResult.length);
				}
				continue;
			}

			const result = await geocodeAddress(store);

			if (result.error) {
				stats.errors += 1;
				consecutiveFailures += 1;
				console.error(`  [ERROR] ${store.id}: ${result.error}`);

				if (consecutiveFailures >= 3) {
					console.log("  Pausing 30s due to repeated failures...");
					await sleep(30000);
				}

				await sleep(BASELINE_DELAY_MS);
				continue;
			}

			consecutiveFailures = 0;

			if (!result.found) {
				stats.skippedLow += 1;
				await sleep(BASELINE_DELAY_MS);
				continue;
			}

			const { confidence, cityMatch } = result;
			const hasInputCity = Boolean(store.city && store.city.trim());

			if (confidence === "high") {
				stats.geocodedHigh += 1;

				const updates = [];
				const values = [];

				if (result.latitude && result.longitude) {
					updates.push("latitude");
					values.push(result.latitude);
					stats.coordsWritten += 1;
				}
				if (result.city && !store.city) {
					updates.push("city");
					values.push(result.city);
					stats.addressFieldsWritten += 1;
				}
				if (result.street && !store.address) {
					const addr = result.houseNumber
						? `${result.street} ${result.houseNumber}`
						: result.street;
					updates.push("address");
					values.push(addr);
					stats.addressFieldsWritten += 1;
				}
				if (result.postcode && !store.postal_code) {
					updates.push("postal_code");
					values.push(result.postcode);
					stats.addressFieldsWritten += 1;
				}

				if (values.length > 0) {
					updates.push("updated_at");
					values.push(new Date().toISOString().slice(0, 19).replace('T', ' '));

					const setParts = updates.map((f, i) => `"${f}" = $${i + 1 + 1}`).join(", ");
					const valuesParts = values.map((v, i) => {
						const num = i + 1;
						if (typeof v === "string") {
							return `'${v.replace(/'/g, "''")}'`;
						}
						return `$${num} = ${v}`;
					}).join(", ");

					await sqlInstance.unsafe(
						`UPDATE stores SET ${setParts}, updated_at = $${values.length + 1} WHERE id = '${store.id}'`
					);
				}

				console.log(`  [HIGH] ${store.id}: ${result.displayName}`);
			} else if (confidence === "medium") {
				stats.geocodedMedium += 1;

				if (cityMatch && hasInputCity) {
					const updates = [];
					const values = [];

					if (result.street && !store.address) {
						const addr = result.houseNumber
							? `${result.street} ${result.houseNumber}`
							: result.street;
						updates.push("address");
						values.push(addr);
						stats.addressFieldsWritten += 1;
					}
					if (result.postcode && !store.postal_code) {
						updates.push("postal_code");
						values.push(result.postcode);
						stats.addressFieldsWritten += 1;
					}

					if (values.length > 0) {
						updates.push("updated_at");
						values.push(new Date().toISOString().slice(0, 19).replace('T', ' '));

						const setParts = updates.map((f, i) => `"${f}" = $${i + 1 + 1}`).join(", ");
						const valuesParts = values.map((v, i) => {
							const num = i + 1;
							if (typeof v === "string") {
								return `'${v.replace(/'/g, "''")}'`;
							}
							return `$${num} = ${v}`;
						}).join(", ");

						await sqlInstance.unsafe(
							`UPDATE stores SET ${setParts}, updated_at = $${values.length + 1} WHERE id = '${store.id}'`
						);
					}
				}

				console.log(`  [MED] ${store.id}: ${result.displayName} (cityMatch=${cityMatch})`);
			} else {
				stats.skippedLow += 1;
				console.log(`  [LOW] ${store.id}: skipped (needs manual review)`);
			}

			if (stats.processed % 50 === 0) {
				printProgress(stats, storesResult.length);
			}

			await sleep(BASELINE_DELAY_MS);
		}

		console.log("\n=== Summary ===");
		console.log(`  Processed:           ${stats.processed}`);
		console.log(`  Geocoded (high):     ${stats.geocodedHigh} (auto-approved)`);
		console.log(`  Geocoded (med):      ${stats.geocodedMedium}`);
		console.log(`  Skipped (low):       ${stats.skippedLow} (needs review)`);
		console.log(`  Skipped (no data):    ${stats.skippedNoData}`);
		console.log(`  Errors:              ${stats.errors}`);
		console.log(`  Coords written:       ${stats.coordsWritten}`);
		console.log(`  Address fields:       ${stats.addressFieldsWritten}`);
	} finally {
		await sqlInstance.end();
	}
}

function printProgress(stats, total) {
	const pct = ((stats.processed / total) * 100).toFixed(1);
	console.log(
		`  Progress: ${stats.processed}/${total} (${pct}%) | ` +
		`high=${stats.geocodedHigh} med=${stats.geocodedMedium} ` +
		`low=${stats.skippedLow} err=${stats.errors}`,
	);
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
