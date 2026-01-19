#!/usr/bin/env npx tsx

/**
 * Stores CLI Command
 *
 * Manage stores: list, approve, reject, add physical stores, and import from CSV.
 *
 * Usage:
 *   pnpm ingest stores --pending           # List pending stores
 *   pnpm ingest stores --chain=dm          # List all stores for chain
 *   pnpm ingest stores --approve <id>      # Approve a pending store
 *   pnpm ingest stores --reject <id>       # Reject/delete a store
 *   pnpm ingest stores --show <id>         # Show store details
 *
 * Physical store management:
 *   pnpm ingest stores --add --chain=dm --name="DM Zagreb" --price-source=dm_national
 *   pnpm ingest stores --add --chain=dm --name="DM Zagreb" --city="Zagreb" --address="Ilica 123" --lat=45.815 --lng=15.982 --price-source=dm_national
 *   pnpm ingest stores --link <store_id> --price-source=dm_national
 *   pnpm ingest stores --import-csv ./stores.csv --chain=dm --price-source=dm_national
 */

import * as fs from "node:fs";
import * as readline from "node:readline";
import { Command } from "commander";
import { and, count, eq, sql } from "drizzle-orm";

import { createDb, type DatabaseType } from "@/db";
import { chains, storeIdentifiers, storeItemState, stores } from "@/db/schema";
import { generatePrefixedId } from "@/utils/id";
import { CHAIN_IDS, isValidChainId } from "../chains";

// Database instance for CLI
let dbInstance: DatabaseType | null = null;

/**
 * Create a Drizzle database instance for CLI usage.
 * Uses the DATABASE_URL environment variable.
 */
async function createCliDatabase(): Promise<DatabaseType> {
	if (!dbInstance) {
		const databaseUrl = process.env.DATABASE_URL;
		if (!databaseUrl) {
			throw new Error("DATABASE_URL environment variable is required");
		}
		dbInstance = createDb(databaseUrl);
	}
	return dbInstance;
}

/**
 * Format a date for display.
 */
function formatDate(date: Date | null): string {
	if (!date) return "-";
	return date.toISOString().split("T")[0];
}

/**
 * Print a table of stores with pending status.
 */
async function listPendingStores(): Promise<void> {
	const db = await createCliDatabase();

	const pendingStores = await db
		.select({
			id: stores.id,
			chainSlug: stores.chainSlug,
			name: stores.name,
			createdAt: stores.createdAt,
		})
		.from(stores)
		.where(eq(stores.status, "pending"))
		.orderBy(stores.createdAt);

	if (pendingStores.length === 0) {
		console.log("No pending stores found.");
		return;
	}

	// Get identifiers for each store
	const storeIds = pendingStores.map((s) => s.id);
	const identifiers = await db
		.select({
			storeId: storeIdentifiers.storeId,
			type: storeIdentifiers.type,
			value: storeIdentifiers.value,
		})
		.from(storeIdentifiers)
		.where(sql`${storeIdentifiers.storeId} IN ${storeIds}`);

	// Group identifiers by store
	const identifiersByStore = new Map<string, string[]>();
	for (const id of identifiers) {
		if (!identifiersByStore.has(id.storeId)) {
			identifiersByStore.set(id.storeId, []);
		}
		const storeIdList = identifiersByStore.get(id.storeId);
		if (storeIdList) {
			storeIdList.push(`${id.type}:${id.value}`);
		}
	}

	// Print header
	console.log("");
	console.log("Pending Stores:");
	console.log("=".repeat(100));
	console.log(
		`${"ID".padEnd(20)} | ${"Chain".padEnd(12)} | ${"Name".padEnd(30)} | ${"Identifiers".padEnd(20)} | ${"Created".padEnd(10)}`,
	);
	console.log("-".repeat(100));

	// Print rows
	for (const store of pendingStores) {
		const ids = identifiersByStore.get(store.id) || [];
		const idStr = ids.length > 0 ? ids.join(", ") : "-";
		console.log(
			`${store.id.padEnd(20)} | ${(store.chainSlug || "-").padEnd(12)} | ${(store.name || "-").substring(0, 30).padEnd(30)} | ${idStr.substring(0, 20).padEnd(20)} | ${formatDate(store.createdAt).padEnd(10)}`,
		);
	}

	console.log("");
	console.log(`Total: ${pendingStores.length} pending store(s)`);
}

