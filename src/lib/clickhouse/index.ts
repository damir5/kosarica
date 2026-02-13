import { readFile } from "node:fs/promises";
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
	 * Import a Parquet file into the prices table.
	 * Uses ClickHouse HTTP binary upload path to avoid UTF-8 corruption
	 * in Node stream-to-driver transcoding.
	 */
	async importParquetFile(filePath: string): Promise<void> {
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
			signal: AbortSignal.timeout(300_000),
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
