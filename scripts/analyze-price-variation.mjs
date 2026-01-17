#!/usr/bin/env node
/**
 * Analyze price variation + change rates from a local D1 SQLite database.
 *
 * Prereq: sync remote D1 into local sqlite first (optional but recommended):
 *   pnpm db:sync-test
 *   pnpm db:sync-prod
 *
 * Usage:
 *   node scripts/analyze-price-variation.mjs
 *   node scripts/analyze-price-variation.mjs --since-days=180 --stores=60 --items=250
 *   node scripts/analyze-price-variation.mjs --chains=konzum,lidl
 *   node scripts/analyze-price-variation.mjs --db=.wrangler/state/v3/d1/.../xxxx.sqlite
 */
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

function sqlStringLiteral(value) {
	return `'${String(value).replaceAll("'", "''")}'`;
}

function median(values) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[mid];
	return (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(values, q) {
	if (values.length === 0) return null;
	if (!(q >= 0 && q <= 1)) throw new Error(`Invalid quantile: ${q}`);
	const sorted = [...values].sort((a, b) => a - b);
	const idx = (sorted.length - 1) * q;
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo];
	const weight = idx - lo;
	return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

function formatPct(value) {
	if (value === null) return "n/a";
	return `${(value * 100).toFixed(1)}%`;
}

function shortHash(input) {
	return createHash("sha256").update(input).digest("hex").slice(0, 10);
}

function computeSqliteFilename(databaseId) {
	const uniqueKey = "miniflare-D1DatabaseObject";
	const key = createHash("sha256").update(uniqueKey).digest();
	const nameHmac = createHmac("sha256", key).update(databaseId).digest().subarray(0, 16);
	const hmac = createHmac("sha256", key).update(nameHmac).digest().subarray(0, 16);
	return Buffer.concat([nameHmac, hmac]).toString("hex");
}

function parseWranglerConfig(configPath) {
	const fullPath = resolve(process.cwd(), configPath);
	if (!existsSync(fullPath)) throw new Error(`${configPath} not found`);

	const content = readFileSync(fullPath, "utf-8");
	const jsonContent = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
	const config = JSON.parse(jsonContent);
	const d1Databases = config.d1_databases;

	if (!d1Databases || d1Databases.length === 0) {
		throw new Error(`No d1_databases found in ${configPath}`);
	}

	const db = d1Databases[0];
	return { databaseName: db.database_name, databaseId: db.database_id };
}

function runSqliteJson(sqlitePath, sql) {
	const result = spawnSync("sqlite3", ["-json", sqlitePath, sql], {
		encoding: "utf8",
		maxBuffer: 128 * 1024 * 1024,
	});

	if (result.status !== 0) {
		throw new Error(
			`sqlite3 failed (exit=${result.status}): ${result.stderr || result.stdout || ""}`.trim(),
		);
	}

	const trimmed = (result.stdout ?? "").trim();
	if (trimmed.length === 0) return [];
	return JSON.parse(trimmed);
}

function chunk(items, size) {
	const out = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

function effectivePrice(row) {
	if (typeof row.discount_price === "number") return row.discount_price;
	if (typeof row.current_price === "number") return row.current_price;
	return null;
}

function normalizeInt(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
		return Number(value);
	}
	return null;
}

async function main() {
	const { values } = parseArgs({
		options: {
			db: { type: "string" },
			config: { type: "string" },
			chains: { type: "string" },
			"since-days": { type: "string" },
			stores: { type: "string" },
			items: { type: "string" },
			"state-sample": { type: "string" },
			verbose: { type: "boolean" },
		},
	});

	const sinceDays = Number(values["since-days"] ?? "180");
	const storeSample = Number(values.stores ?? "60");
	const itemSample = Number(values.items ?? "250");
	const stateSample = Number(values["state-sample"] ?? "2000");
	const verbose = Boolean(values.verbose ?? false);

	if (!Number.isFinite(sinceDays) || sinceDays <= 0) throw new Error("--since-days must be > 0");
	if (!Number.isFinite(storeSample) || storeSample <= 0) throw new Error("--stores must be > 0");
	if (!Number.isFinite(itemSample) || itemSample <= 0) throw new Error("--items must be > 0");
	if (!Number.isFinite(stateSample) || stateSample <= 0) throw new Error("--state-sample must be > 0");

	const configPath = String(values.config ?? "wrangler.jsonc");
	const sqlitePath =
		typeof values.db === "string" && values.db.length > 0
			? resolve(process.cwd(), values.db)
			: resolve(
					process.cwd(),
					".wrangler/state/v3/d1/miniflare-D1DatabaseObject",
					`${computeSqliteFilename(parseWranglerConfig(configPath).databaseId)}.sqlite`,
				);

	if (!existsSync(sqlitePath)) {
		throw new Error(
			`Local sqlite DB not found at ${sqlitePath}\n` +
				`Hint: run pnpm db:sync-test or pnpm db:sync-prod (or pass --db=PATH)`,
		);
	}

	const sinceEpoch = Math.floor(Date.now() / 1000) - Math.floor(sinceDays * 24 * 60 * 60);

	const chainSlugs =
		typeof values.chains === "string" && values.chains.trim().length > 0
			? values.chains
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: runSqliteJson(sqlitePath, "SELECT slug FROM chains ORDER BY slug")
					.map((r) => r.slug)
					.filter(Boolean);

	console.log(
		JSON.stringify(
			{
				startedAt: new Date().toISOString(),
				sqlitePath,
				configPath: typeof values.db === "string" ? null : configPath,
				sinceDays,
				sinceEpoch,
				chains: chainSlugs,
				params: { storeSample, itemSample, stateSample, verbose },
			},
			null,
			2,
		),
	);

	for (const chainSlug of chainSlugs) {
		console.log("\n============================================================");
		console.log(`Chain: ${chainSlug}`);

		const storeIds = runSqliteJson(
			sqlitePath,
			`SELECT id FROM stores WHERE chain_slug = ${sqlStringLiteral(chainSlug)} AND status = 'active' ORDER BY random() LIMIT ${storeSample}`,
		).map((r) => r.id);

		const itemIds = runSqliteJson(
			sqlitePath,
			`SELECT id FROM retailer_items WHERE chain_slug = ${sqlStringLiteral(chainSlug)} ORDER BY random() LIMIT ${itemSample}`,
		).map((r) => r.id);

		console.log(`Sampled: stores=${storeIds.length}, items=${itemIds.length}`);
		if (storeIds.length === 0 || itemIds.length === 0) {
			console.log("No stores/items found for chain; skipping.");
			continue;
		}

		const storeIdSql = storeIds.map(sqlStringLiteral).join(",");
		const itemIdSql = itemIds.map(sqlStringLiteral).join(",");

		const matrix = runSqliteJson(
			sqlitePath,
			`SELECT store_id, retailer_item_id, current_price, discount_price
       FROM store_item_state
       WHERE store_id IN (${storeIdSql})
         AND retailer_item_id IN (${itemIdSql})
         AND last_seen_at >= ${sinceEpoch}`,
		);

		console.log(`Matrix rows (store×item observed within window): ${matrix.length}`);

		// Store coverage
		const rowsByStore = new Map();
		for (const row of matrix) {
			const list = rowsByStore.get(row.store_id) ?? [];
			list.push(row);
			rowsByStore.set(row.store_id, list);
		}
		const storeCoverageRatios = storeIds.map((storeId) => {
			const count = rowsByStore.get(storeId)?.length ?? 0;
			return count / itemIds.length;
		});
		console.log(
			`Coverage per store (sampled items): median=${formatPct(median(storeCoverageRatios))}, p10=${formatPct(
				quantile(storeCoverageRatios, 0.1),
			)}, p90=${formatPct(quantile(storeCoverageRatios, 0.9))}`,
		);

		// Store signature clustering (based on sampled items + effective price)
		const signatureToStores = new Map();
		for (const storeId of storeIds) {
			const rows = rowsByStore.get(storeId) ?? [];
			const priceByItem = new Map();
			for (const row of rows) {
				const p = effectivePrice(row);
				if (typeof p === "number") priceByItem.set(row.retailer_item_id, p);
			}
			// Include missing items as sentinel to avoid clustering stores with different assortments as identical.
			const parts = itemIds.map((itemId) => `${itemId}:${priceByItem.get(itemId) ?? "-"}`);
			const signature = shortHash(parts.join("|"));
			const stores = signatureToStores.get(signature) ?? [];
			stores.push(storeId);
			signatureToStores.set(signature, stores);
		}
		const clusters = [...signatureToStores.entries()]
			.map(([signature, stores]) => ({ signature, size: stores.length, stores }))
			.sort((a, b) => b.size - a.size);
		const topCluster = clusters[0];
		console.log(
			`Store clusters (sample signature): distinct=${clusters.length}, top_share=${formatPct(
				topCluster ? topCluster.size / storeIds.length : null,
			)}`,
		);
		if (verbose && topCluster) {
			console.log(
				`Top clusters: ${clusters
					.slice(0, 5)
					.map((c) => `${c.signature}:${c.size}`)
					.join(", ")}`,
			);
		}

		// Item-level price variation across stores (effective price)
		const rowsByItem = new Map();
		for (const row of matrix) {
			const list = rowsByItem.get(row.retailer_item_id) ?? [];
			list.push(row);
			rowsByItem.set(row.retailer_item_id, list);
		}

		const uniquePriceCounts = [];
		const modalShares = [];
		const itemCoverages = [];

		for (const itemId of itemIds) {
			const rows = rowsByItem.get(itemId) ?? [];
			const prices = [];
			for (const row of rows) {
				const p = effectivePrice(row);
				if (typeof p === "number") prices.push(p);
			}
			if (prices.length === 0) continue;

			itemCoverages.push(prices.length / storeIds.length);
			const counts = new Map();
			for (const p of prices) counts.set(p, (counts.get(p) ?? 0) + 1);
			uniquePriceCounts.push(counts.size);
			const maxCount = Math.max(...counts.values());
			modalShares.push(maxCount / prices.length);
		}

		console.log(
			`Item coverage across stores: median=${formatPct(median(itemCoverages))}, p10=${formatPct(
				quantile(itemCoverages, 0.1),
			)}, p90=${formatPct(quantile(itemCoverages, 0.9))}`,
		);
		console.log(
			`Unique prices per item: median=${median(uniquePriceCounts) ?? "n/a"}, p90=${
				quantile(uniquePriceCounts, 0.9) ?? "n/a"
			}, p99=${quantile(uniquePriceCounts, 0.99) ?? "n/a"}`,
		);
		console.log(
			`Modal price share per item: median=${formatPct(median(modalShares))}, p10=${formatPct(
				quantile(modalShares, 0.1),
			)}, p90=${formatPct(quantile(modalShares, 0.9))}`,
		);

		// Change-rate sampling (period counts within window)
		const stateIds = runSqliteJson(
			sqlitePath,
			`SELECT sis.id
       FROM store_item_state sis
       JOIN stores st ON st.id = sis.store_id
       WHERE st.chain_slug = ${sqlStringLiteral(chainSlug)}
         AND sis.last_seen_at >= ${sinceEpoch}
       ORDER BY sis.last_seen_at DESC
       LIMIT ${stateSample}`,
		).map((r) => r.id);

		const changes = [];
		for (const batch of chunk(stateIds, 400)) {
			const idSql = batch.map(sqlStringLiteral).join(",");
			const rows = runSqliteJson(
				sqlitePath,
				`SELECT store_item_state_id AS id,
              SUM(CASE
                    WHEN started_at < ${sinceEpoch}
                     AND (ended_at IS NULL OR ended_at >= ${sinceEpoch})
                    THEN 1 ELSE 0 END)
            + SUM(CASE WHEN started_at >= ${sinceEpoch} THEN 1 ELSE 0 END) AS overlap_count
       FROM store_item_price_periods
       WHERE store_item_state_id IN (${idSql})
         AND (ended_at IS NULL OR ended_at >= ${sinceEpoch})
       GROUP BY store_item_state_id`,
			);

			for (const row of rows) {
				const overlap = normalizeInt(row.overlap_count);
				if (overlap === null) continue;
				changes.push(Math.max(0, overlap - 1));
			}
		}

		console.log(
			`Price changes per (store,item) within window: states_sampled=${stateIds.length}, observed=${changes.length}, median=${
				median(changes) ?? "n/a"
			}, p90=${quantile(changes, 0.9) ?? "n/a"}, p99=${quantile(changes, 0.99) ?? "n/a"}`,
		);
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});