/**
 * Print a table of stores for a specific chain.
 */
async function listStoresByChain(chainSlug: string): Promise<void> {
	const db = await createCliDatabase();

	// Verify chain exists
	const chain = await db.query.chains.findFirst({
		where: eq(chains.slug, chainSlug),
	});

	if (!chain) {
		console.error(`Error: Chain "${chainSlug}" not found.`);
		process.exit(1);
	}

	const chainStores = await db
		.select({
			id: stores.id,
			name: stores.name,
			isVirtual: stores.isVirtual,
			status: stores.status,
			priceSourceStoreId: stores.priceSourceStoreId,
			city: stores.city,
		})
		.from(stores)
		.where(eq(stores.chainSlug, chainSlug))
		.orderBy(stores.name);

	if (chainStores.length === 0) {
		console.log(`No stores found for chain "${chainSlug}".`);
		return;
	}

	// Print header
	console.log("");
	console.log(`Stores for ${chain.name} (${chainSlug}):`);
	console.log("=".repeat(110));
	console.log(
		`${"ID".padEnd(20)} | ${"Name".padEnd(30)} | ${"Virtual".padEnd(8)} | ${"Status".padEnd(10)} | ${"Price Source".padEnd(20)} | ${"City".padEnd(15)}`,
	);
	console.log("-".repeat(110));

	// Print rows
	for (const store of chainStores) {
		const virtual = store.isVirtual ? "Yes" : "No";
		const priceSource = store.priceSourceStoreId || "-";
		console.log(
			`${store.id.padEnd(20)} | ${(store.name || "-").substring(0, 30).padEnd(30)} | ${virtual.padEnd(8)} | ${(store.status || "-").padEnd(10)} | ${priceSource.substring(0, 20).padEnd(20)} | ${(store.city || "-").substring(0, 15).padEnd(15)}`,
		);
	}

	console.log("");
	console.log(`Total: ${chainStores.length} store(s)`);
}

/**
 * Approve a pending store by setting status to 'active'.
 */
async function approveStore(storeId: string): Promise<void> {
	const db = await createCliDatabase();

	// Find the store
	const store = await db.query.stores.findFirst({
		where: eq(stores.id, storeId),
	});

	if (!store) {
		console.error(`Error: Store "${storeId}" not found.`);
		process.exit(1);
	}

	if (store.status === "active") {
		console.log(`Store "${store.name}" is already active.`);
		return;
	}

	// Update status to active
	await db
		.update(stores)
		.set({
			status: "active",
			updatedAt: new Date(),
		})
		.where(eq(stores.id, storeId));

	console.log(`Approved store: ${store.name}`);
}

/**
 * Reject/delete a store along with its identifiers and price records.
 */
async function rejectStore(storeId: string): Promise<void> {
	const db = await createCliDatabase();

	// Find the store
	const store = await db.query.stores.findFirst({
		where: eq(stores.id, storeId),
	});

	if (!store) {
		console.error(`Error: Store "${storeId}" not found.`);
		process.exit(1);
	}

	const storeName = store.name;

	// Delete storeItemState records (this cascades from stores but explicit is clearer)
	const deletedStates = await db
		.delete(storeItemState)
		.where(eq(storeItemState.storeId, storeId))
		.returning({ id: storeItemState.id });

	// Delete store identifiers (cascades from stores but explicit)
	const deletedIdentifiers = await db
		.delete(storeIdentifiers)
		.where(eq(storeIdentifiers.storeId, storeId))
		.returning({ id: storeIdentifiers.id });

	// Delete the store
	await db.delete(stores).where(eq(stores.id, storeId));

	console.log(`Rejected and deleted store: ${storeName}`);
	console.log(`  - Deleted ${deletedIdentifiers.length} identifier(s)`);
	console.log(`  - Deleted ${deletedStates.length} price record(s)`);
}

