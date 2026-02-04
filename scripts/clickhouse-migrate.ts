#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@clickhouse/client";
import { config } from "dotenv";

type AppliedMigrationRow = {
	name: string;
	checksum: string;
};

type MigrationFile = {
	name: string;
	filePath: string;
	checksum: string;
	statements: string[];
};

function loadEnv() {
	const nodeEnv = process.env.NODE_ENV || "development";
	config({ path: `.env.${nodeEnv}` });
	config();
}

function sha256(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

function splitStatements(sql: string): string[] {
	const withoutLineComments = sql
		.split("\n")
		.map((line) => line.replace(/--.*$/g, ""))
		.join("\n");

	return withoutLineComments
		.split(";")
		.map((statement) => statement.trim())
		.filter((statement) => statement.length > 0);
}

async function readMigrations(migrationsDir: string): Promise<MigrationFile[]> {
	const files = (await readdir(migrationsDir))
		.filter((name) => name.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b));

	const migrations: MigrationFile[] = [];
	for (const name of files) {
		const filePath = path.join(migrationsDir, name);
		const sql = await readFile(filePath, "utf8");
		const statements = splitStatements(sql);
		if (statements.length === 0) {
			throw new Error(`Migration ${name} is empty after parsing SQL statements.`);
		}

		migrations.push({
			name,
			filePath,
			checksum: sha256(sql),
			statements,
		});
	}

	return migrations;
}

async function ensureMigrationsTable(
	command: (query: string) => Promise<void>,
): Promise<void> {
	await command(`
CREATE TABLE IF NOT EXISTS schema_migrations (
	name String,
	checksum String,
	applied_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(applied_at)
ORDER BY name
`);
}

async function getAppliedMigrations(
	queryRows: (query: string) => Promise<AppliedMigrationRow[]>,
): Promise<Map<string, string>> {
	const rows = await queryRows(`
SELECT
	name,
	argMax(checksum, applied_at) AS checksum
FROM schema_migrations
GROUP BY name
`);

	const applied = new Map<string, string>();
	for (const row of rows) {
		applied.set(row.name, row.checksum);
	}
	return applied;
}

async function main() {
	loadEnv();

	const statusOnly = process.argv.includes("--status");
	const migrationsDir = path.resolve(
		process.env.CLICKHOUSE_MIGRATIONS_DIR || "clickhouse/migrations",
	);
	const url = process.env.CLICKHOUSE_URL;

	if (!url) {
		throw new Error(
			"CLICKHOUSE_URL environment variable is required for ClickHouse migrations",
		);
	}

	const client = createClient({
		url,
		database: process.env.CLICKHOUSE_DATABASE || "default",
		username: process.env.CLICKHOUSE_USERNAME,
		password: process.env.CLICKHOUSE_PASSWORD,
	});

	const command = async (query: string): Promise<void> => {
		await client.command({ query });
	};
	const queryRows = async (query: string): Promise<AppliedMigrationRow[]> => {
		const result = await client.query({ query, format: "JSONEachRow" });
		return (await result.json()) as AppliedMigrationRow[];
	};

	try {
		console.log("==> Running ClickHouse migrations");
		console.log(`URL: ${url}`);
		console.log(`Migrations dir: ${migrationsDir}`);

		const migrations = await readMigrations(migrationsDir);
		if (migrations.length === 0) {
			console.log("No ClickHouse migration files found.");
			return;
		}

		console.log("Migrations:");
		for (const migration of migrations) {
			console.log(`  - ${migration.name}`);
		}

		await ensureMigrationsTable(command);
		const applied = await getAppliedMigrations(queryRows);

		let appliedCount = 0;
		let skippedCount = 0;

		for (const migration of migrations) {
			const currentChecksum = applied.get(migration.name);
			if (currentChecksum) {
				if (currentChecksum !== migration.checksum) {
					throw new Error(
						`Checksum mismatch for already-applied migration ${migration.name}. ` +
							"Create a new migration file instead of editing an applied one.",
					);
				}
				skippedCount += 1;
				continue;
			}

			if (statusOnly) {
				continue;
			}

			console.log(`Applying ${migration.name}...`);
			for (const statement of migration.statements) {
				await command(statement);
			}

			await client.insert({
				table: "schema_migrations",
				values: [{ name: migration.name, checksum: migration.checksum }],
				format: "JSONEachRow",
			});

			appliedCount += 1;
		}

		if (statusOnly) {
			const pending = migrations.length - skippedCount;
			console.log(
				`Status: applied=${skippedCount}, pending=${pending}, total=${migrations.length}`,
			);
			return;
		}

		console.log(
			`Done. Applied ${appliedCount} migration(s), skipped ${skippedCount} already applied.`,
		);
	} finally {
		await client.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
