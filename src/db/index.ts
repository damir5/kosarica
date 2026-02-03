import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DatabaseType = PostgresJsDatabase<typeof schema>;

let dbInstance: DatabaseType | null = null;
let sqlInstance: ReturnType<typeof postgres> | null = null;

/**
 * Get or create the database instance.
 * Uses DATABASE_URL environment variable for the Postgres connection string.
 */
export function getDatabase(): DatabaseType {
	if (dbInstance) {
		return dbInstance;
	}

	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error("DATABASE_URL environment variable is required");
	}

	// Configure connection pool to prevent connection exhaustion
	// See: https://github.com/porsager/postgres#connection-pool
	const poolMax = process.env.DB_POOL_MAX
		? parseInt(process.env.DB_POOL_MAX, 10)
		: 10;
	sqlInstance = postgres(connectionString, {
		max: poolMax, // Maximum connections in the pool
		idle_timeout: 20, // Close idle connections after 20 seconds
		connect_timeout: 10, // Connection timeout in seconds
	});

	dbInstance = drizzle(sqlInstance, { schema });
	return dbInstance;
}

/**
 * Create a new database instance with a specific connection string.
 * Useful for testing or CLI tools.
 */
export function createDb(connectionString: string): DatabaseType {
	const sql = postgres(connectionString);
	return drizzle(sql, { schema });
}

/**
 * Create an in-memory database for testing.
 * For Postgres, this connects to a test database.
 */
export function createInMemoryDb(): DatabaseType {
	const testUrl =
		process.env.DATABASE_URL ||
		"postgresql://kosarica_test:kosarica_test@localhost:5432/kosarica_test";
	return createDb(testUrl);
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
	if (sqlInstance) {
		sqlInstance.end();
		sqlInstance = null;
		dbInstance = null;
	}
}

// Re-export schema for convenience
export * from "./schema";
