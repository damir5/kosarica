/**
 * Update All Display Names + Batch Geocode Script
 *
 * This script:
 * 1. Updates display names for ALL stores (not just geocoded ones)
 * 2. Geocodes all stores missing latitude/longitude
 * 3. Auto-approves high-confidence results
 *
 * Usage:
 *   pnpm tsx scripts/update-display-names-and-geocode.ts [--dry-run]
 *
 * Flags:
 *   --dry-run   Print what would be done without writing
 */

import { sql, eq } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/db";
import { chains, stores } from "@/db/schema";
import {
	generateDisplayNames,
	resolveChainName,
} from "@/lib/store-names";
import { geocodeAddress, type GeocodingResult } from "@/lib/geocoding";
import { createLogger } from "@/utils/logger";

const log = createLogger("app");
const BASELINE_DELAY_MS = 1500;

interface CliFlags {
	dryRun: boolean;
}

interface Stats {
	displayNamesUpdated: number;
	processed: number;
	geocodedHigh: number;
	geocodedMedium: number;
	skippedLow: number;
	skippedNoData: number;
	errors: number;
	coordsWritten: number;
	addressFieldsWritten: number;
}

function parseFlags(): CliFlags {
	const args = process.argv.slice(2);
	const flags: CliFlags = { dryRun: false };

	for (const arg of args) {
		if (arg === "--dry-run") {
			flags.dryRun = true;
		}
	}

	return flags;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Update display names for ALL stores in the database.
 * This runs before geocoding to ensure all stores have proper names.
 */
async function updateAllDisplayNames(dryRun: boolean): Promise<number> {
	const db = getDatabase();

	// Fetch ALL stores with chain names (not just affected ones)
	const allStores = await db
		.select({
			id: stores.id,
			chainSlug: stores.chainSlug,
			name: stores.name,
			address: stores.address,
			city: stores.city,
			postalCode: stores.postalCode,
			displayNameManual: stores.displayNameManual,
			chainName: chains.name,
		})
		.from(stores)
		.innerJoin(chains, eq(stores.chainSlug, chains.slug))
		.where(
			sql`${stores.displayNameManual} = false OR ${stores.displayNameManual} IS NULL`,
		);

	if (allStores.length === 0) {
		console.log("No stores need display name updates.");
		return 0;
	}

	const storesForNaming = allStores.map((s) => ({
		id: s.id,
		chainSlug: s.chainSlug,
		name: s.name,
		address: s.address,
		city: s.city,
		postalCode: s.postalCode,
		displayNameManual: s.displayNameManual,
		chainName: resolveChainName(s.chainSlug, s.chainName),
	}));

	const nameMap = generateDisplayNames(storesForNaming);
	const updates = Array.from(nameMap.entries());

	if (dryRun) {
		console.log(`[DRY RUN] Would update ${updates.length} display names.`);
		for (const [id, name] of updates.slice(0, 5)) {
			console.log(`  ${id} -> "${name}"`);
		}
		if (updates.length > 5) {
			console.log(`  ... and ${updates.length - 5} more`);
		}
		return updates.length;
	}

	// Batch update in chunks of 500
	const BATCH_SIZE = 500;
	let written = 0;
	for (let i = 0; i < updates.length; i += BATCH_SIZE) {
		const batch = updates.slice(i, i + BATCH_SIZE);
		const values = sql.join(
			batch.map(([id, name]) => sql`(${id}, ${name})`),
			sql`, `,
		);

		await db.execute(sql`
			UPDATE stores AS s
			SET display_name = src.display_name,
				updated_at = NOW()
			FROM (VALUES ${values}) AS src(id, display_name)
			WHERE s.id = src.id
		`);

		written += batch.length;
	}

	console.log(`Updated ${written} display names.`);
	return written;
}

async function main() {
	const flags = parseFlags();
	const db = getDatabase();

	console.log("=== Update Display Names + Batch Geocode ===");
	console.log(`  dry-run: ${flags.dryRun}`);
	console.log("");

	// STEP 1: Update all display names first
	console.log("Step 1: Updating display names for all stores...");
	const displayNamesUpdated = await updateAllDisplayNames(flags.dryRun);
	console.log("");

	// STEP 2: Geocode stores missing coordinates
	console.log("Step 2: Geocoding stores missing coordinates...");

	// Query stores missing coordinates
	const storesToGeocode = await db
		.select({
			id: stores.id,
			chainSlug: stores.chainSlug,
			name: stores.name,
			address: stores.address,
			city: stores.city,
			postalCode: stores.postalCode,
		})
		.from(stores)
		.where(sql`${stores.latitude} IS NULL OR ${stores.longitude} IS NULL`)
		.orderBy(stores.id);

	console.log(`Found ${storesToGeocode.length} stores missing coordinates.`);

	if (storesToGeocode.length === 0) {
		console.log("No stores to geocode.");
		return;
	}

	const stats: Stats = {
		displayNamesUpdated,
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

	for (const store of storesToGeocode) {
		stats.processed += 1;

		// Check if store has any geocodable data
		if (!store.city && !store.address) {
			stats.skippedNoData += 1;
			if (stats.processed % 50 === 0) {
				printProgress(stats, storesToGeocode.length);
			}
			continue;
		}

		const outcome = await geocodeAddress({
			address: store.address,
			city: store.city,
			postalCode: store.postalCode,
			country: "hr",
		});

		if (outcome.isErr()) {
			stats.errors += 1;
			consecutiveFailures += 1;
			console.error(`  [ERROR] ${store.id}: ${outcome.error.message}`);

			// Exponential backoff on repeated failures
			if (consecutiveFailures >= 3) {
				console.log("  Pausing 30s due to repeated failures...");
				await sleep(30_000);
			}

			await sleep(BASELINE_DELAY_MS);
			continue;
		}

		consecutiveFailures = 0;
		const result: GeocodingResult = outcome.value;

		if (!result.found) {
			stats.skippedLow += 1;
			await sleep(BASELINE_DELAY_MS);
			continue;
		}

		const { confidence, cityMatch } = result;
		const hasInputCity = Boolean(store.city?.trim());

		if (confidence === "high") {
			stats.geocodedHigh += 1;

			if (!flags.dryRun) {
				const updateData: Record<string, unknown> = {
					updatedAt: new Date(),
				};

				if (result.latitude && result.longitude) {
					updateData.latitude = result.latitude;
					updateData.longitude = result.longitude;
					stats.coordsWritten += 1;
				}
				if (result.city && !store.city) {
					updateData.city = result.city;
					stats.addressFieldsWritten += 1;
				}
				if (result.street && !store.address) {
					const addr = result.houseNumber
						? `${result.street} ${result.houseNumber}`
						: result.street;
					updateData.address = addr;
					stats.addressFieldsWritten += 1;
				}
				if (result.postcode && !store.postalCode) {
					updateData.postalCode = result.postcode;
					stats.addressFieldsWritten += 1;
				}

				await db
					.update(stores)
					.set(updateData as Partial<typeof stores.$inferInsert>)
					.where(eq(stores.id, store.id));
			}

			console.log(`  [HIGH] ${store.id}: ${result.displayName}`);
		} else if (confidence === "medium") {
			stats.geocodedMedium += 1;

			// Medium confidence: write city/address only if cityMatch + input city exists
			if (!flags.dryRun && cityMatch && hasInputCity) {
				const updateData: Record<string, unknown> = {
					updatedAt: new Date(),
				};

				if (result.street && !store.address) {
					const addr = result.houseNumber
						? `${result.street} ${result.houseNumber}`
						: result.street;
					updateData.address = addr;
					stats.addressFieldsWritten += 1;
				}
				if (result.postcode && !store.postalCode) {
					updateData.postalCode = result.postcode;
					stats.addressFieldsWritten += 1;
				}

				if (Object.keys(updateData).length > 1) {
					await db
						.update(stores)
						.set(updateData as Partial<typeof stores.$inferInsert>)
						.where(eq(stores.id, store.id));
				}
			}

			console.log(`  [MED]  ${store.id}: ${result.displayName} (cityMatch=${cityMatch})`);
		} else {
			stats.skippedLow += 1;
			console.log(`  [LOW]  ${store.id}: skipped (needs manual review)`);
		}

		if (stats.processed % 50 === 0) {
			printProgress(stats, storesToGeocode.length);
		}

		await sleep(BASELINE_DELAY_MS);
	}

	console.log("\n=== Summary ===");
	console.log(`  Display names updated: ${stats.displayNamesUpdated}`);
	console.log(`  Processed:           ${stats.processed}`);
	console.log(`  Geocoded (high):     ${stats.geocodedHigh} (auto-approved)`);
	console.log(`  Geocoded (med):      ${stats.geocodedMedium}`);
	console.log(`  Skipped (low):       ${stats.skippedLow} (needs review)`);
	console.log(`  Skipped (no data):    ${stats.skippedNoData}`);
	console.log(`  Errors:              ${stats.errors}`);
	console.log(`  Coords written:       ${stats.coordsWritten}`);
	console.log(`  Address fields:       ${stats.addressFieldsWritten}`);
}

function printProgress(stats: Stats, total: number) {
	const pct = ((stats.processed / total) * 100).toFixed(1);
	console.log(
		`  Progress: ${stats.processed}/${total} (${pct}%) | ` +
		`high=${stats.geocodedHigh} med=${stats.geocodedMedium} ` +
		`low=${stats.skippedLow} err=${stats.errors}`,
	);
}

main()
	.catch((err) => {
		log.error("Update display names + geocode failed", { error: err });
		console.error("Fatal:", err);
		process.exitCode = 1;
	})
	.finally(() => {
		closeDatabase();
	});
