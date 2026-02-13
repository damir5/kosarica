/**
 * Batch Geocode Stores Script
 *
 * Geocodes stores missing latitude/longitude using Photon (komoot).
 * Confidence-gated writes: only writes high-confidence coords, medium-confidence
 * city/address data when input city matches.
 *
 * Usage:
 *   pnpm tsx scripts/batch-geocode-stores.ts [--dry-run] [--chain=konzum] [--limit=50] [--resume]
 *
 * Flags:
 *   --dry-run   Print what would be geocoded without writing
 *   --chain=X   Only process stores for chain X
 *   --limit=N   Process at most N stores
 *   --resume    Resume from last saved progress
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/db";
import { chains, stores } from "@/db/schema";
import { geocodeAddress, type GeocodingResult } from "@/lib/geocoding";
import {
	generateDisplayNames,
	resolveChainName,
} from "@/lib/store-names";
import { createLogger } from "@/utils/logger";

const log = createLogger("app");
const PROGRESS_FILE = "/tmp/kosarica-geocode-progress.json";
const BASELINE_DELAY_MS = 1500;

interface CliFlags {
	dryRun: boolean;
	chain: string | null;
	limit: number;
	resume: boolean;
}

interface ProgressState {
	lastProcessedId: string | null;
	processed: number;
	geocoded: number;
	skipped: number;
}

interface Stats {
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
	const flags: CliFlags = { dryRun: false, chain: null, limit: 0, resume: false };

	for (const arg of args) {
		if (arg === "--dry-run") {
			flags.dryRun = true;
		} else if (arg.startsWith("--chain=")) {
			flags.chain = arg.slice("--chain=".length);
		} else if (arg.startsWith("--limit=")) {
			flags.limit = Number.parseInt(arg.slice("--limit=".length), 10);
		} else if (arg === "--resume") {
			flags.resume = true;
		}
	}

	return flags;
}

function loadProgress(): ProgressState | null {
	if (!existsSync(PROGRESS_FILE)) return null;
	try {
		return JSON.parse(readFileSync(PROGRESS_FILE, "utf-8")) as ProgressState;
	} catch {
		return null;
	}
}

function saveProgress(state: ProgressState): void {
	writeFileSync(PROGRESS_FILE, JSON.stringify(state, null, 2));
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	const flags = parseFlags();
	const db = getDatabase();

	console.log("=== Batch Geocode Stores ===");
	console.log(`  dry-run: ${flags.dryRun}`);
	console.log(`  chain:   ${flags.chain ?? "all"}`);
	console.log(`  limit:   ${flags.limit || "none"}`);
	console.log(`  resume:  ${flags.resume}`);
	console.log("");

	let resumeFromId: string | null = null;
	if (flags.resume) {
		const prev = loadProgress();
		if (prev?.lastProcessedId) {
			resumeFromId = prev.lastProcessedId;
			console.log(`Resuming from store ID: ${resumeFromId}`);
		}
	}

	// Query stores missing coordinates
	const conditions = [
		sql`(${stores.latitude} IS NULL OR ${stores.longitude} IS NULL)`,
	];
	if (flags.chain) {
		conditions.push(eq(stores.chainSlug, flags.chain));
	}

	const allStores = await db
		.select({
			id: stores.id,
			chainSlug: stores.chainSlug,
			name: stores.name,
			address: stores.address,
			city: stores.city,
			postalCode: stores.postalCode,
		})
		.from(stores)
		.where(and(...conditions))
		.orderBy(stores.id);

	// If resuming, skip past the last processed ID
	let storesToProcess = allStores;
	if (resumeFromId) {
		const idx = storesToProcess.findIndex((s) => s.id === resumeFromId);
		if (idx >= 0) {
			storesToProcess = storesToProcess.slice(idx + 1);
		}
	}

	if (flags.limit > 0) {
		storesToProcess = storesToProcess.slice(0, flags.limit);
	}

	console.log(`Found ${allStores.length} stores missing coordinates.`);
	console.log(`Processing ${storesToProcess.length} stores.\n`);

	if (storesToProcess.length === 0) {
		console.log("Nothing to geocode.");
		return;
	}

	const stats: Stats = {
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
	const affectedStoreIds: string[] = [];

	for (const store of storesToProcess) {
		stats.processed += 1;

		// Check if store has any geocodable data
		if (!store.city && !store.address) {
			stats.skippedNoData += 1;
			if (stats.processed % 50 === 0) {
				printProgress(stats, storesToProcess.length);
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

			// Save progress for resumability
			saveProgress({
				lastProcessedId: store.id,
				processed: stats.processed,
				geocoded: stats.geocodedHigh + stats.geocodedMedium,
				skipped: stats.skippedLow + stats.skippedNoData,
			});

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
				affectedStoreIds.push(store.id);
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
					affectedStoreIds.push(store.id);
				}
			}

			console.log(`  [MED]  ${store.id}: ${result.displayName} (cityMatch=${cityMatch})`);
		} else {
			stats.skippedLow += 1;
			console.log(`  [LOW]  ${store.id}: skipped`);
		}

		// Save progress for resumability
		if (stats.processed % 10 === 0) {
			saveProgress({
				lastProcessedId: store.id,
				processed: stats.processed,
				geocoded: stats.geocodedHigh + stats.geocodedMedium,
				skipped: stats.skippedLow + stats.skippedNoData,
			});
		}

		if (stats.processed % 50 === 0) {
			printProgress(stats, storesToProcess.length);
		}

		await sleep(BASELINE_DELAY_MS);
	}

	// Regenerate display names for affected stores
	if (affectedStoreIds.length > 0 && !flags.dryRun) {
		console.log(`\nRegenerating display names for ${affectedStoreIds.length} affected stores...`);
		await regenerateDisplayNames(affectedStoreIds);
	}

	console.log("\n=== Summary ===");
	console.log(`  Processed:        ${stats.processed}`);
	console.log(`  Geocoded (high):  ${stats.geocodedHigh}`);
	console.log(`  Geocoded (med):   ${stats.geocodedMedium}`);
	console.log(`  Skipped (low):    ${stats.skippedLow}`);
	console.log(`  Skipped (no data):${stats.skippedNoData}`);
	console.log(`  Errors:           ${stats.errors}`);
	console.log(`  Coords written:   ${stats.coordsWritten}`);
	console.log(`  Address fields:   ${stats.addressFieldsWritten}`);
}

function printProgress(stats: Stats, total: number) {
	const pct = ((stats.processed / total) * 100).toFixed(1);
	console.log(
		`  Progress: ${stats.processed}/${total} (${pct}%) | ` +
		`high=${stats.geocodedHigh} med=${stats.geocodedMedium} ` +
		`low=${stats.skippedLow} err=${stats.errors}`,
	);
}

async function regenerateDisplayNames(_affectedIds: string[]) {
	const db = getDatabase();

	// Fetch all non-manual stores with chain names
	const affectedStores = await db
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

	const storesForNaming = affectedStores.map((s) => ({
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

	if (updates.length === 0) {
		console.log("  No display names to update.");
		return;
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

	console.log(`  Updated ${written} display names.`);
}

main()
	.catch((err) => {
		log.error("Batch geocode failed", { error: err });
		console.error("Fatal:", err);
		process.exitCode = 1;
	})
	.finally(() => {
		closeDatabase();
	});
