/**
 * Backfill Display Names Script
 *
 * Generates display names for all stores where displayNameManual = false.
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-display-names.ts [--dry-run] [--chain=konzum] [--force]
 *
 * Flags:
 *   --dry-run   Print what would be updated without writing
 *   --chain=X   Only process stores for chain X
 *   --force     Overwrite manual display names too
 */

import { and, eq, sql } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/db";
import { chains, stores } from "@/db/schema";
import {
	generateDisplayNames,
	resolveChainName,
} from "@/lib/store-names";
import { createLogger } from "@/utils/logger";

const log = createLogger("app");

interface CliFlags {
	dryRun: boolean;
	chain: string | null;
	force: boolean;
}

function parseFlags(): CliFlags {
	const args = process.argv.slice(2);
	const flags: CliFlags = { dryRun: false, chain: null, force: false };

	for (const arg of args) {
		if (arg === "--dry-run") {
			flags.dryRun = true;
		} else if (arg.startsWith("--chain=")) {
			flags.chain = arg.slice("--chain=".length);
		} else if (arg === "--force") {
			flags.force = true;
		}
	}

	return flags;
}

async function main() {
	const flags = parseFlags();
	const db = getDatabase();

	console.log("=== Backfill Display Names ===");
	console.log(`  dry-run: ${flags.dryRun}`);
	console.log(`  chain:   ${flags.chain ?? "all"}`);
	console.log(`  force:   ${flags.force}`);
	console.log("");

	// Build conditions
	const conditions = [];
	if (flags.chain) {
		conditions.push(eq(stores.chainSlug, flags.chain));
	}

	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	// Fetch all stores with chain names
	const allStores = await db
		.select({
			id: stores.id,
			chainSlug: stores.chainSlug,
			name: stores.name,
			address: stores.address,
			city: stores.city,
			postalCode: stores.postalCode,
			displayName: stores.displayName,
			displayNameManual: stores.displayNameManual,
			chainName: chains.name,
		})
		.from(stores)
		.innerJoin(chains, eq(stores.chainSlug, chains.slug))
		.where(whereClause);

	console.log(`Fetched ${allStores.length} stores total.`);

	// Prepare stores for naming (respect manual flag unless --force)
	const storesForNaming = allStores.map((s) => ({
		id: s.id,
		chainSlug: s.chainSlug,
		name: s.name,
		address: s.address,
		city: s.city,
		postalCode: s.postalCode,
		displayNameManual: flags.force ? false : s.displayNameManual,
		chainName: resolveChainName(s.chainSlug, s.chainName),
	}));

	const nameMap = generateDisplayNames(storesForNaming);

	// Compute changes
	const updates: Array<{ id: string; oldName: string | null; newName: string }> = [];
	for (const store of allStores) {
		const newName = nameMap.get(store.id);
		if (!newName) continue; // manual store or not in naming set

		if (store.displayName !== newName) {
			updates.push({
				id: store.id,
				oldName: store.displayName,
				newName,
			});
		}
	}

	console.log(`Changes needed: ${updates.length}`);
	console.log(`Skipped (manual): ${allStores.length - nameMap.size}`);
	console.log("");

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
	console.log("");

	if (flags.dryRun) {
		console.log("Dry run — no changes written.");
		return;
	}

	// Write in batches of 500
	const BATCH_SIZE = 500;
	let written = 0;
	for (let i = 0; i < updates.length; i += BATCH_SIZE) {
		const batch = updates.slice(i, i + BATCH_SIZE);
		const values = sql.join(
			batch.map(
				(u) => sql`(${u.id}, ${u.newName})`,
			),
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
		if (written % 1000 === 0 || written === updates.length) {
			console.log(`  Written ${written}/${updates.length}`);
		}
	}

	console.log(`\nDone. Updated ${written} stores.`);
}

main()
	.catch((err) => {
		log.error("Backfill failed", { error: err });
		console.error("Fatal:", err);
		process.exitCode = 1;
	})
	.finally(() => {
		closeDatabase();
	});
