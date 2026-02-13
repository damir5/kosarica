/**
 * Import Croatian Places Data
 *
 * Imports Croatian administrative divisions (counties, municipalities, settlements)
 * from mjesta.csv into the database for validation/normalization.
 *
 * Usage:
 *   pnpm tsx scripts/import-croatian-places.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { getDatabase } from "@/db";
import { decode, detectEncoding } from "@/ingestion/parsers/charset";

interface CsvRow {
	settlementId: number;
	settlementName: string;
	settlementExternalId: number | null;
	municipalityId: number;
	municipalityName: string;
	municipalityExternalId: number | null;
	countyId: number;
	countyName: string;
	countyExternalId: number | null;
}

function parseInteger(value: string): number | null {
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

function parseCsvLine(line: string): string[] {
	const result: string[] = [];
	let current = "";
	let inQuotes = false;

	for (const char of line) {
		if (char === '"') {
			inQuotes = !inQuotes;
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

function parseCsv(content: string): CsvRow[] {
	const lines = content.split("\n").filter((line) => line.trim());
	const rows: CsvRow[] = [];

	// Skip header line
	for (let i = 1; i < lines.length; i++) {
		const fields = parseCsvLine(lines[i]);
		if (fields.length < 9) continue;

		rows.push({
			settlementId: parseInteger(fields[0]) ?? 0,
			settlementName: fields[1],
			settlementExternalId: parseInteger(fields[2]),
			municipalityId: parseInteger(fields[3]) ?? 0,
			municipalityName: fields[4],
			municipalityExternalId: parseInteger(fields[5]),
			countyId: parseInteger(fields[6]) ?? 0,
			countyName: fields[7],
			countyExternalId: parseInteger(fields[8]),
		});
	}

	return rows;
}

async function main() {
	console.log("=== Import Croatian Places Data ===\n");

	const csvPath = join(process.cwd(), "mjesta.csv");
	console.log(`Reading: ${csvPath}`);

	const buffer = readFileSync(csvPath);
	const encoding = detectEncoding(buffer);
	console.log(`Detected encoding: ${encoding}`);

	const content = decode(buffer, encoding);
	const rows = parseCsv(content);
	console.log(`Parsed ${rows.length} rows\n`);

	// Extract unique counties, municipalities, settlements
	const countiesMap = new Map<
		number,
		{ name: string; externalId: number | null }
	>();
	const municipalitiesMap = new Map<
		number,
		{ name: string; externalId: number | null; countyId: number }
	>();
	const settlementsMap = new Map<
		number,
		{ name: string; externalId: number | null; municipalityId: number }
	>();

	for (const row of rows) {
		if (!countiesMap.has(row.countyId)) {
			countiesMap.set(row.countyId, {
				name: row.countyName,
				externalId: row.countyExternalId,
			});
		}
		if (!municipalitiesMap.has(row.municipalityId)) {
			municipalitiesMap.set(row.municipalityId, {
				name: row.municipalityName,
				externalId: row.municipalityExternalId,
				countyId: row.countyId,
			});
		}
		if (!settlementsMap.has(row.settlementId)) {
			settlementsMap.set(row.settlementId, {
				name: row.settlementName,
				externalId: row.settlementExternalId,
				municipalityId: row.municipalityId,
			});
		}
	}

	console.log(`Unique entities:`);
	console.log(`  Counties: ${countiesMap.size}`);
	console.log(`  Municipalities: ${municipalitiesMap.size}`);
	console.log(`  Settlements: ${settlementsMap.size}\n`);

	const db = getDatabase();

	// Insert counties
	console.log("Inserting counties...");
	const countyValues = Array.from(countiesMap.entries()).map(
		([id, data]) => `(${id}, '${data.name.replace(/'/g, "''")}', ${data.externalId ?? "NULL"})`,
	);
	await db.execute(sql`
		INSERT INTO croatian_counties (id, name, external_id)
		VALUES ${sql.raw(countyValues.join(", "))}
		ON CONFLICT (id) DO NOTHING
	`);
	console.log(`  Inserted ${countiesMap.size} counties\n`);

	// Insert municipalities
	console.log("Inserting municipalities...");
	const municipalityValues = Array.from(municipalitiesMap.entries()).map(
		([id, data]) =>
			`(${id}, '${data.name.replace(/'/g, "''")}', ${data.externalId ?? "NULL"}, ${data.countyId})`,
	);
	await db.execute(sql`
		INSERT INTO croatian_municipalities (id, name, external_id, county_id)
		VALUES ${sql.raw(municipalityValues.join(", "))}
		ON CONFLICT (id) DO NOTHING
	`);
	console.log(`  Inserted ${municipalitiesMap.size} municipalities\n`);

	// Insert settlements in batches
	console.log("Inserting settlements...");
	const settlementEntries = Array.from(settlementsMap.entries());
	const batchSize = 500;
	let insertedSettlements = 0;

	for (let i = 0; i < settlementEntries.length; i += batchSize) {
		const batch = settlementEntries.slice(i, i + batchSize);
		const settlementValues = batch.map(
			([id, data]) =>
				`(${id}, '${data.name.replace(/'/g, "''")}', ${data.externalId ?? "NULL"}, ${data.municipalityId})`,
		);
		await db.execute(sql`
			INSERT INTO croatian_settlements (id, name, external_id, municipality_id)
			VALUES ${sql.raw(settlementValues.join(", "))}
			ON CONFLICT (id) DO NOTHING
		`);
		insertedSettlements += batch.length;
		console.log(`  Progress: ${insertedSettlements}/${settlementsMap.size}`);
	}

	console.log(`  Inserted ${settlementsMap.size} settlements\n`);

	// Verify counts
	console.log("Verifying counts...");
	const countyCount = (await db.execute(sql`
		SELECT COUNT(*) as count FROM croatian_counties
	`)) as unknown as { count: bigint }[];
	const municipalityCount = (await db.execute(sql`
		SELECT COUNT(*) as count FROM croatian_municipalities
	`)) as unknown as { count: bigint }[];
	const settlementCount = (await db.execute(sql`
		SELECT COUNT(*) as count FROM croatian_settlements
	`)) as unknown as { count: bigint }[];

	console.log(`  Counties in DB: ${countyCount[0]?.count ?? "N/A"}`);
	console.log(
		`  Municipalities in DB: ${municipalityCount[0]?.count ?? "N/A"}`,
	);
	console.log(`  Settlements in DB: ${settlementCount[0]?.count ?? "N/A"}\n`);

	// Test Croatian characters
	console.log("Testing Croatian characters...");
	const charTest = (await db.execute(sql`
		SELECT name FROM croatian_settlements
		WHERE name LIKE '%č%' OR name LIKE '%ć%' OR name LIKE '%š%' OR name LIKE '%ž%' OR name LIKE '%đ%'
		LIMIT 5
	`)) as unknown as { name: string }[];
	console.log("  Sample names with Croatian characters:");
	for (const row of charTest) {
		console.log(`    - ${row.name}`);
	}

	// Test join query
	console.log("\nTesting join query (Zagreb)...");
	const zagrebTest = (await db.execute(sql`
		SELECT s.name, m.name as municipality, c.name as county
		FROM croatian_settlements s
		JOIN croatian_municipalities m ON s.municipality_id = m.id
		JOIN croatian_counties c ON m.county_id = c.id
		WHERE s.name = 'Zagreb'
		LIMIT 5
	`)) as unknown as { name: string; municipality: string; county: string }[];
	for (const row of zagrebTest) {
		console.log(`    ${row.name} → ${row.municipality} → ${row.county}`);
	}

	console.log("\n=== Import Complete ===");
}

main().catch((error) => {
	console.error("Import failed:", error);
	process.exit(1);
});