/**
 * Show detailed information about a store.
 */
async function showStore(storeId: string): Promise<void> {
	const db = await createCliDatabase();

	// Find the store with chain info
	const store = await db.query.stores.findFirst({
		where: eq(stores.id, storeId),
	});

	if (!store) {
		console.error(`Error: Store "${storeId}" not found.`);
		process.exit(1);
	}

	// Get chain info
	const chain = await db.query.chains.findFirst({
		where: eq(chains.slug, store.chainSlug),
	});

	// Get identifiers
	const identifiers = await db
		.select()
		.from(storeIdentifiers)
		.where(eq(storeIdentifiers.storeId, storeId));

	// Get price count
	const priceCountResult = await db
		.select({ count: count() })
		.from(storeItemState)
		.where(eq(storeItemState.storeId, storeId));

	const priceCount = priceCountResult[0]?.count || 0;

	// Get price source store name if applicable
	let priceSourceName: string | null = null;
	if (store.priceSourceStoreId) {
		const priceSourceStore = await db.query.stores.findFirst({
			where: eq(stores.id, store.priceSourceStoreId),
		});
		priceSourceName = priceSourceStore?.name || null;
	}

	// Print store details
	console.log("");
	console.log("Store Details:");
	console.log("=".repeat(60));
	console.log(`  ID:              ${store.id}`);
	console.log(`  Name:            ${store.name}`);
	console.log(
		`  Chain:           ${chain?.name || store.chainSlug} (${store.chainSlug})`,
	);
	console.log(`  Status:          ${store.status || "unknown"}`);
	console.log(`  Virtual:         ${store.isVirtual ? "Yes" : "No"}`);
	console.log(`  Address:         ${store.address || "-"}`);
	console.log(`  City:            ${store.city || "-"}`);
	console.log(`  Postal Code:     ${store.postalCode || "-"}`);
	console.log(`  Latitude:        ${store.latitude || "-"}`);
	console.log(`  Longitude:       ${store.longitude || "-"}`);
	console.log(
		`  Price Source:    ${priceSourceName ? `${priceSourceName} (${store.priceSourceStoreId})` : "-"}`,
	);
	console.log(`  Created:         ${formatDate(store.createdAt)}`);
	console.log(`  Updated:         ${formatDate(store.updatedAt)}`);
	console.log("");
	console.log("Identifiers:");
	console.log("-".repeat(60));
	if (identifiers.length === 0) {
		console.log("  (none)");
	} else {
		for (const id of identifiers) {
			console.log(`  ${id.type}: ${id.value}`);
		}
	}
	console.log("");
	console.log("Statistics:");
	console.log("-".repeat(60));
	console.log(`  Price records:   ${priceCount}`);
	console.log("");
}

/**
 * Resolve a price source identifier to a store ID.
 * The identifier can be:
 * 1. A store ID (starts with 'sto_')
 * 2. A store identifier value (e.g., 'dm_national')
 *
 * For identifier values, searches in storeIdentifiers table across all types.
 * Only returns virtual stores (isVirtual=true) as price sources.
 *
 * @param chainSlug - Chain identifier to search within
 * @param identifier - Store ID or identifier value
 * @returns Store ID if found, null otherwise
 */
async function resolvePriceSourceStore(
	chainSlug: string,
	identifier: string,
): Promise<string | null> {
	const db = await createCliDatabase();

	// If it looks like a store ID, try direct lookup first
	if (identifier.startsWith("sto_")) {
		const store = await db.query.stores.findFirst({
			where: and(
				eq(stores.id, identifier),
				eq(stores.chainSlug, chainSlug),
				eq(stores.isVirtual, true),
			),
		});
		if (store) {
			return store.id;
		}
	}

	// Search by identifier value in storeIdentifiers
	const result = await db
		.select({ storeId: storeIdentifiers.storeId })
		.from(storeIdentifiers)
		.innerJoin(stores, eq(stores.id, storeIdentifiers.storeId))
		.where(
			and(
				eq(stores.chainSlug, chainSlug),
				eq(stores.isVirtual, true),
				eq(storeIdentifiers.value, identifier),
			),
		)
		.limit(1);

	return result.length > 0 ? result[0].storeId : null;
}

