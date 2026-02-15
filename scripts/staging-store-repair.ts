/**
 * Staging Store Repair
 *
 * Idempotent staging repair for:
 * - backfilling store address/city/postal from recent ingestion filenames
 * - seeding stable identifiers for chains whose identifier typing changed (e.g. lidl/eurospin)
 * - merging duplicate virtual stores (moving identifiers; updating physical links)
 * - auto-syncing physical stores from canonical virtual stores (except dm)
 * - merging duplicate physical stores
 *
 * Usage:
 *   npx tsx scripts/staging-store-repair.ts [--apply] [--dry-run] [--chain=lidl] [--limit=200]
 */

import { sql } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/db";
import {
	chains,
	ingestionFiles,
	ingestionRuns,
	ingestionStoreStats,
	storeIdentifiers,
	stores,
} from "@/db/schema";
import { getAdapter } from "@/ingestion/adapters/registry";
import { generateDisplayNames, resolveChainName } from "@/lib/store-names";
import { generatePrefixedId } from "@/utils/id";

interface CliFlags {
	apply: boolean;
	chain: string | null;
	limit: number;
}

function parseFlags(argv: string[]): CliFlags {
	const flags: CliFlags = { apply: false, chain: null, limit: 0 };
	for (const arg of argv) {
		if (arg === "--apply") flags.apply = true;
		else if (arg === "--dry-run") flags.apply = false;
		else if (arg.startsWith("--chain=")) flags.chain = arg.slice("--chain=".length);
		else if (arg.startsWith("--limit=")) flags.limit = Number.parseInt(arg.slice("--limit=".length), 10);
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

function toMillis(value: Date | string | null | undefined): number {
	if (!value) return 0;
	if (value instanceof Date) return value.getTime();
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function detectFileType(filename: string): "csv" | "xml" | "xlsx" | "zip" {
	const lower = filename.toLowerCase();
	if (lower.endsWith(".xml")) return "xml";
	if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "xlsx";
	if (lower.endsWith(".zip")) return "zip";
	return "csv";
}

function extractLidlStoreCode(value: string): string | null {
	const normalized = value.trim();
	const match = normalized.match(/^Supermarket\s+(\d+)/i);
	if (match?.[1]) return match[1];
	if (/^\d+$/.test(normalized)) return normalized;
	return null;
}

function extractEurospinStoreCode(value: string): string | null {
	const normalized = value.trim();
	const match = normalized.match(/(\d{6})/);
	if (match?.[1]) return match[1];
	return null;
}

function hasDigit(value: string | null | undefined): boolean {
	return Boolean(value && /\d/.test(value));
}

function isMissingText(value: string | null | undefined): boolean {
	return !value || !value.trim();
}

async function recomputeDisplayNamesForGroups(
	db: ReturnType<typeof getDatabase>,
	groupKeys: Array<{ chainSlug: string; city: string | null }>,
): Promise<void> {
	if (groupKeys.length === 0) return;

	const unique = new Map<string, { chainSlug: string; city: string | null }>();
	for (const g of groupKeys) {
		unique.set(`${g.chainSlug}::${g.city ?? "__null__"}`, g);
	}

	const conditions = Array.from(unique.values()).map((g) =>
		g.city
			? sql`(${stores.chainSlug} = ${g.chainSlug} AND ${stores.city} = ${g.city})`
			: sql`(${stores.chainSlug} = ${g.chainSlug} AND ${stores.city} IS NULL)`,
	);

		const affected = await db.execute(sql`
			SELECT
				stores.id,
				stores.chain_slug AS "chainSlug",
				stores.name,
				stores.address,
				stores.city,
				stores.postal_code AS "postalCode",
				stores.display_name_manual AS "displayNameManual",
				c.name AS "chainName"
			FROM stores
			INNER JOIN chains c ON c.slug = stores.chain_slug
			WHERE ${sql.join(conditions, sql` OR `)}
		`);

		// drizzle-orm/postgres-js returns a RowList (array-like), not `{ rows: [...] }`.
		const rows = affected as unknown as Array<{
			id: string;
			chainSlug: string;
			name: string;
			address: string | null;
			city: string | null;
			postalCode: string | null;
			displayNameManual: boolean | null;
			chainName: string;
		}>;

	if (rows.length === 0) return;

	const storesForNaming = rows.map((s) => ({
		id: s.id,
		chainSlug: s.chainSlug,
		name: s.name,
		address: s.address,
		city: s.city,
		postalCode: s.postalCode,
		displayNameManual: Boolean(s.displayNameManual),
		chainName: resolveChainName(s.chainSlug, s.chainName),
	}));

	const nameMap = generateDisplayNames(storesForNaming);
	const updates = Array.from(nameMap.entries());
	if (updates.length === 0) return;

	const values = sql.join(
		updates.map(([id, displayName]) => sql`(${id}, ${displayName})`),
		sql`, `,
	);

	await db.execute(sql`
		UPDATE stores AS s
		SET display_name = src.display_name,
				updated_at = NOW()
		FROM (VALUES ${values}) AS src(id, display_name)
		WHERE s.id = src.id
	`);
}

async function main(): Promise<void> {
	const flags = parseFlags(process.argv.slice(2));
	const db = getDatabase();
	const now = new Date();

	// eslint-disable-next-line no-console
	console.log("=== Staging Store Repair ===");
	// eslint-disable-next-line no-console
	console.log(`apply: ${flags.apply}`);
	// eslint-disable-next-line no-console
	console.log(`chain: ${flags.chain ?? "all"}`);
	// eslint-disable-next-line no-console
	console.log(`limit: ${flags.limit || "none"}`);
	// eslint-disable-next-line no-console
	console.log("");

		// Some queries alias `stores` as `s`, others don't. Keep both variants.
		const chainFilterS = flags.chain ? sql`AND s.chain_slug = ${flags.chain}` : sql``;
		const chainFilterStores = flags.chain ? sql`AND chain_slug = ${flags.chain}` : sql``;
		const limitSql = flags.limit > 0 ? sql`LIMIT ${flags.limit}` : sql``;

	// -------------------------------------------------------------------------
	// Phase 0: Seed stable identifiers for lidl/eurospin so ingestion won't re-create duplicates.
	// -------------------------------------------------------------------------
	// eslint-disable-next-line no-console
	console.log("== Phase 0: Seed stable identifiers (lidl/eurospin) ==");

		const idRows = await db.execute(sql`
			SELECT
				si.id AS "sid",
				si.store_id AS "storeId",
				si.chain_slug AS "chainSlug",
				si.type,
				si.value
			FROM store_identifiers si
			INNER JOIN stores s ON s.id = si.store_id
			WHERE s.is_virtual = true
				AND s.chain_slug IN ('lidl', 'eurospin')
				${flags.chain ? sql`AND s.chain_slug = ${flags.chain}` : sql``}
		`);

		const identifierRows = idRows as unknown as Array<{
			sid: string;
			storeId: string;
			chainSlug: string;
			type: string;
			value: string;
		}>;

	const existingByStore = new Map<string, Array<{ type: string; value: string }>>();
	for (const r of identifierRows) {
		const list = existingByStore.get(r.storeId) ?? [];
		list.push({ type: r.type, value: r.value });
		existingByStore.set(r.storeId, list);
	}

	let seeded = 0;
	for (const [storeId, list] of existingByStore.entries()) {
		const chainSlug = identifierRows.find((r) => r.storeId === storeId)?.chainSlug;
		if (!chainSlug) continue;

		if (chainSlug === "lidl") {
			const hasStable = list.some((i) => i.type === "lidl_store_code");
			if (hasStable) continue;

			const candidates = list
				.map((i) => extractLidlStoreCode(i.value))
				.filter((v): v is string => Boolean(v));
			const code = candidates[0] ?? null;
			if (!code) continue;

			seeded += 1;
			if (!flags.apply) continue;

			await db.insert(storeIdentifiers).values({
				id: generatePrefixedId("sid"),
				storeId,
				chainSlug,
				type: "lidl_store_code",
				value: code,
				createdAt: now,
			});
		}

		if (chainSlug === "eurospin") {
			const hasStable = list.some((i) => i.type === "eurospin_store_code");
			if (hasStable) continue;

			const candidates = list
				.map((i) => extractEurospinStoreCode(i.value))
				.filter((v): v is string => Boolean(v));
			const code = candidates[0] ?? null;
			if (!code) continue;

			seeded += 1;
			if (!flags.apply) continue;

			await db.insert(storeIdentifiers).values({
				id: generatePrefixedId("sid"),
				storeId,
				chainSlug,
				type: "eurospin_store_code",
				value: code,
				createdAt: now,
			});
		}
	}

	// eslint-disable-next-line no-console
	console.log(`Seeded stable identifiers: ${seeded}${flags.apply ? "" : " (dry-run)"}`);
	// eslint-disable-next-line no-console
	console.log("");

	// -------------------------------------------------------------------------
	// Phase 1: Backfill virtual metadata from most recent ingestion filename.
	// -------------------------------------------------------------------------
	// eslint-disable-next-line no-console
	console.log("== Phase 1: Backfill virtual store metadata from ingestion files ==");

		const missingVirtual = await db.execute(sql`
			SELECT
				s.id,
				s.chain_slug AS "chainSlug",
			s.name,
			s.address,
			s.city,
			s.postal_code AS "postalCode"
		FROM stores s
			WHERE s.is_virtual = true
				AND s.chain_slug != 'dm'
				${chainFilterS}
				AND (
					s.address IS NULL OR btrim(s.address) = '' OR
					s.city IS NULL OR btrim(s.city) = '' OR
					s.postal_code IS NULL OR btrim(s.postal_code) = ''
			)
		ORDER BY s.id
		${limitSql}
		`);

		const virtualToBackfill = missingVirtual as unknown as Array<{
			id: string;
			chainSlug: string;
			name: string;
			address: string | null;
		city: string | null;
			postalCode: string | null;
		}>;

	const lastFileByStore = new Map<string, { filename: string; startedAt: Date | null }>();
	if (virtualToBackfill.length > 0) {
		const storeIds = virtualToBackfill.map((s) => s.id);
		const chunkSize = 500;
		for (let i = 0; i < storeIds.length; i += chunkSize) {
			const chunk = storeIds.slice(i, i + chunkSize);
				const result = await db.execute(sql`
					SELECT DISTINCT ON (iss.store_id)
						iss.store_id AS "storeId",
						f.filename AS "filename",
						r.started_at AS "startedAt"
				FROM ingestion_store_stats iss
				INNER JOIN ingestion_files f ON f.id = iss.file_id
				INNER JOIN ingestion_runs r ON r.id = iss.run_id
					WHERE iss.store_id IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})
					ORDER BY iss.store_id, r.started_at DESC NULLS LAST, f.created_at DESC NULLS LAST
				`);
				for (const row of result as unknown as Array<{ storeId: string; filename: string; startedAt: Date | null }>) {
					lastFileByStore.set(row.storeId, { filename: row.filename, startedAt: row.startedAt });
				}
			}
		}

	let backfilledVirtual = 0;
	const touchedGroups: Array<{ chainSlug: string; city: string | null }> = [];

	for (const s of virtualToBackfill) {
		const last = lastFileByStore.get(s.id);
		if (!last?.filename) continue;

		const adapter = getAdapter(s.chainSlug as never);
		const metadata = adapter.extractStoreMetadata({
			url: "",
			filename: last.filename,
			type: detectFileType(last.filename),
		});
		if (!metadata) continue;

		const updates: Record<string, unknown> = { updatedAt: now };
		if (metadata.address) {
			// Fill missing, or upgrade incomplete street-only addresses when we now have a house number.
			if (isMissingText(s.address)) updates.address = metadata.address;
			else if (!hasDigit(s.address) && hasDigit(metadata.address)) updates.address = metadata.address;
		}
		if (metadata.city && isMissingText(s.city)) updates.city = metadata.city;
		if (metadata.postalCode && isMissingText(s.postalCode)) updates.postalCode = metadata.postalCode;

		if (Object.keys(updates).length === 1) continue;

		backfilledVirtual += 1;
		touchedGroups.push({ chainSlug: s.chainSlug, city: (updates.city as string) ?? s.city ?? null });

		if (!flags.apply) continue;
		await db.update(stores).set(updates).where(sql`${stores.id} = ${s.id}`);
	}

	// eslint-disable-next-line no-console
	console.log(`Backfilled virtual stores: ${backfilledVirtual}${flags.apply ? "" : " (dry-run)"}`);
	// eslint-disable-next-line no-console
	console.log("");

	// -------------------------------------------------------------------------
	// Phase 2: Merge duplicate virtual stores by stable key.
	// -------------------------------------------------------------------------
	// eslint-disable-next-line no-console
	console.log("== Phase 2: Merge duplicate virtual stores ==");

		const virtualWithIds = await db.execute(sql`
			SELECT
				s.id,
				s.chain_slug AS "chainSlug",
			s.status,
			s.address,
			s.city,
			s.postal_code AS "postalCode",
			s.updated_at AS "updatedAt",
			(
				SELECT max(r.started_at)
				FROM ingestion_store_stats iss
				INNER JOIN ingestion_runs r ON r.id = iss.run_id
				WHERE iss.store_id = s.id
			) AS "lastSeenAt"
		FROM stores s
			WHERE s.is_virtual = true
				AND s.chain_slug != 'dm'
				${chainFilterS}
				AND s.status != 'merged'
		`);

			const virtualRows = virtualWithIds as unknown as Array<{
				id: string;
				chainSlug: string;
				status: string | null;
				address: string | null;
				city: string | null;
				postalCode: string | null;
				updatedAt: Date | string | null;
				lastSeenAt: Date | string | null;
			}>;

		const idsForVirtual = virtualRows.map((v) => v.id);
		const identifiersForVirtual = idsForVirtual.length
			? await db.execute(sql`
					SELECT store_id AS "storeId", type, value
					FROM store_identifiers
					WHERE store_id IN (${sql.join(idsForVirtual.map((id) => sql`${id}`), sql`, `)})
				`)
			: ([] as Array<{ storeId: string; type: string; value: string }>);

		const identifiersByStore = new Map<string, Array<{ type: string; value: string }>>();
		for (const r of identifiersForVirtual as unknown as Array<{ storeId: string; type: string; value: string }>) {
			const list = identifiersByStore.get(r.storeId) ?? [];
			list.push({ type: r.type, value: r.value });
			identifiersByStore.set(r.storeId, list);
		}

	function virtualKey(v: typeof virtualRows[number]): string | null {
		const ids = identifiersByStore.get(v.id) ?? [];
		if (v.chainSlug === "lidl") {
			const stable =
				ids.find((i) => i.type === "lidl_store_code")?.value ??
				ids.map((i) => extractLidlStoreCode(i.value)).find((x) => x);
			if (stable) return `lidl:code:${stable}`;
		}
		if (v.chainSlug === "eurospin") {
			const stable =
				ids.find((i) => i.type === "eurospin_store_code")?.value ??
				ids.map((i) => extractEurospinStoreCode(i.value)).find((x) => x);
			if (stable) return `eurospin:code:${stable}`;
		}
		const addrKey = [normalizeText(v.city), normalizeText(v.address)].join("|");
		if (normalizeText(v.city) && normalizeText(v.address)) return `${v.chainSlug}:addr:${addrKey}`;
		return null;
	}

	const groups = new Map<string, typeof virtualRows>();
	for (const v of virtualRows) {
		const key = virtualKey(v);
		if (!key) continue;
		const list = groups.get(key) ?? [];
		list.push(v);
		groups.set(key, list);
	}

	let mergedVirtual = 0;
	for (const [key, list] of groups.entries()) {
		if (list.length < 2) continue;

			const sorted = [...list].sort((a, b) => {
				const aSeen = toMillis(a.lastSeenAt);
				const bSeen = toMillis(b.lastSeenAt);
				if (aSeen !== bSeen) return bSeen - aSeen;

			const aComplete = Number(Boolean(a.address)) + Number(Boolean(a.city)) + Number(Boolean(a.postalCode));
			const bComplete = Number(Boolean(b.address)) + Number(Boolean(b.city)) + Number(Boolean(b.postalCode));
			if (aComplete !== bComplete) return bComplete - aComplete;

				const aUpdated = toMillis(a.updatedAt);
				const bUpdated = toMillis(b.updatedAt);
				return bUpdated - aUpdated;
			});

		const canonical = sorted[0];
		const others = sorted.slice(1);
		if (!canonical) continue;

		for (const dup of others) {
			mergedVirtual += 1;
			if (!flags.apply) continue;

			// Move identifiers to canonical (dedupe if canonical already has them).
			const dupIds = identifiersByStore.get(dup.id) ?? [];
			const canonicalIds = new Set(
				(identifiersByStore.get(canonical.id) ?? []).map((i) => `${i.type}::${i.value}`),
			);

			for (const ident of dupIds) {
				const k = `${ident.type}::${ident.value}`;
				if (canonicalIds.has(k)) {
					await db.delete(storeIdentifiers).where(
						sql`${storeIdentifiers.storeId} = ${dup.id} AND ${storeIdentifiers.type} = ${ident.type} AND ${storeIdentifiers.value} = ${ident.value}`,
					);
					continue;
				}
				await db
					.update(storeIdentifiers)
					.set({ storeId: canonical.id, chainSlug: canonical.chainSlug })
					.where(
						sql`${storeIdentifiers.storeId} = ${dup.id} AND ${storeIdentifiers.type} = ${ident.type} AND ${storeIdentifiers.value} = ${ident.value}`,
					);
				canonicalIds.add(k);
			}

			// Re-point physical stores linked to the duplicate virtual store.
			await db
				.update(stores)
				.set({ priceSourceStoreId: canonical.id, updatedAt: now })
				.where(
					sql`${stores.isVirtual} = false AND ${stores.priceSourceStoreId} = ${dup.id}`,
				);

			// Mark duplicate virtual store as merged (keep row for historical references).
			await db
				.update(stores)
				.set({ status: "merged", updatedAt: now })
				.where(sql`${stores.id} = ${dup.id}`);
		}

		// eslint-disable-next-line no-console
		console.log(`  merged ${others.length} -> canonical ${canonical.id} (${key})`);
	}

	// eslint-disable-next-line no-console
	console.log(`Merged virtual stores: ${mergedVirtual}${flags.apply ? "" : " (dry-run)"}`);
	// eslint-disable-next-line no-console
	console.log("");

	// -------------------------------------------------------------------------
	// Phase 3: Auto-sync physical stores from canonical virtual stores (except dm).
	// -------------------------------------------------------------------------
	// eslint-disable-next-line no-console
	console.log("== Phase 3: Auto-sync physical stores from virtual price sources ==");

		const canonicalVirtual = await db.execute(sql`
			SELECT
				s.id,
				s.chain_slug AS "chainSlug",
			s.name,
			s.address,
			s.city,
			s.postal_code AS "postalCode",
			s.latitude,
			s.longitude,
			(
				SELECT max(r.started_at)
				FROM ingestion_store_stats iss
				INNER JOIN ingestion_runs r ON r.id = iss.run_id
				WHERE iss.store_id = s.id
			) AS "lastSeenAt"
		FROM stores s
			WHERE s.is_virtual = true
				AND s.chain_slug != 'dm'
				${chainFilterS}
				AND s.status != 'merged'
		`);

			const virtualCandidates = canonicalVirtual as unknown as Array<{
				id: string;
				chainSlug: string;
				name: string;
				address: string | null;
				city: string | null;
				postalCode: string | null;
				latitude: string | null;
				longitude: string | null;
				lastSeenAt: Date | string | null;
			}>;

	// Existing physical stores linked to virtual stores.
	const linkedPhysical = await db.execute(sql`
		SELECT
			id,
			chain_slug AS "chainSlug",
			address,
			city,
			postal_code AS "postalCode",
			latitude,
			longitude,
			price_source_store_id AS "priceSourceStoreId",
			status
		FROM stores
		WHERE is_virtual = false
			AND price_source_store_id IS NOT NULL
			${flags.chain ? sql`AND chain_slug = ${flags.chain}` : sql``}
		`);

		const physicalByPriceSource = new Map<string, Array<(typeof linkedPhysical)[number]>>();
		for (const p of linkedPhysical as unknown as Array<any>) {
			const list = physicalByPriceSource.get(p.priceSourceStoreId as string) ?? [];
			list.push(p);
			physicalByPriceSource.set(p.priceSourceStoreId as string, list);
		}

	let physicalCreated = 0;
	let physicalBackfilled = 0;
	for (const v of virtualCandidates) {
		// Require minimally useful location metadata for physical stores.
		if (!v.city || !v.city.trim()) continue;

		const linked = physicalByPriceSource.get(v.id) ?? [];
		if (linked.length === 0) {
			physicalCreated += 1;
			if (!flags.apply) continue;

			const storeId = generatePrefixedId("sto");
			await db.insert(stores).values({
				id: storeId,
				chainSlug: v.chainSlug,
				name: v.name,
				address: v.address,
				city: v.city,
				postalCode: v.postalCode,
				latitude: v.latitude,
				longitude: v.longitude,
				isVirtual: false,
				priceSourceStoreId: v.id,
				status: "active",
				createdAt: now,
				updatedAt: now,
			});

			touchedGroups.push({ chainSlug: v.chainSlug, city: v.city ?? null });
			continue;
		}

		// Backfill existing linked physical stores from virtual store.
		for (const p of linked) {
			const updates: Record<string, unknown> = { updatedAt: now };
			if (v.address) {
				if (isMissingText(p.address)) updates.address = v.address;
				else if (!hasDigit(String(p.address)) && hasDigit(v.address)) updates.address = v.address;
			}
			if (v.city && isMissingText(p.city)) updates.city = v.city;
			if (v.postalCode && isMissingText(p.postalCode)) updates.postalCode = v.postalCode;
			if ((!p.latitude || !String(p.latitude).trim()) && v.latitude) updates.latitude = v.latitude;
			if ((!p.longitude || !String(p.longitude).trim()) && v.longitude) updates.longitude = v.longitude;
			if (Object.keys(updates).length === 1) continue;

			physicalBackfilled += 1;
			touchedGroups.push({ chainSlug: v.chainSlug, city: (updates.city as string) ?? p.city ?? null });
			if (!flags.apply) continue;

			await db.update(stores).set(updates).where(sql`${stores.id} = ${p.id}`);
		}
	}

	// eslint-disable-next-line no-console
	console.log(`Physical created: ${physicalCreated}${flags.apply ? "" : " (dry-run)"}`);
	// eslint-disable-next-line no-console
	console.log(`Physical backfilled: ${physicalBackfilled}${flags.apply ? "" : " (dry-run)"}`);
	// eslint-disable-next-line no-console
	console.log("");

	// -------------------------------------------------------------------------
	// Phase 4: Merge duplicate physical stores by address key (active only).
	// -------------------------------------------------------------------------
	// eslint-disable-next-line no-console
	console.log("== Phase 4: Merge duplicate physical stores (by chain/city/address) ==");

		const physicalActive = await db.execute(sql`
			SELECT
				id,
				chain_slug AS "chainSlug",
			address,
			city,
			postal_code AS "postalCode",
			latitude,
			longitude,
			price_source_store_id AS "priceSourceStoreId",
			updated_at AS "updatedAt"
			FROM stores
			WHERE is_virtual = false
				AND status = 'active'
				${chainFilterStores}
		`);

		const physicalRows = physicalActive as unknown as Array<{
			id: string;
			chainSlug: string;
			address: string | null;
			city: string | null;
			postalCode: string | null;
			latitude: string | null;
			longitude: string | null;
			priceSourceStoreId: string | null;
			updatedAt: Date | string | null;
		}>;

	const physicalGroups = new Map<string, typeof physicalRows>();
	for (const p of physicalRows) {
		const city = normalizeText(p.city);
		const addr = normalizeText(p.address);
		if (!city || !addr) continue;
		const key = `${p.chainSlug}|${city}|${addr}`;
		const list = physicalGroups.get(key) ?? [];
		list.push(p);
		physicalGroups.set(key, list);
	}

	let mergedPhysical = 0;
	for (const [key, list] of physicalGroups.entries()) {
		if (list.length < 2) continue;

		const sorted = [...list].sort((a, b) => {
			const aScore =
				Number(Boolean(a.latitude && a.longitude)) +
				Number(Boolean(a.priceSourceStoreId)) +
				Number(Boolean(a.postalCode));
			const bScore =
				Number(Boolean(b.latitude && b.longitude)) +
				Number(Boolean(b.priceSourceStoreId)) +
				Number(Boolean(b.postalCode));
				if (aScore !== bScore) return bScore - aScore;
				return toMillis(b.updatedAt) - toMillis(a.updatedAt);
			});

		const canonical = sorted[0];
		const others = sorted.slice(1);
		if (!canonical) continue;

		mergedPhysical += others.length;
		// eslint-disable-next-line no-console
		console.log(`  merged ${others.length} -> canonical ${canonical.id} (${key})`);

		if (!flags.apply) continue;
		for (const dup of others) {
			// If canonical is missing a price source link but dup has it, keep it.
			if (!canonical.priceSourceStoreId && dup.priceSourceStoreId) {
				await db
					.update(stores)
					.set({ priceSourceStoreId: dup.priceSourceStoreId, updatedAt: now })
					.where(sql`${stores.id} = ${canonical.id}`);
			}

			await db
				.update(stores)
				.set({ status: "merged", updatedAt: now })
				.where(sql`${stores.id} = ${dup.id}`);
		}
	}

	// eslint-disable-next-line no-console
	console.log(`Merged physical stores: ${mergedPhysical}${flags.apply ? "" : " (dry-run)"}`);
	// eslint-disable-next-line no-console
	console.log("");

	if (flags.apply && touchedGroups.length > 0) {
		// eslint-disable-next-line no-console
		console.log("== Recomputing display names for touched groups ==");
		await recomputeDisplayNamesForGroups(db, touchedGroups);
		// eslint-disable-next-line no-console
		console.log("Display names updated.");
	}

	// eslint-disable-next-line no-console
	console.log("=== Done ===");
	// eslint-disable-next-line no-console
	console.log(flags.apply ? "Applied changes." : "Dry-run only (no changes written).");
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
