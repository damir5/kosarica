/**
 * Staging Store Audit
 *
 * Non-mutating audit for store inconsistencies (duplicates, missing addresses, etc.).
 *
 * Usage:
 *   npx tsx scripts/staging-store-audit.ts [--chain=lidl] [--city=Zadar] [--json]
 */

import { sql } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/db";
import { stores } from "@/db/schema";

interface CliFlags {
	chain: string | null;
	city: string | null;
	json: boolean;
}

function parseFlags(argv: string[]): CliFlags {
	const flags: CliFlags = { chain: null, city: null, json: false };
	for (const arg of argv) {
		if (arg === "--json") flags.json = true;
		else if (arg.startsWith("--chain=")) flags.chain = arg.slice("--chain=".length);
		else if (arg.startsWith("--city=")) flags.city = arg.slice("--city=".length);
	}
	return flags;
}

function normalizeText(value: string | null | undefined): string {
	if (!value) return "";
	return value
		.normalize("NFKD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

function roundTo(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

function haversineDistanceKm(
	lat1: number,
	lng1: number,
	lat2: number,
	lng2: number,
): number {
	const EARTH_RADIUS_KM = 6371;
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
	return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function main(): Promise<void> {
	const flags = parseFlags(process.argv.slice(2));
	const db = getDatabase();

	const whereParts = [];
	if (flags.chain) whereParts.push(sql`${stores.chainSlug} = ${flags.chain}`);
	if (flags.city) whereParts.push(sql`${stores.city} ILIKE ${flags.city}`);
	const where =
		whereParts.length > 0 ? sql`WHERE ${sql.join(whereParts, sql` AND `)}` : sql``;

	const all = await db.execute(sql`
			SELECT
				id,
				chain_slug AS "chainSlug",
				name,
				address,
				city,
				postal_code AS "postalCode",
				latitude,
				longitude,
				is_virtual AS "isVirtual",
				status,
				price_source_store_id AS "priceSourceStoreId",
				updated_at AS "updatedAt",
				created_at AS "createdAt"
			FROM stores
			${where}
		`);

	// drizzle-orm/postgres-js returns a RowList (array-like), not `{ rows: [...] }`.
	const rows = all as unknown as Array<{
		id: string;
		chainSlug: string;
		name: string;
		address: string | null;
		city: string | null;
		postalCode: string | null;
		latitude: string | null;
		longitude: string | null;
		isVirtual: boolean | null;
		status: string | null;
		priceSourceStoreId: string | null;
		updatedAt: Date | null;
		createdAt: Date | null;
	}>;

	const physicalActive = rows.filter((r) => r.isVirtual === false && r.status === "active");
	const virtualAll = rows.filter((r) => r.isVirtual === true);

	const missingAddressPhysical = physicalActive.filter(
		(r) => !r.address || !r.address.trim() || !r.city || !r.city.trim(),
	);
	const missingAddressVirtual = virtualAll.filter(
		(r) => !r.address || !r.address.trim() || !r.city || !r.city.trim(),
	);

	const duplicatesByAddress = new Map<string, string[]>();
	for (const r of physicalActive) {
		const key = [
			r.chainSlug,
			normalizeText(r.city),
			normalizeText(r.address),
		].join("|");
		if (!normalizeText(r.city) || !normalizeText(r.address)) continue;
		const list = duplicatesByAddress.get(key) ?? [];
		list.push(r.id);
		duplicatesByAddress.set(key, list);
	}
	const addressDupes = Array.from(duplicatesByAddress.entries())
		.filter(([, ids]) => ids.length > 1)
		.map(([key, ids]) => ({ key, ids, count: ids.length }))
		.sort((a, b) => b.count - a.count);

	const bucketMap = new Map<string, typeof physicalActive>();
	for (const r of physicalActive) {
		if (!r.latitude || !r.longitude) continue;
		const lat = Number.parseFloat(r.latitude);
		const lng = Number.parseFloat(r.longitude);
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

		const bucket = [
			r.chainSlug,
			roundTo(lat, 3),
			roundTo(lng, 3),
		].join("|");
		const list = bucketMap.get(bucket) ?? [];
		list.push(r);
		bucketMap.set(bucket, list);
	}

	const proximityDupes: Array<{
		chainSlug: string;
		a: string;
		b: string;
		distanceMeters: number;
	}> = [];

	for (const list of bucketMap.values()) {
		if (list.length < 2) continue;
		for (let i = 0; i < list.length; i += 1) {
			for (let j = i + 1; j < list.length; j += 1) {
				const a = list[i];
				const b = list[j];
				const dKm = haversineDistanceKm(
					Number.parseFloat(a.latitude!),
					Number.parseFloat(a.longitude!),
					Number.parseFloat(b.latitude!),
					Number.parseFloat(b.longitude!),
				);
				if (dKm <= 0.05) {
					proximityDupes.push({
						chainSlug: a.chainSlug,
						a: a.id,
						b: b.id,
						distanceMeters: Math.round(dKm * 1000),
					});
				}
			}
		}
	}

	const audit = {
		generatedAt: new Date().toISOString(),
		filter: flags,
		counts: {
			total: rows.length,
			physicalActive: physicalActive.length,
			virtualAll: virtualAll.length,
			physicalMissingAddressOrCity: missingAddressPhysical.length,
			virtualMissingAddressOrCity: missingAddressVirtual.length,
			physicalMissingCoords: physicalActive.filter(
				(r) => !r.latitude || !r.longitude,
			).length,
		},
		duplicates: {
			physicalByAddressKey: addressDupes.slice(0, 50),
			physicalByProximityPairs: proximityDupes.slice(0, 200),
		},
		lidlZadar: physicalActive
			.filter((r) => r.chainSlug === "lidl" && normalizeText(r.city) === "zadar")
			.map((r) => ({
				id: r.id,
				name: r.name,
				address: r.address,
				city: r.city,
				postalCode: r.postalCode,
				latitude: r.latitude,
				longitude: r.longitude,
				priceSourceStoreId: r.priceSourceStoreId,
			})),
	};

	if (flags.json) {
		// JSON mode: stdout-only
		// eslint-disable-next-line no-console
		console.log(JSON.stringify(audit, null, 2));
		return;
	}

	// Human-readable summary
	// eslint-disable-next-line no-console
	console.log("=== Store Audit Summary ===");
	// eslint-disable-next-line no-console
	console.log(`Generated: ${audit.generatedAt}`);
	// eslint-disable-next-line no-console
	console.log(
		`Total: ${audit.counts.total} | Physical(active): ${audit.counts.physicalActive} | Virtual: ${audit.counts.virtualAll}`,
	);
	// eslint-disable-next-line no-console
	console.log(
		`Missing address/city: physical=${audit.counts.physicalMissingAddressOrCity}, virtual=${audit.counts.virtualMissingAddressOrCity}`,
	);
	// eslint-disable-next-line no-console
	console.log(`Missing coords (physical active): ${audit.counts.physicalMissingCoords}`);
	// eslint-disable-next-line no-console
	console.log("");

	// eslint-disable-next-line no-console
	console.log(`Physical duplicates by address key (top): ${audit.duplicates.physicalByAddressKey.length}`);
	for (const d of audit.duplicates.physicalByAddressKey.slice(0, 10)) {
		// eslint-disable-next-line no-console
		console.log(`  ${d.count}x ${d.key} -> ${d.ids.join(", ")}`);
	}

	// eslint-disable-next-line no-console
	console.log("");
	// eslint-disable-next-line no-console
	console.log(`Physical duplicates by proximity pairs (sample): ${audit.duplicates.physicalByProximityPairs.length}`);
	for (const p of audit.duplicates.physicalByProximityPairs.slice(0, 10)) {
		// eslint-disable-next-line no-console
		console.log(`  ${p.chainSlug}: ${p.a} <-> ${p.b} (${p.distanceMeters}m)`);
	}

	// eslint-disable-next-line no-console
	console.log("");
	// eslint-disable-next-line no-console
	console.log(`Lidl Zadar physical(active): ${audit.lidlZadar.length}`);
	for (const r of audit.lidlZadar) {
		// eslint-disable-next-line no-console
		console.log(
			`  ${r.id} | ${r.address ?? "(no address)"} | ${r.latitude ?? "?"},${r.longitude ?? "?"} | priceSource=${r.priceSourceStoreId ?? "-"}`,
		);
	}
}

main()
	.catch((err) => {
		// eslint-disable-next-line no-console
		console.error(err);
		process.exitCode = 1;
	})
	.finally(() => {
		closeDatabase();
	});
