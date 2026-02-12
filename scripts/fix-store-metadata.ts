/**
 * Fix Store Metadata Script
 *
 * Re-extracts store metadata (name, city, address) from store identifiers
 * for chains with corrupted metadata.
 *
 * Usage:
 *   pnpm tsx scripts/fix-store-metadata.ts [--dry-run] [--chain=konzum]
 */

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/db";
import { stores, storeIdentifiers } from "@/db/schema";
import { createLogger } from "@/utils/logger";

const log = createLogger("app");

interface CliFlags {
	dryRun: boolean;
	chain: string | null;
}

function parseFlags(): CliFlags {
	const args = process.argv.slice(2);
	const flags: CliFlags = { dryRun: false, chain: null };

	for (const arg of args) {
		if (arg === "--dry-run") {
			flags.dryRun = true;
		} else if (arg.startsWith("--chain=")) {
			flags.chain = arg.slice("--chain=".length);
		}
	}

	return flags;
}

function isDateLike(s: string): boolean {
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
	if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return true;
	if (/^\d{2}\.\d{2}\.\d{4}\.$/.test(s)) return true;
	return false;
}

function extractKonzumMetadata(identifier: string): { city: string; address: string } | null {
	const parts = identifier.split(",");
	const storeCodeMatch = identifier.match(/,(\d{4}),/);
	if (!storeCodeMatch) return null;

	const storeCode = storeCodeMatch[1];
	const codeIndex = parts.indexOf(storeCode);
	if (codeIndex < 0) return null;

	let cityIndex = codeIndex + 1;
	while (cityIndex < parts.length && isDateLike(parts[cityIndex] ?? "")) {
		cityIndex += 1;
	}

	let addressIndex = cityIndex + 1;
	while (addressIndex < parts.length && isDateLike(parts[addressIndex] ?? "")) {
		addressIndex += 1;
	}

	const city = (parts[cityIndex] ?? "").replace(/_/g, " ").trim();
	const address = (parts[addressIndex] ?? "").replace(/_/g, " ").trim();

	return { city, address };
}

function extractLidlMetadata(identifier: string): { city: string; address: string } | null {
	const normalized = identifier.replace(/\.(zip|csv)$/i, "").trim();

	const supermarketMatch = normalized.match(/^Supermarket\s+(\d+)_(.+)$/i);
	if (supermarketMatch) {
		const details = supermarketMatch[2] ?? "";
		const parts = details.split("_").filter(
			(p) => p && !/^\d{8}$/.test(p) && !/^\d{2}\.\d{2}\.\d{4}$/.test(p) && !/^\d{1,2}\.\d{2}h?$/i.test(p) && !/^\d{1,2}$/i.test(p),
		);

		if (parts.length >= 2) {
			const streetParts: string[] = [];
			const cityParts: string[] = [];
			let foundCityStart = false;

			for (const part of parts) {
				if (/^\d{5}$/.test(part)) {
					foundCityStart = true;
					continue;
				}
				if (foundCityStart) {
					cityParts.push(part);
				} else {
					streetParts.push(part);
				}
			}

			return {
				city: cityParts.join(" ").trim(),
				address: streetParts.join(" ").trim(),
			};
		}
	}

	const parts = normalized.split("_").filter((p) => p && !/^\d{8}$/.test(p));
	if (parts.length >= 2) {
		return {
			city: parts[0]?.trim() ?? "",
			address: parts.slice(1).join(" ").trim(),
		};
	}

	return null;
}

function extractPlodineMetadata(identifier: string): { city: string; address: string; postalCode: string } | null {
	const parts = identifier.split("_");

	if (parts[0]?.toUpperCase() === "SUPERMARKET" && parts.length >= 6) {
		const postalCodeIndex = parts.findIndex((part, index) => index > 0 && /^\d{5}$/.test(part));

		if (postalCodeIndex >= 2 && postalCodeIndex < parts.length - 3) {
			const cityParts = parts.slice(postalCodeIndex + 1, -3);
			const streetParts = parts.slice(1, postalCodeIndex);

			return {
				city: cityParts.join(" ").trim(),
				address: streetParts.join(" ").trim(),
				postalCode: parts[postalCodeIndex] ?? "",
			};
		}
	}

	return null;
}

function extractStudenacMetadata(identifier: string): { city: string; address: string } | null {
	const match = identifier.match(/^SUPERMARKET-(.+)-T\d+-\d+-\d{4}-\d{2}-\d{2}/i);
	if (match?.[1]) {
		const locationPart = match[1];
		const parts = locationPart.split("_").map((p) => p.trim()).filter(Boolean);

		if (parts.length >= 2) {
			const splitIndex = getStreetCitySplitIndex(parts);
			const streetParts = parts.slice(0, splitIndex);
			const cityParts = parts.slice(splitIndex);

			return {
				address: streetParts.join(" ").trim(),
				city: cityParts.join(" ").trim(),
			};
		}

		if (parts.length === 1) {
			return { city: parts[0] ?? "", address: "" };
		}
	}

	return null;
}

function getStreetCitySplitIndex(parts: string[]): number {
	for (let index = parts.length - 2; index >= 0; index -= 1) {
		const part = parts[index];
		if (/^\d+[A-Za-z]?$/i.test(part ?? "")) {
			return index + 1;
		}
	}
	return 1;
}

