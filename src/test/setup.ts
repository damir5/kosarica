import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, vi } from "vitest";
import * as schema from "@/db/schema";

// Note: For integration tests requiring the Go price service,
// use `mise run test-service` to start the Go service natively.
// The Go service runs via `go run` for development and testing.

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
			"postgresql://kosarica_test:kosarica_test@localhost:5432/kosarica_test";
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

// Mock the getDatabase function to return test database
vi.mock("@/db", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/db")>();
	return {
		...original,
		getDatabase: () => getTestDb(),
	};
});

afterAll(() => {
	closeTestDb();
});
