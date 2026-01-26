import * as fs from "node:fs";
import * as path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, vi } from "vitest";
import * as schema from "@/db/schema";

// Start/stop helpers for external Go service (not used in main CI flow but
// handy for local debugging)
export async function startGoService(): Promise<void> {
	console.log("Starting Go price service for integration tests...");
	const spawn = require("child_process").spawn;
	const dockerProcess = spawn(
		"docker",
		["compose", "up", "-d", "price-service"],
		{
			stdio: "inherit",
		},
	);

	return new Promise((resolve, reject) => {
		let retries = 0;
		const maxRetries = 30;
		const healthCheck = setInterval(async () => {
			try {
				const response = await fetch("http://localhost:8080/health");
				if (response.ok) {
					clearInterval(healthCheck);
					resolve();
					return;
				}
			} catch (error) {
				retries++;
				if (retries >= maxRetries) {
					clearInterval(healthCheck);
					reject(
						new Error(
							"Go service failed to start after " + maxRetries + " attempts",
						),
					);
					return;
				}
			}
		}, 1000);

		dockerProcess.on("error", (error: any) => {
			clearInterval(healthCheck);
			reject(error);
		});
	});
}

export async function stopGoService(): Promise<void> {
	console.log("Stopping Go price service...");
	const { execSync } = require("child_process");
	try {
		execSync("docker compose down price-service", { stdio: "inherit" });
		console.log("Go service stopped successfully");
	} catch (error) {
		console.error("Failed to stop Go service:", error);
	}
}

export function isGoServiceRunning(): boolean {
	return process.env.GO_SERVICE_FOR_TESTS === "1";
}

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
		console.log("Running migrations (pnpm db:migrate) from test setup...");
		const { exec } = await import("node:child_process");
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
