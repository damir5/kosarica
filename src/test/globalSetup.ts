import { exec } from "node:child_process";
import postgres from "postgres";

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
			(err: any, stdout: string, stderr: string) => {
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
		"postgresql://kosarica_test:kosarica_test@localhost:5432/kosarica_test";
	process.env.DATABASE_URL = testUrl;

	await cleanupTestDatabase();
	await applyMigrations();
	console.log("Global test setup complete.");
}
