import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, vi } from "vitest";
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
