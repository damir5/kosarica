import { getDatabase, type DatabaseType } from "@/db";

/**
 * Application environment configuration.
 * Loaded from process.env at runtime.
 */
export interface AppEnv {
	/** Path to SQLite database file */
	DATABASE_PATH: string;
	/** Path to file storage directory */
	STORAGE_PATH: string;
	/** Better Auth secret */
	BETTER_AUTH_SECRET: string;
	/** Better Auth URL */
	BETTER_AUTH_URL: string;
	/** Passkey Relying Party ID */
	PASSKEY_RP_ID: string;
	/** Passkey Relying Party Name */
	PASSKEY_RP_NAME: string;
	/** Log level */
	LOG_LEVEL: string;
	/** Comma-separated chain IDs for scheduled ingestion */
	INGESTION_CHAINS: string;
}

/**
 * Get environment configuration.
 * Returns a typed object with all environment variables.
 */
export function getEnv(): AppEnv {
	return {
		DATABASE_PATH: process.env.DATABASE_PATH || "./data/app.db",
		STORAGE_PATH: process.env.STORAGE_PATH || "./data/storage",
		BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || "",
		BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || "http://localhost:3002",
		PASSKEY_RP_ID: process.env.PASSKEY_RP_ID || "localhost",
		PASSKEY_RP_NAME: process.env.PASSKEY_RP_NAME || "Kosarica App",
		LOG_LEVEL: process.env.LOG_LEVEL || "info",
		INGESTION_CHAINS: process.env.INGESTION_CHAINS || "",
	};
}

/**
 * Get the database instance.
 * Uses the singleton pattern from the db module.
 */
export function getDb(): DatabaseType {
	return getDatabase();
}
