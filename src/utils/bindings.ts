import { type DatabaseType, getDatabase } from "@/db";

/**
 * Application environment configuration.
 * Loaded from process.env at runtime.
 */
export interface AppEnv {
	/** Postgres connection string */
	DATABASE_URL: string;
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
	const DATABASE_URL = process.env.DATABASE_URL;
	if (!DATABASE_URL) {
		throw new Error("DATABASE_URL environment variable is required");
	}
	return {
		DATABASE_URL,
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