/**
 * Add a new physical store with location data and link to a price source.
 */
async function addPhysicalStore(options: {
	chain: string;
	name: string;
	address?: string;
	city?: string;
	postalCode?: string;
	lat?: number;
	lng?: number;
	priceSource: string;
}): Promise<void> {
	const db = await createCliDatabase();

	// Verify chain exists
	const chain = await db.query.chains.findFirst({
		where: eq(chains.slug, options.chain),
	});

	if (!chain) {
		console.error(`Error: Chain "${options.chain}" not found.`);
		process.exit(1);
	}

	// Resolve price source
	const priceSourceStoreId = await resolvePriceSourceStore(
		options.chain,
		options.priceSource,
	);

	if (!priceSourceStoreId) {
		console.error(
			`Error: Price source "${options.priceSource}" not found for chain "${options.chain}".`,
		);
		console.error("The price source must be an existing virtual store.");
		process.exit(1);
	}

	// Get price source store name for confirmation
	const priceSourceStore = await db.query.stores.findFirst({
		where: eq(stores.id, priceSourceStoreId),
	});

	// Create the physical store
	const storeId = generatePrefixedId("sto");
	await db.insert(stores).values({
		id: storeId,
		chainSlug: options.chain,
		name: options.name,
		address: options.address || null,
		city: options.city || null,
		postalCode: options.postalCode || null,
		latitude: options.lat?.toString() || null,
		longitude: options.lng?.toString() || null,
		isVirtual: false,
		priceSourceStoreId,
		status: "active",
	});

	console.log(`Created physical store: ${options.name}`);
	console.log(`  ID: ${storeId}`);
	console.log(`  Chain: ${chain.name} (${options.chain})`);
	console.log(
		`  Price source: ${priceSourceStore?.name} (${priceSourceStoreId})`,
	);
	if (options.city) console.log(`  City: ${options.city}`);
	if (options.address) console.log(`  Address: ${options.address}`);
}

/**
 * Link an existing store to a price source.
 */
async function linkStoreToPriceSource(
	storeId: string,
	priceSourceIdentifier: string,
): Promise<void> {
	const db = await createCliDatabase();

	// Find the store
	const store = await db.query.stores.findFirst({
		where: eq(stores.id, storeId),
	});

	if (!store) {
		console.error(`Error: Store "${storeId}" not found.`);
		process.exit(1);
	}

	// Resolve price source
	const priceSourceStoreId = await resolvePriceSourceStore(
		store.chainSlug,
		priceSourceIdentifier,
	);

	if (!priceSourceStoreId) {
		console.error(
			`Error: Price source "${priceSourceIdentifier}" not found for chain "${store.chainSlug}".`,
		);
		console.error("The price source must be an existing virtual store.");
		process.exit(1);
	}

	// Get price source store name
	const priceSourceStore = await db.query.stores.findFirst({
		where: eq(stores.id, priceSourceStoreId),
	});

	// Update the store
	await db
		.update(stores)
		.set({
			priceSourceStoreId,
			updatedAt: new Date(),
		})
		.where(eq(stores.id, storeId));

	console.log(`Linked ${store.name} to price source ${priceSourceStore?.name}`);
}

/**
 * Parse a CSV line handling quoted fields.
 */
