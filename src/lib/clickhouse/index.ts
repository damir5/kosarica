import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
	type ClickHouseClient as CHClient,
	createClient,
} from "@clickhouse/client";

export { parseNumber } from "./utils";

/**
 * Row structure for price data in ClickHouse.
 */
export interface PriceRow {
	target_date: string;
	chain_slug: string;
	store_id: string;
	retailer_item_id: string;
	external_id?: string | null;
	name: string;
	barcode?: string | null;
	price_cents?: number | null;
	price_status?: "available" | "unavailable" | null;
	price_unavailable_reason?: "missing" | "invalid" | "non_positive" | null;
	discount_price_cents?: number | null;
	unit_price_cents?: number | null;
	category?: string | null;
	brand?: string | null;
}

/**
 * Configuration for ClickHouse client.
 */
export interface ClickHouseConfig {
	url: string;
	database?: string;
	username?: string;
	password?: string;
}

/**
 * Options for querying prices.
 */
export interface QueryPricesOptions {
	chainSlug?: string;
	targetDate?: string;
	storeId?: string;
	limit?: number;
	offset?: number;
}

type ClickHouseImportMode = "http" | "infile";

function escapeSqlString(value: string): string {
	return value.replace(/'/g, "''");
}

function toBasicAuthHeader(config: ClickHouseConfig): string | null {
	if (!config.username) {
		return null;
	}
	const password = config.password ?? "";
	const token = Buffer.from(`${config.username}:${password}`).toString("base64");
	return `Basic ${token}`;
}

function buildParquetInsertUrl(config: ClickHouseConfig): URL {
	const url = new URL(config.url);
	url.searchParams.set("query", "INSERT INTO prices FORMAT Parquet");
	url.searchParams.set("database", config.database ?? "default");
	return url;
}

function parseImportTimeoutMs(): number {
	const raw = process.env.CLICKHOUSE_IMPORT_TIMEOUT_MS;
	if (!raw) {
		return 30 * 60 * 1000;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return 30 * 60 * 1000;
	}
	return parsed;
}

function parseImportMode(): ClickHouseImportMode {
	const raw = process.env.CLICKHOUSE_IMPORT_MODE?.trim().toLowerCase();
	if (raw === "infile") {
		return "infile";
	}
	return "http";
}

function parseUserFilesSubdir(): string {
	const raw = process.env.CLICKHOUSE_USER_FILES_SUBDIR ?? "storage";
	return raw.replace(/^\/+|\/+$/g, "");
}

function toUserFilesParquetPath(filePath: string): string {
	const storageRoot = resolve(process.env.STORAGE_PATH ?? "./data/storage");
	const absoluteFilePath = resolve(filePath);
	const relativePath = relative(storageRoot, absoluteFilePath);
	if (
		relativePath === "" ||
		relativePath.startsWith("..") ||
		isAbsolute(relativePath)
	) {
		throw new Error(
			`Parquet path ${filePath} is outside STORAGE_PATH (${storageRoot})`,
		);
	}

	const unixRelative = relativePath.split(sep).join("/");
	const subdir = parseUserFilesSubdir();
	return subdir ? `${subdir}/${unixRelative}` : unixRelative;
}

/**
 * ClickHouse client wrapper for price data operations.
 */
export class ClickHouseClient {
	constructor(
		private client: CHClient,
		private config: ClickHouseConfig,
	) {}

	/**
	 * Run a raw query and return JSONEachRow results.
	 */
	async query<T>(
		query: string,
		params?: Record<string, string | number | string[]>,
		settings?: Record<string, string | number>,
	): Promise<T[]> {
		const result = await this.client.query({
			query,
			query_params: params,
			format: "JSONEachRow",
			clickhouse_settings: settings,
		});

		return (await result.json()) as T[];
	}

	/**
	 * Run a DDL or DML command that returns no result set.
	 * Accepts optional query params and ClickHouse settings separately.
	 */
	async command(
		query: string,
		params?: Record<string, string | number | string[]>,
		settings?: Record<string, string | number>,
	): Promise<void> {
		await this.client.command({
			query,
			query_params: params as Record<string, unknown>,
			clickhouse_settings: settings,
		});
	}

	/**
	 * Import a Parquet file into the prices table.
	 * Supports two modes:
	 * - `http` (default): binary upload over HTTP
	 * - `infile`: server-side import from ClickHouse user_files mount
	 */
	async importParquetFile(filePath: string): Promise<void> {
		if (parseImportMode() === "infile") {
			await this.importParquetFileViaUserFiles(filePath);
			return;
		}
		await this.importParquetFileViaHttp(filePath);
	}

	private async importParquetFileViaUserFiles(filePath: string): Promise<void> {
		const userFilesPath = toUserFilesParquetPath(filePath);
		const safePath = escapeSqlString(userFilesPath);
		await this.client.command({
			query: `INSERT INTO prices SELECT * FROM file('${safePath}', 'Parquet')`,
		});
	}

	private async importParquetFileViaHttp(filePath: string): Promise<void> {
		const payload = await readFile(filePath);
		const url = buildParquetInsertUrl(this.config);
		const authHeader = toBasicAuthHeader(this.config);
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "application/octet-stream",
				...(authHeader ? { authorization: authHeader } : {}),
			},
			body: payload,
			signal: AbortSignal.timeout(parseImportTimeoutMs()),
		});

		if (!response.ok) {
			const errorBody = (await response.text()).slice(0, 1000);
			throw new Error(
				`ClickHouse parquet import failed (${response.status} ${response.statusText}): ${errorBody}`,
			);
		}
	}

	/**
	 * Query prices with optional filters.
	 */
	async queryPrices(options?: QueryPricesOptions): Promise<PriceRow[]> {
		const conditions: string[] = [];
		const params: Record<string, string | number> = {};

		if (options?.chainSlug) {
			conditions.push("chain_slug = {chainSlug:String}");
			params.chainSlug = options.chainSlug;
		}

		if (options?.targetDate) {
			conditions.push("target_date = {targetDate:Date}");
			params.targetDate = options.targetDate;
		}

		if (options?.storeId) {
			conditions.push("store_id = {storeId:String}");
			params.storeId = options.storeId;
		}

		let query = "SELECT * FROM prices";
		if (conditions.length > 0) {
			query += ` WHERE ${conditions.join(" AND ")}`;
		}

		query += " ORDER BY target_date DESC, chain_slug, store_id";

		if (options?.limit) {
			query += " LIMIT {limit:UInt32}";
			params.limit = options.limit;
		}

		if (options?.offset) {
			query += " OFFSET {offset:UInt32}";
			params.offset = options.offset;
		}

		const result = await this.client.query({
			query,
			query_params: params,
			format: "JSONEachRow",
		});

		return (await result.json()) as PriceRow[];
	}

	/**
	 * Get the count of prices matching optional filters.
	 */
	async countPrices(
		options?: Omit<QueryPricesOptions, "limit" | "offset">,
	): Promise<number> {
		const conditions: string[] = [];
		const params: Record<string, string> = {};

		if (options?.chainSlug) {
			conditions.push("chain_slug = {chainSlug:String}");
			params.chainSlug = options.chainSlug;
		}

		if (options?.targetDate) {
			conditions.push("target_date = {targetDate:Date}");
			params.targetDate = options.targetDate;
		}

		if (options?.storeId) {
			conditions.push("store_id = {storeId:String}");
			params.storeId = options.storeId;
		}

		let query = "SELECT count() as count FROM prices";
		if (conditions.length > 0) {
			query += ` WHERE ${conditions.join(" AND ")}`;
		}

		const result = await this.client.query({
			query,
			query_params: params,
			format: "JSONEachRow",
		});

		const rows = (await result.json()) as { count: string }[];
		return parseInt(rows[0]?.count || "0", 10);
	}

	/**
	 * Truncate all data from the prices table.
	 */
	async truncatePrices(): Promise<void> {
		await this.client.command({
			query: "TRUNCATE TABLE prices",
		});
	}

	/**
	 * Delete one chain/day snapshot so it can be re-imported from refreshed parquet.
	 * Uses lightweight DELETE and waits synchronously for mutation completion.
	 */
	async deleteSnapshot(chainSlug: string, targetDate: string): Promise<void> {
		const safeChainSlug = escapeSqlString(chainSlug);
		const safeTargetDate = escapeSqlString(targetDate);
		await this.client.command({
			query: `DELETE FROM prices WHERE chain_slug = '${safeChainSlug}' AND target_date = toDate('${safeTargetDate}')`,
			clickhouse_settings: {
				mutations_sync: "1",
			},
		});
	}

	/**
	 * Check if the prices table exists.
	 */
	async tableExists(): Promise<boolean> {
		const result = await this.client.query({
			query: "EXISTS TABLE prices",
			format: "JSONEachRow",
		});

		const rows = (await result.json()) as { result: number }[];
		return rows[0]?.result === 1;
	}

	/**
	 * Close the client connection.
	 */
	async close(): Promise<void> {
		await this.client.close();
	}
}

