import * as fs from "node:fs";
import * as path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export async function startGoService(): Promise<void> {
	// Previously this started the Go service via docker-compose for tests.
	// Test orchestration is now handled by mise which starts the native Go binary.
	// Keep this function as a no-op to avoid accidental Docker usage in tests.
	return Promise.resolve();
}

export async function stopGoService(): Promise<void> {
	// Orchestration now handled externally by mise; no-op here.
	return Promise.resolve();
}

export function isGoServiceRunning(): boolean {
	// Tests rely on the orchestration to start the Go service on PORT.
	// We consider the service running if a PORT env var is set — tests
	// will attempt a health check against that port.
	return Boolean(process.env.PORT);
}

import { afterAll, beforeAll, vi } from "vitest";
import * as schema from "@/db/schema";

// Global test database instance
let testDb: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqlInstance: ReturnType<typeof postgres> | null = null;

/**
 * Get the test database instance.
 * Connects to a test Postgres database.
 */
export function getTestDb() {
	if (!testDb) {
		const testUrl =
			process.env.DATABASE_URL ||
			"postgresql://kosarica_test:kosarica_test@host.docker.internal:5432/kosarica_test";
		sqlInstance = postgres(testUrl);
		testDb = drizzle(sqlInstance, { schema });
	}
	return testDb;
}

/**
 * Close the test database connection.
 */
export function closeTestDb() {
	if (sqlInstance) {
		sqlInstance.end();
		sqlInstance = null;
		testDb = null;
	}
}

/**
 * Clean up the test database by dropping all tables, types, enums, and the drizzle schema.
 */
async function cleanupTestDatabase(): Promise<void> {
	const testUrl =
		process.env.DATABASE_URL ||
		"postgresql://kosarica_test:kosarica_test@host.docker.internal:5432/kosarica_test";

	// Create a separate connection for cleanup (without drizzle)
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
	const db = getTestDb();
	const migrationsFolder = path.join(process.cwd(), "drizzle");

	if (fs.existsSync(migrationsFolder)) {
		await migrate(db, { migrationsFolder });
	}
}

// Mock the getDatabase function to return test database
vi.mock("@/db", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/db")>();
	return {
		...original,
		getDatabase: () => getTestDb(),
	};
});

beforeAll(async () => {
	await cleanupTestDatabase();
	await applyMigrations();
});

afterAll(() => {
	closeTestDb();
});