function extractKtcMetadata(_identifier: string, storeName?: string): { city: string } | null {
	if (storeName) {
		const cityMatch = storeName.match(/KTC\s*[-–,]?\s*(.+)/i);
		const city = cityMatch?.[1]?.trim();
		if (city) {
			return { city };
		}
	}
	return null;
}

function extractEurospinMetadata(identifier: string): { city: string; address: string; postalCode: string } | null {
	const parts = identifier.split("-");

	if (parts.length >= 5) {
		const city = parts[3]?.replace(/_/g, " ").trim() ?? "";
		const address = parts[2]?.replace(/_/g, " ").trim() ?? "";
		const postalCode = parts[4]?.trim() ?? "";

		if (city || address) {
			return { city, address, postalCode };
		}
	}

	return null;
}

async function main() {
	const flags = parseFlags();
	const db = getDatabase();

	console.log("=== Fix Store Metadata ===");
	console.log(`  dry-run: ${flags.dryRun}`);
	console.log(`  chain:   ${flags.chain ?? "all"}`);
	console.log("");

	const corruptedChains = ["konzum", "lidl", "plodine", "studenac", "ktc", "eurospin"];

	const chainConditions = flags.chain
		? [eq(stores.chainSlug, flags.chain)]
		: [inArray(stores.chainSlug, corruptedChains)];

	const storesToFix = await db
		.select({
			id: stores.id,
			chainSlug: stores.chainSlug,
			name: stores.name,
			address: stores.address,
			city: stores.city,
			postalCode: stores.postalCode,
			displayName: stores.displayName,
		})
		.from(stores)
		.where(
			and(
				...chainConditions,
				or(
					isNull(stores.city),
					isNull(stores.address),
					sql`${stores.city} ~ '^[0-9]+$'`,
					sql`${stores.city} ~ '^\d{4}-\d{2}-\d{2}$'`,
					sql`${stores.address} ~ '^\d{4}-\d{2}-\d{2}$'`,
					sql`${stores.address} ~ '^\d{2}\.\d{2}\.\d{4}'`,
				),
			),
		);

	console.log(`Found ${storesToFix.length} stores with potentially corrupted metadata.\n`);

	if (storesToFix.length === 0) {
		console.log("Nothing to fix.");
		return;
	}

	const storeIds = storesToFix.map((s) => s.id);
	const identifiers = await db
		.select({
			storeId: storeIdentifiers.storeId,
			type: storeIdentifiers.type,
			value: storeIdentifiers.value,
		})
		.from(storeIdentifiers)
		.where(inArray(storeIdentifiers.storeId, storeIds));

	const identifierMap = new Map<string, { type: string; value: string }[]>();
	for (const id of identifiers) {
		const existing = identifierMap.get(id.storeId) ?? [];
		existing.push({ type: id.type, value: id.value });
		identifierMap.set(id.storeId, existing);
	}

	let fixed = 0;
	let skipped = 0;

	for (const store of storesToFix) {
		const storeIds = identifierMap.get(store.id) ?? [];
		const filenameId = storeIds.find((id) => id.type === "filename_code")?.value;

		if (!filenameId) {
			console.log(`  [SKIP] ${store.id}: No filename identifier found`);
			skipped += 1;
			continue;
		}

		let extracted: { city?: string; address?: string; postalCode?: string } | null = null;

		switch (store.chainSlug) {
			case "konzum":
				extracted = extractKonzumMetadata(filenameId);
				break;
			case "lidl":
				extracted = extractLidlMetadata(filenameId);
				break;
			case "plodine":
				extracted = extractPlodineMetadata(filenameId);
				break;
			case "studenac":
				extracted = extractStudenacMetadata(filenameId);
				break;
			case "ktc":
				extracted = extractKtcMetadata(filenameId, store.name);
				break;
			case "eurospin":
				extracted = extractEurospinMetadata(filenameId);
				break;
		}

		if (!extracted || (!extracted.city && !extracted.address)) {
			console.log(`  [SKIP] ${store.id}: Could not extract metadata from "${filenameId}"`);
			skipped += 1;
			continue;
		}

		const updates: Record<string, unknown> = { updatedAt: new Date() };

		if (extracted.city && (!store.city || isDateLike(store.city) || /^\d+$/.test(store.city))) {
			updates.city = extracted.city;
		}
		if (extracted.address && (!store.address || isDateLike(store.address))) {
			updates.address = extracted.address;
		}
		if (extracted.postalCode && !store.postalCode) {
			updates.postalCode = extracted.postalCode;
		}

		if (Object.keys(updates).length === 1) {
			console.log(`  [SKIP] ${store.id}: No updates needed`);
			skipped += 1;
			continue;
		}

		if (!flags.dryRun) {
			await db.update(stores).set(updates).where(eq(stores.id, store.id));
		}

		console.log(
			`  [FIX]  ${store.id}: city="${extracted.city}" address="${extracted.address}"${flags.dryRun ? " (dry-run)" : ""}`,
		);
		fixed += 1;
	}

	console.log("\n=== Summary ===");
	console.log(`  Fixed:   ${fixed}`);
	console.log(`  Skipped: ${skipped}`);
}

main()
	.catch((err) => {
		log.error("Fix store metadata failed", { error: err });
		console.error("Fatal:", err);
		process.exitCode = 1;
	})
	.finally(() => {
		closeDatabase();
	});