// Singleton client instance
let clientInstance: ClickHouseClient | null = null;
let rawClient: CHClient | null = null;

/**
 * Get or create the ClickHouse client instance.
 * Uses CLICKHOUSE_URL environment variable for connection.
 */
export function getClickHouse(): ClickHouseClient {
	if (clientInstance) {
		return clientInstance;
	}

	const url = process.env.CLICKHOUSE_URL;
	if (!url) {
		throw new Error("CLICKHOUSE_URL environment variable is required");
	}

	rawClient = createClient({
		url,
		database: process.env.CLICKHOUSE_DATABASE || "default",
		username: process.env.CLICKHOUSE_USERNAME,
		password: process.env.CLICKHOUSE_PASSWORD,
		request_timeout: 30_000,
		clickhouse_settings: {
			max_execution_time: 25,
		},
	});

	clientInstance = new ClickHouseClient(rawClient, {
		url,
		database: process.env.CLICKHOUSE_DATABASE || "default",
		username: process.env.CLICKHOUSE_USERNAME,
		password: process.env.CLICKHOUSE_PASSWORD,
	});
	return clientInstance;
}

/**
 * Create a new ClickHouse client with specific configuration.
 * Useful for testing or CLI tools.
 */
export function createClickHouse(config: ClickHouseConfig): ClickHouseClient {
	const client = createClient({
		url: config.url,
		database: config.database || "default",
		username: config.username,
		password: config.password,
	});

	return new ClickHouseClient(client, {
		url: config.url,
		database: config.database || "default",
		username: config.username,
		password: config.password,
	});
}

