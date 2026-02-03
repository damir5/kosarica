import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";
import {
	type ClickHouseClient,
	closeClickHouse,
	createClickHouse,
	getClickHouse,
} from "./index";

/**
 * ClickHouse integration tests.
 * Requires a running ClickHouse instance at CLICKHOUSE_URL.
 *
 * To run locally:
 * docker run -d --name clickhouse-local -p 8123:8123 -p 9000:9000 clickhouse/clickhouse-server:latest
 * docker exec -i clickhouse-local clickhouse-client < scripts/clickhouse-schema.sql
 */
describe("ClickHouseClient", () => {
	let client: ClickHouseClient;

	beforeAll(async () => {
		const url = process.env.CLICKHOUSE_URL;
		if (!url) {
			throw new Error(
				"CLICKHOUSE_URL environment variable is required for tests",
			);
		}

		client = createClickHouse({ url });

		// Ensure prices table exists
		const tableExists = await client.tableExists();
		if (!tableExists) {
			throw new Error(
				"prices table does not exist. Run: docker exec -i clickhouse-local clickhouse-client < scripts/clickhouse-schema.sql",
			);
		}
	});

	afterAll(async () => {
		await client.close();
	});

	beforeEach(async () => {
		// Clean up test data before each test
		await client.truncatePrices();
	});

	afterEach(async () => {
		// Clean up test data after each test for robustness
		await client.truncatePrices();
	});

	describe("tableExists", () => {
		it("should return true when prices table exists", async () => {
			const exists = await client.tableExists();
			expect(exists).toBe(true);
		});
	});

	describe("queryPrices", () => {
		it("should return empty array when no data", async () => {
			const prices = await client.queryPrices();
			expect(prices).toEqual([]);
		});

		it("should return array for query with filters", async () => {
			const prices = await client.queryPrices({
				chainSlug: "mercator",
				targetDate: "2024-03-15",
			});
			expect(Array.isArray(prices)).toBe(true);
		});

		it("should respect limit parameter", async () => {
			const prices = await client.queryPrices({ limit: 10 });
			expect(prices.length).toBeLessThanOrEqual(10);
		});
	});

	describe("countPrices", () => {
		it("should return 0 when no data", async () => {
			const count = await client.countPrices();
			expect(count).toBe(0);
		});

		it("should return 0 with filters when no matching data", async () => {
			const count = await client.countPrices({
				chainSlug: "nonexistent",
			});
			expect(count).toBe(0);
		});
	});

	describe("truncatePrices", () => {
		it("should succeed even on empty table", async () => {
			await expect(client.truncatePrices()).resolves.not.toThrow();
		});
	});
});

describe("ClickHouse singleton", () => {
	const originalEnv = process.env.CLICKHOUSE_URL;

	afterAll(async () => {
		await closeClickHouse();
		process.env.CLICKHOUSE_URL = originalEnv;
	});

	it("should return same instance on repeated calls", async () => {
		await closeClickHouse();
		process.env.CLICKHOUSE_URL = originalEnv || "http://localhost:8123";

		const client1 = getClickHouse();
		const client2 = getClickHouse();
		expect(client1).toBe(client2);
	});

	it("should throw if CLICKHOUSE_URL is not set", async () => {
		await closeClickHouse();
		delete process.env.CLICKHOUSE_URL;

		expect(() => getClickHouse()).toThrow(
			"CLICKHOUSE_URL environment variable is required",
		);
	});
});
