import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type DatabaseType = ReturnType<typeof drizzle<typeof schema>>;

// Singleton database instance
let dbInstance: DatabaseType | null = null;
let sqliteInstance: Database.Database | null = null;

/**
 * Get or create the database instance.
 * Uses DATABASE_PATH environment variable for the SQLite file location.
 */
export function getDatabase(): DatabaseType {
	if (dbInstance) {
		return dbInstance;
	}

	const dbPath = process.env.DATABASE_PATH || "./data/app.db";
	sqliteInstance = new Database(dbPath);

	// Enable WAL mode for better concurrency
	sqliteInstance.pragma("journal_mode = WAL");
	// Enable foreign keys
	sqliteInstance.pragma("foreign_keys = ON");

	dbInstance = drizzle(sqliteInstance, { schema });
	return dbInstance;
}

/**
 * Create a new database instance with a specific path.
 * Useful for testing or CLI tools.
 */
export function createDb(dbPath: string): DatabaseType {
	const sqlite = new Database(dbPath);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	return drizzle(sqlite, { schema });
}

/**
 * Create an in-memory database for testing.
 */
export function createInMemoryDb(): DatabaseType {
	const sqlite = new Database(":memory:");
	sqlite.pragma("foreign_keys = ON");
	return drizzle(sqlite, { schema });
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
	if (sqliteInstance) {
		sqliteInstance.close();
		sqliteInstance = null;
		dbInstance = null;
	}
}

// Re-export store query helpers
export * from "./queries/stores";
// Re-export schema for convenience
export * from "./schema";
