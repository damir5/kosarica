import type { ExecException } from "node:child_process";
import { exec } from "node:child_process";
import postgres from "postgres";

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
				"  ClickHouse integration tests may fail. Run 'mise run services-up' to start services.",
			);
		}
	} catch {
		console.warn(`WARNING: ClickHouse not available at ${clickhouseUrl}`);
		console.warn(
			"  ClickHouse integration tests may fail. Run 'mise run services-up' to start services.",
		);
	}
}

/**
 * Clean up the test database by dropping all tables, types, enums, and the drizzle schema.
 */
async function cleanupTestDatabase(): Promise<void> {
	const testUrl =
		process.env.DATABASE_URL ||
		"postgresql://kosarica_test:kosarica_test@localhost:5432/kosarica_test";

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

	// Ensure DATABASE_URL is set for both cleanup and migrations
	const testUrl =
		process.env.DATABASE_URL ||
		"postgresql://kosarica_test:kosarica_test@ade-postgres-test.orb.local:5432/kosarica_test";
	process.env.DATABASE_URL = testUrl;

	await cleanupTestDatabase();
	await applyMigrations();

	// Verify ClickHouse availability (warning only, don't fail)
	await verifyClickHouse();

	console.log("Global test setup complete.");
}