/**
 * Close the singleton ClickHouse client.
 */
export async function closeClickHouse(): Promise<void> {
	if (clientInstance) {
		await clientInstance.close();
		clientInstance = null;
		rawClient = null;
	}
}

// Batch client singleton — long timeouts for refresh/rebuild operations
let batchClientInstance: ClickHouseClient | null = null;
let rawBatchClient: CHClient | null = null;

/**
 * Get or create a ClickHouse client with extended timeouts for batch operations
 * (refresh, rebuild, heavy aggregation). Uses 10-min request timeout and
 * 5-min server-side max_execution_time.
 */
export function getClickHouseBatch(): ClickHouseClient {
	if (batchClientInstance) {
		return batchClientInstance;
	}

	const url = process.env.CLICKHOUSE_URL;
	if (!url) {
		throw new Error("CLICKHOUSE_URL environment variable is required");
	}

	rawBatchClient = createClient({
		url,
		database: process.env.CLICKHOUSE_DATABASE || "default",
		username: process.env.CLICKHOUSE_USERNAME,
		password: process.env.CLICKHOUSE_PASSWORD,
		request_timeout: 600_000, // 10 minutes
		clickhouse_settings: {
			max_execution_time: 300, // 5 minutes
		},
	});

	batchClientInstance = new ClickHouseClient(rawBatchClient, {
		url,
		database: process.env.CLICKHOUSE_DATABASE || "default",
		username: process.env.CLICKHOUSE_USERNAME,
		password: process.env.CLICKHOUSE_PASSWORD,
	});
	return batchClientInstance;
}

/**
 * Close the batch ClickHouse client.
 */
export async function closeClickHouseBatch(): Promise<void> {
	if (batchClientInstance) {
		await batchClientInstance.close();
		batchClientInstance = null;
		rawBatchClient = null;
	}
}
