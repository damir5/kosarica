import * as fs from "node:fs";
import * as path from "node:path";
import { migrate } from "drizzle-kit/migrate";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

/**
 * Clean up test database by dropping all tables, types, enums, sequences.
 * Note: We use existing migrations to avoid schema creation errors.
 */
async function applyMigrations(): Promise<void> {
	const db = getTestDb();

	// Apply migrations - skip schema creation to avoid permission errors
	if (fs.existsSync(migrationsFolder)) {
		// Run drizzle-kit migrate directly
		console.log("Running migrations...");
		const { run } = await import("drizzle-kit/migrate");
		await run({
			migrationsFolder,
		});
		console.log("Migrations applied");
	} else {
		console.log("No migrations to apply");
	}
}

/**
 * Apply migrations to test database.
 */
async function applyMigrations(): Promise<void> {
	const db = getTestDb();

	// Apply migrations without schema creation
	const migrationsFolder = path.join(process.cwd(), "drizzle");

	if (fs.existsSync(migrationsFolder)) {
		// Run migrate command which will apply any pending migrations
		console.log("Running migrations...");
		await migrate({
			migrationsFolder,
			migrationsTable: "drizzle_migrations",
		});
		console.log("Migrations applied");
	} else {
		console.log("No migrations to apply");
	}
}
