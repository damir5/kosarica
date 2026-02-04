import type { ExecException } from "node:child_process";
import { exec } from "node:child_process";
import { lookup } from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import postgres from "postgres";

const DEFAULT_TEST_DATABASE_URL =
	"postgresql://kosarica_test:kosarica_test@localhost:5432/kosarica_test";

function assertTestDatabaseUrl(url: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid DATABASE_URL: ${url}`);
	}

	const dbName = parsed.pathname.replace(/^\//, "");
	if (!dbName || !dbName.endsWith("_test")) {
		throw new Error(
			`Refusing to run test DB cleanup on non-test database: ${dbName || "<missing>"}`,
		);
	}
}

function tryLoadTestEnvFile(): void {
	// Vitest doesn't automatically load `.env.test`. Migrations already do, but
	// globalSetup needs DATABASE_URL before it can clean up the DB.
	const envPath = path.join(process.cwd(), ".env.test");
	if (!fs.existsSync(envPath)) return;
	dotenv.config({ path: envPath });
}

async function maybeFallbackFromOrbStackDns(url: string): Promise<string> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return url;
	}

	const hostname = parsed.hostname;
	if (!hostname.endsWith(".orb.local")) return url;

	try {
		await lookup(hostname);
		return url;
	} catch {
		parsed.hostname = "localhost";
		parsed.port = "5433";
		console.warn(
			`WARNING: DNS lookup failed for ${hostname}; falling back to ${parsed.hostname}:${parsed.port} for tests.`,
		);
		return parsed.toString();
	}
}

async function canConnectToPostgres(url: string): Promise<boolean> {
	const sql = postgres(url, {
		max: 1,
		connect_timeout: 1,
	});

	try {
		await sql`select 1`;
		return true;
	} catch {
		return false;
	} finally {
		await sql.end({ timeout: 1 });
	}
}

async function chooseTestDatabaseUrl(configuredUrl: string): Promise<string> {
	assertTestDatabaseUrl(configuredUrl);

	const candidates: string[] = [configuredUrl];
	let parsed: URL | null = null;
	try {
		parsed = new URL(configuredUrl);
	} catch {
		parsed = null;
	}

	if (parsed) {
		if (parsed.hostname.endsWith(".orb.local")) {
			const localhost5433 = new URL(parsed.toString());
			localhost5433.hostname = "localhost";
			localhost5433.port = "5433";
			candidates.push(localhost5433.toString());

			const hostDocker5433 = new URL(parsed.toString());
			hostDocker5433.hostname = "host.docker.internal";
			hostDocker5433.port = "5433";
			candidates.push(hostDocker5433.toString());
		}

		for (const port of ["5433", parsed.port || "5432", "5432"]) {
			const local = new URL(parsed.toString());
			local.hostname = "localhost";
			local.port = port;
			candidates.push(local.toString());
		}
	}

	const uniqueCandidates = [...new Set(candidates)];
	for (const candidate of uniqueCandidates) {
		if (await canConnectToPostgres(candidate)) return candidate;
	}

	throw new Error(
		[
			"Unable to connect to the test database.",
			"Tried:",
			...uniqueCandidates.map((c) => `- ${c}`),
			"",
			"Start test services with `mise run test-all` (recommended) or `docker compose --profile test up -d postgres-test`.",
		].join("\n"),
	);
}

/**
 * Verify ClickHouse is available (warning only, don't fail for unit tests).
 */
async function verifyClickHouse(): Promise<void> {
	const clickhouseUrl =
		process.env.CLICKHOUSE_URL || "http://ade-clickhouse-test.orb.local:8123";

	try {
		const response = await fetch(`${clickhouseUrl}/ping`, {
			signal: AbortSignal.timeout(2000),
		});
		if (response.ok) {
			console.log(`ClickHouse available at ${clickhouseUrl}`);
		} else {
			console.warn(
				`WARNING: ClickHouse ping returned ${response.status} at ${clickhouseUrl}`,
			);
			console.warn(
				"  ClickHouse integration tests may fail. Run 'mise run test-all' to auto-start test services.",
			);
		}
	} catch {
		console.warn(`WARNING: ClickHouse not available at ${clickhouseUrl}`);
		console.warn(
			"  ClickHouse integration tests may fail. Run 'mise run test-all' to auto-start test services.",
		);
	}
}

/**
 * Clean up the test database by dropping all tables, types, enums, and the drizzle schema.
 */
async function cleanupTestDatabase(testUrl: string): Promise<void> {
	assertTestDatabaseUrl(testUrl);
	const sql = postgres(testUrl);

	try {
		// Drop all tables in the public schema
		await sql`
      DO $$ DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `;

		// Drop all enums in the public schema
		await sql`
      DO $$ DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT typname FROM pg_type WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace) LOOP
          EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.typname) || ' CASCADE';
        END LOOP;
      END $$;
    `;

		// Drop all custom types in the public schema
		await sql`
      DO $$ DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT typname FROM pg_type WHERE typtype IN ('b', 'c') AND typnamespace = 'public'::regnamespace) LOOP
          EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.typname) || ' CASCADE';
        END LOOP;
      END $$;
    `;

		// Drop all sequences in the public schema
		await sql`
      DO $$ DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT sequencename FROM pg_sequences WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP SEQUENCE IF EXISTS ' || quote_ident(r.sequencename) || ' CASCADE';
        END LOOP;
      END $$;
    `;

		// Drop the drizzle schema and migrations
		await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
	} finally {
		await sql.end();
	}
}

/**
 * Apply migrations to the test database.
 */
async function applyMigrations(): Promise<void> {
	console.log("Running migrations (pnpm db:migrate) from global setup...");
	await new Promise<void>((resolve, reject) => {
		exec(
			"pnpm db:migrate",
			{ cwd: process.cwd(), env: process.env },
			(err: ExecException | null, stdout: string, stderr: string) => {
				if (stdout) process.stdout.write(stdout);
				if (stderr) process.stderr.write(stderr);
				if (err) return reject(err);
				resolve();
			},
		);
	});
}

export default async function globalSetup() {
	console.log("Running global test setup...");

	const hadDatabaseUrl = Boolean(process.env.DATABASE_URL);
	if (!hadDatabaseUrl) {
		tryLoadTestEnvFile();
	}

	// Ensure DATABASE_URL is set for both cleanup and migrations.
	// If DATABASE_URL came from `.env.test` and uses OrbStack DNS, fall back to
	// localhost when OrbStack DNS isn't available.
	const configuredUrl = process.env.DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
	const normalizedUrl = hadDatabaseUrl
		? configuredUrl
		: await maybeFallbackFromOrbStackDns(configuredUrl);
	const chosenUrl = await chooseTestDatabaseUrl(normalizedUrl);
	process.env.DATABASE_URL = chosenUrl;

	await cleanupTestDatabase(chosenUrl);
	await applyMigrations();

	// Verify ClickHouse availability (warning only, don't fail)
	await verifyClickHouse();

	console.log("Global test setup complete.");
}
