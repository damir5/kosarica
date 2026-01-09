#!/usr/bin/env npx tsx
/**
 * Stores CLI Command
 *
 * Manage stores: list, approve, reject, and view store details.
 *
 * Usage:
 *   pnpm ingest stores --pending           # List pending stores
 *   pnpm ingest stores --chain=dm          # List all stores for chain
 *   pnpm ingest stores --approve <id>      # Approve a pending store
 *   pnpm ingest stores --reject <id>       # Reject/delete a store
 *   pnpm ingest stores --show <id>         # Show store details
 */

import { Command } from "commander";
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy, type PlatformProxy } from "wrangler";

import * as schema from "@/db/schema";
import { chains, storeIdentifiers, storeItemState, stores } from "@/db/schema";
import { CHAIN_IDS, isValidChainId } from "../chains";

// Platform proxy for accessing Cloudflare bindings in local dev
let platformProxy: PlatformProxy<Env> | null = null;

/**
 * Initialize the platform proxy for accessing Cloudflare bindings.
 */
async function initPlatformProxy(): Promise<PlatformProxy<Env>> {
	if (!platformProxy) {
		platformProxy = await getPlatformProxy<Env>({
			configPath: "./wrangler.jsonc",
			persist: true,
		});
	}
	return platformProxy;
}

/**
 * Cleanup platform proxy on exit.
 */
async function disposePlatformProxy(): Promise<void> {
	if (platformProxy) {
		await platformProxy.dispose();
		platformProxy = null;
	}
}

/**
 * Create a Drizzle database instance for CLI usage.
 */
async function createCliDatabase() {
	const proxy = await initPlatformProxy();
	return drizzle(proxy.env.DB, { schema });
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
 * Main CLI program.
 */
async function main(): Promise<void> {
	const program = new Command();

	program
		.name("stores")
		.description("Manage stores: list, approve, reject, and view details")
		.option("--pending", "List all pending stores")
		.option(
			"--chain <chain>",
			`List stores for a chain (${CHAIN_IDS.join(", ")})`,
		)
		.option("--approve <id>", "Approve a pending store")
		.option("--reject <id>", "Reject and delete a store")
		.option("--show <id>", "Show detailed store information")
		.parse(process.argv);

	const opts = program.opts<{
		pending?: boolean;
		chain?: string;
		approve?: string;
		reject?: string;
		show?: string;
	}>();

	try {
		// Handle mutually exclusive options
		const actions = [
			opts.pending,
			opts.chain,
			opts.approve,
			opts.reject,
			opts.show,
		].filter(Boolean);

		if (actions.length === 0) {
			program.help();
			return;
		}

		if (actions.length > 1) {
			console.error("Error: Please specify only one action at a time.");
			process.exit(1);
		}

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
	} finally {
		await disposePlatformProxy();
	}
}

// Run the CLI
main().catch(async (error) => {
	console.error("Error:", error.message);
	await disposePlatformProxy();
	process.exit(1);
});
