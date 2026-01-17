import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeAll, afterAll, vi } from "vitest";
import * as schema from "@/db/schema";

// Global test database instance
let testDb: ReturnType<typeof drizzle> | null = null;
let sqliteDb: Database.Database | null = null;

/**
 * Get the test database instance.
 * Creates an in-memory SQLite database for tests.
 */
export function getTestDb() {
	if (!testDb) {
		sqliteDb = new Database(":memory:");
		sqliteDb.pragma("foreign_keys = ON");
		testDb = drizzle(sqliteDb, { schema });
	}
	return testDb;
}

/**
 * Close the test database connection.
 */
export function closeTestDb() {
	if (sqliteDb) {
		sqliteDb.close();
		sqliteDb = null;
		testDb = null;
	}
}

/**
 * Apply migrations to the test database.
 */
async function applyMigrations(): Promise<void> {
	const db = getTestDb();
	const migrationsFolder = path.join(process.cwd(), "drizzle");

	if (fs.existsSync(migrationsFolder)) {
		migrate(db, { migrationsFolder });
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
	await applyMigrations();
});

afterAll(() => {
	closeTestDb();
});