function parseCsvLine(line: string): string[] {
	const result: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (char === '"') {
			if (inQuotes && line[i + 1] === '"') {
				// Escaped quote
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (char === "," && !inQuotes) {
			result.push(current.trim());
			current = "";
		} else {
			current += char;
		}
	}
	result.push(current.trim());
	return result;
}

/**
 * Import physical stores from a CSV file.
 */
async function importStoresFromCsv(
	csvPath: string,
	chainSlug: string,
	priceSourceIdentifier: string,
): Promise<void> {
	const db = await createCliDatabase();

	// Verify chain exists
	const chain = await db.query.chains.findFirst({
		where: eq(chains.slug, chainSlug),
	});

	if (!chain) {
		console.error(`Error: Chain "${chainSlug}" not found.`);
		process.exit(1);
	}

	// Resolve price source
	const priceSourceStoreId = await resolvePriceSourceStore(
		chainSlug,
		priceSourceIdentifier,
	);

	if (!priceSourceStoreId) {
		console.error(
			`Error: Price source "${priceSourceIdentifier}" not found for chain "${chainSlug}".`,
		);
		console.error("The price source must be an existing virtual store.");
		process.exit(1);
	}

	// Check if file exists
	if (!fs.existsSync(csvPath)) {
		console.error(`Error: CSV file "${csvPath}" not found.`);
		process.exit(1);
	}

	// Read and parse CSV
	const fileStream = fs.createReadStream(csvPath);
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity,
	});

	let headers: string[] = [];
	let isFirstLine = true;
	let imported = 0;
	let errors = 0;
	const errorMessages: string[] = [];

	for await (const line of rl) {
		if (isFirstLine) {
			headers = parseCsvLine(line).map((h) => h.toLowerCase());
			isFirstLine = false;

			// Validate required columns
			if (!headers.includes("name")) {
				console.error('Error: CSV must have a "name" column.');
				process.exit(1);
			}
			continue;
		}

		const values = parseCsvLine(line);
		if (values.length === 0 || (values.length === 1 && values[0] === "")) {
			continue; // Skip empty lines
		}

		// Map values to object
		const row: Record<string, string> = {};
		for (let i = 0; i < headers.length && i < values.length; i++) {
			row[headers[i]] = values[i];
		}

		// Validate required fields
		if (!row.name || row.name.trim() === "") {
			errors++;
			errorMessages.push(`Line ${imported + errors + 1}: Missing name`);
			continue;
		}

		try {
			// Create the physical store
			const storeId = generatePrefixedId("sto");
			await db.insert(stores).values({
				id: storeId,
				chainSlug,
				name: row.name,
				address: row.address || null,
				city: row.city || null,
				postalCode: row.postal_code || null,
				latitude: row.lat || null,
				longitude: row.lng || null,
				isVirtual: false,
				priceSourceStoreId,
				status: "active",
			});

			imported++;
		} catch (error) {
			errors++;
			errorMessages.push(
				`Line ${imported + errors + 1}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	console.log(`Imported ${imported} stores, ${errors} errors`);
	if (errorMessages.length > 0) {
		console.log("\nErrors:");
		for (const msg of errorMessages.slice(0, 10)) {
			console.log(`  - ${msg}`);
		}
		if (errorMessages.length > 10) {
			console.log(`  ... and ${errorMessages.length - 10} more errors`);
		}
	}
}

/**
 * Main CLI program.
 */
async function main(): Promise<void> {
	const program = new Command();

	program
		.name("stores")
		.description(
			"Manage stores: list, approve, reject, add physical stores, and import from CSV",
		)
		.option("--pending", "List all pending stores")
		.option(
			"--chain <chain>",
			`List stores for a chain / required for --add and --import-csv (${CHAIN_IDS.join(", ")})`,
		)
		.option("--approve <id>", "Approve a pending store")
		.option("--reject <id>", "Reject and delete a store")
		.option("--show <id>", "Show detailed store information")
		// Physical store creation options
		.option(
			"--add",
			"Add a new physical store (requires --chain, --name, --price-source)",
		)
		.option("--name <name>", "Store name (for --add)")
		.option("--address <address>", "Store address (for --add)")
		.option("--city <city>", "Store city (for --add)")
		.option("--postal-code <code>", "Store postal code (for --add)")
		.option("--lat <latitude>", "Store latitude (for --add)", parseFloat)
		.option("--lng <longitude>", "Store longitude (for --add)", parseFloat)
		.option(
			"--price-source <identifier>",
			"Price source store identifier (for --add, --link, --import-csv)",
		)
		// Link store to price source
		.option(
			"--link <store_id>",
			"Link an existing store to a price source (requires --price-source)",
		)
		// CSV import
		.option(
			"--import-csv <path>",
			"Import physical stores from CSV (requires --chain, --price-source)",
		)
		.parse(process.argv);

	const opts = program.opts<{
		pending?: boolean;
		chain?: string;
		approve?: string;
		reject?: string;
		show?: string;
		add?: boolean;
		name?: string;
		address?: string;
		city?: string;
		postalCode?: string;
		lat?: number;
		lng?: number;
		priceSource?: string;
		link?: string;
		importCsv?: string;
	}>();

	try {
		// Handle mutually exclusive actions
		const actions = [
			opts.pending,
			opts.chain && !opts.add && !opts.importCsv, // --chain alone lists stores
			opts.approve,
			opts.reject,
			opts.show,
			opts.add,
			opts.link,
			opts.importCsv,
		].filter(Boolean);

		if (actions.length === 0) {
			program.help();
			return;
		}

		if (actions.length > 1 && !opts.add && !opts.importCsv) {
			console.error("Error: Please specify only one action at a time.");
			process.exit(1);
		}

		// Handle --add command
		if (opts.add) {
			if (!opts.chain) {
				console.error("Error: --chain is required for --add");
				process.exit(1);
			}
			if (!isValidChainId(opts.chain)) {
				console.error(`Error: Invalid chain ID "${opts.chain}"`);
				console.error(`Valid chain IDs: ${CHAIN_IDS.join(", ")}`);
				process.exit(1);
			}
			if (!opts.name) {
				console.error("Error: --name is required for --add");
				process.exit(1);
			}
			if (!opts.priceSource) {
				console.error("Error: --price-source is required for --add");
				process.exit(1);
			}
			await addPhysicalStore({
				chain: opts.chain,
				name: opts.name,
				address: opts.address,
				city: opts.city,
				postalCode: opts.postalCode,
				lat: opts.lat,
				lng: opts.lng,
				priceSource: opts.priceSource,
			});
			return;
		}

		// Handle --link command
		if (opts.link) {
			if (!opts.priceSource) {
				console.error("Error: --price-source is required for --link");
				process.exit(1);
			}
			await linkStoreToPriceSource(opts.link, opts.priceSource);
			return;
		}

		// Handle --import-csv command
		if (opts.importCsv) {
			if (!opts.chain) {
				console.error("Error: --chain is required for --import-csv");
				process.exit(1);
			}
			if (!isValidChainId(opts.chain)) {
				console.error(`Error: Invalid chain ID "${opts.chain}"`);
				console.error(`Valid chain IDs: ${CHAIN_IDS.join(", ")}`);
				process.exit(1);
			}
			if (!opts.priceSource) {
				console.error("Error: --price-source is required for --import-csv");
				process.exit(1);
			}
			await importStoresFromCsv(opts.importCsv, opts.chain, opts.priceSource);
			return;
		}

		// Handle other actions
		if (opts.pending) {
			await listPendingStores();
		} else if (opts.chain) {
			if (!isValidChainId(opts.chain)) {
				console.error(`Error: Invalid chain ID "${opts.chain}"`);
				console.error(`Valid chain IDs: ${CHAIN_IDS.join(", ")}`);
				process.exit(1);
			}
			await listStoresByChain(opts.chain);
		} else if (opts.approve) {
			await approveStore(opts.approve);
		} else if (opts.reject) {
			await rejectStore(opts.reject);
		} else if (opts.show) {
			await showStore(opts.show);
		}
	} catch (error) {
		console.error("Error:", error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

// Run the CLI
main().catch((error) => {
	console.error("Error:", error.message);
	process.exit(1);
});
