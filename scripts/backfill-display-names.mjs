/**
 * Backfill Display Names Script (ESM module for production)
 *
 * Generates display names for all stores where displayNameManual = false.
 */
import postgres from "postgres";
import { sql } from "drizzle-orm";

const CHAIN_NAME_FALLBACK = {
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

function normalizeForGrouping(value) {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim()
		.replace(/\s+/g, " ");
}

function extractStreet(address) {
	const trimmed = address.trim();
	if (!trimmed) return null;
	const match = trimmed.match(/^(.+?)\s+\d+[a-zA-Z]?\s*$/);
	if (match) return match[1].trim();
	return trimmed;
}

function extractHouseNumber(address) {
	const match = address.trim().match(/\s+(\d+[a-zA-Z]?)\s*$/);
	return match ? match[1] : null;
}

function generateDisplayName(store, needsDisambiguation) {
	const { chainName, city, address, postalCode, id } = store;

	if (!city?.trim()) {
		return store.name;
	}

	const base = `${chainName} ${city.trim()}`;

	if (!needsDisambiguation) {
		return base;
	}

	const street = address ? extractStreet(address) : null;
	if (street) {
		const withStreet = `${base}, ${street}`;
		return withStreet;
	}

	const houseNumber = address ? extractHouseNumber(address) : null;
	if (houseNumber) {
		return `${base} ${houseNumber}`;
	}
	if (postalCode?.trim()) {
		return `${base} (${postalCode.trim()})`;
	}

	const idSuffix = id.slice(-4);
	return `${base} #${idSuffix}`;
}

function generateFullyDisambiguatedName(store) {
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
			parts.pop();
			parts.push((address ?? '').trim());
		}
	} else if (postalCode && postalCode.trim()) {
		parts.push(`(${postalCode.trim()})`);
	} else {
		parts.push(`#${id.slice(-4)}`);
	}

	return parts.join(", ").replace(/,\s*,/g, ",");
}

function resolveChainName(chainSlug, dbChainName) {
	if (dbChainName?.trim()) return dbChainName.trim();
	return CHAIN_NAME_FALLBACK[chainSlug] ?? chainSlug.toUpperCase();
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
		// Fetch all stores with chain names
		const storesResult = await sqlInstance.unsafe(
			`SELECT s.id, s.chain_slug, s.name, s.address, s.city, s.postal_code, s.display_name, s.display_name_manual, c.name as chain_name
			 FROM stores s
			 INNER JOIN chains c ON s.chain_slug = c.slug
			 WHERE s.display_name_manual = false OR s.display_name_manual IS NULL`
		);

		console.log(`Fetched ${storesResult.length} stores.`);

		// Group by (chainSlug, normalizedCity) for disambiguation
		const groups = new Map();
		for (const store of storesResult) {
			const normalizedCity = store.city ? normalizeForGrouping(store.city) : "__no_city__";
			const key = `${store.chain_slug}::${normalizedCity}`;
			const group = groups.get(key) || [];
			group.push(store);
			groups.set(key, group);
		}

		// Generate display names
		const nameMap = new Map();
		for (const [key, group] of groups) {
			if (group.length === 1) {
				const store = group[0];
				const chainName = resolveChainName(store.chain_slug, store.chain_name);
				nameMap.set(store.id, generateDisplayName(store, false));
			} else {
				// Multiple stores - need disambiguation
				const streetNames = new Map();
				for (const store of group) {
					const chainName = resolveChainName(store.chain_slug, store.chain_name);
					const street = store.address ? extractStreet(store.address) : null;
					const streetKey = street ? normalizeForGrouping(street) : "__no_street__";
					const existing = streetNames.get(streetKey) || [];
					existing.push(store);
					streetNames.set(streetKey, existing);
				}

				for (const [streetKey, streetGroup] of streetNames) {
					if (streetGroup.length === 1 && streetKey !== "__no_street__") {
						const store = streetGroup[0];
						const chainName = resolveChainName(store.chain_slug, store.chain_name);
						nameMap.set(store.id, generateDisplayName(store, true));
					} else {
						for (const store of streetGroup) {
							const chainName = resolveChainName(store.chain_slug, store.chain_name);
							nameMap.set(store.id, generateFullyDisambiguatedName(store));
						}
					}
				}
			}
		}

		// Find changes
		const updates = [];
		for (const store of storesResult) {
			const newName = nameMap.get(store.id);
			if (newName && store.display_name !== newName) {
				updates.push({ id: store.id, oldName: store.display_name, newName });
			}
		}

		console.log(`Changes needed: ${updates.length}`);
		console.log(`Skipped (manual): ${storesResult.length - nameMap.size}`);

		if (updates.length === 0) {
			console.log("Nothing to update.");
			return;
		}

		// Preview changes
		const previewCount = Math.min(updates.length, 20);
		console.log(`Preview (first ${previewCount}):`);
		for (const update of updates.slice(0, previewCount)) {
			console.log(`  ${update.id}: "${update.oldName ?? "(null)"}" → "${update.newName}"`);
		}
		if (updates.length > previewCount) {
			console.log(`  ... and ${updates.length - previewCount} more`);
		}

		// Write in batches
		const BATCH_SIZE = 500;
		let written = 0;
		for (let i = 0; i < updates.length; i += BATCH_SIZE) {
			const batch = updates.slice(i, i + BATCH_SIZE);
			const values = batch.map((u, idx) => {
				const num = i + idx + 1;
				return `('${u.id}', '$${num * 1000 + written}')`;
			}).join(', ');

			await sqlInstance.unsafe(
				`UPDATE stores AS s
				 SET display_name = src.display_name, updated_at = NOW()
				 FROM (VALUES ${values}) AS src(id, display_name)
				 WHERE s.id = src.id`
			);

			written += batch.length;
			if (written % 1000 === 0 || written === updates.length) {
				console.log(`  Written ${written}/${updates.length}`);
			}
		}

		console.log(`\nDone. Updated ${written} stores.`);
	} finally {
		await sqlInstance.end();
	}
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
