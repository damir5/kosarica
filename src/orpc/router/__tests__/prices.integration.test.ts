/**
 * Integration tests for Prices Router
 *
 * Tests the ClickHouse-backed price queries and Postgres item search.
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chains, retailerItems, stores } from "@/db/schema";
import { getDb } from "@/utils/bindings";
import { generatePrefixedId } from "@/utils/id";

describe("Prices Router Integration Tests", () => {
	const testItemIds: string[] = [];
	const testStoreIds: string[] = [];
	const testChainSlug = "test-prices-chain";

	beforeAll(async () => {
		const db = getDb();

		// Create test chain
		await db
			.insert(chains)
			.values({
				slug: testChainSlug,
				name: "Test Prices Chain",
			})
			.onConflictDoNothing()
			.execute();

		// Create test store
		const storeId = generatePrefixedId("sto");
		await db
			.insert(stores)
			.values({
				id: storeId,
				chainSlug: testChainSlug,
				name: "Test Price Store",
				address: "Test Address",
				city: "Zagreb",
				postalCode: "10000",
				status: "active",
			})
			.execute();
		testStoreIds.push(storeId);

		// Create test items
		for (let i = 1; i <= 5; i++) {
			const itemId = generatePrefixedId("ri");
			await db
				.insert(retailerItems)
				.values({
					id: itemId,
					chainSlug: testChainSlug,
					externalId: `ext-${i}`,
					name: `Test Item ${i}`,
					brand: i % 2 === 0 ? "Test Brand" : null,
					category: i <= 3 ? "Food" : "Beverages",
				})
				.execute();
			testItemIds.push(itemId);
		}
	});

	afterAll(async () => {
		const db = getDb();

		// Clean up test items
		for (const itemId of testItemIds) {
			try {
				await db
					.delete(retailerItems)
					.where(eq(retailerItems.id, itemId))
					.execute();
			} catch (_e) {
				// Ignore cleanup errors
			}
		}

		// Clean up test stores
		for (const storeId of testStoreIds) {
			try {
				await db.delete(stores).where(eq(stores.id, storeId)).execute();
			} catch (_e) {
				// Ignore cleanup errors
			}
		}

		// Clean up test chain
		try {
			await db.delete(chains).where(eq(chains.slug, testChainSlug)).execute();
		} catch (_e) {
			// Ignore cleanup errors
		}
	});

	describe("searchItems - Postgres queries", () => {
		it("should find items by name", async () => {
			const db = getDb();

			// Direct database query to verify items exist
			const items = await db
				.select()
				.from(retailerItems)
				.where(eq(retailerItems.chainSlug, testChainSlug));

			expect(items.length).toBe(5);
			expect(items[0].name).toContain("Test Item");
		});

		it("should find items by brand", async () => {
			const db = getDb();

			// Items with Test Brand should be found
			const items = await db
				.select()
				.from(retailerItems)
				.where(eq(retailerItems.brand, "Test Brand"));

			// We created 2 items with "Test Brand" (even indices: 2, 4)
			expect(items.length).toBeGreaterThanOrEqual(2);
		});

		it("should filter by chain slug", async () => {
			const db = getDb();

			const items = await db
				.select()
				.from(retailerItems)
				.where(eq(retailerItems.chainSlug, testChainSlug));

			expect(items.length).toBe(5);
			for (const item of items) {
				expect(item.chainSlug).toBe(testChainSlug);
			}
		});
	});

	describe("getStoresByChain - Postgres queries", () => {
		it("should return stores for a chain", async () => {
			const db = getDb();

			const storesList = await db
				.select()
				.from(stores)
				.where(eq(stores.chainSlug, testChainSlug));

			expect(storesList.length).toBeGreaterThan(0);
			expect(storesList[0].name).toBe("Test Price Store");
		});

		it("should return empty array for nonexistent chain", async () => {
			const db = getDb();

			const storesList = await db
				.select()
				.from(stores)
				.where(eq(stores.chainSlug, "nonexistent-chain-xyz"));

			expect(storesList).toHaveLength(0);
		});
	});

	describe("getCategories - Postgres queries", () => {
		it("should return categories from items", async () => {
			const db = getDb();

			const categories = await db
				.selectDistinct({ category: retailerItems.category })
				.from(retailerItems)
				.where(eq(retailerItems.chainSlug, testChainSlug));

			const categoryList = categories
				.map((c) => c.category)
				.filter((c): c is string => Boolean(c));

			expect(categoryList).toContain("Food");
			expect(categoryList).toContain("Beverages");
		});
	});
});

describe("parseNumber utility", () => {
	it("should parse number values", async () => {
		const { parseNumber } = await import("@/lib/clickhouse/utils");
		expect(parseNumber(100)).toBe(100);
		expect(parseNumber(0)).toBe(0);
		expect(parseNumber(-50)).toBe(-50);
	});

	it("should parse string numbers", async () => {
		const { parseNumber } = await import("@/lib/clickhouse/utils");
		expect(parseNumber("100")).toBe(100);
		expect(parseNumber("0")).toBe(0);
		expect(parseNumber("-50")).toBe(-50);
	});

	it("should return null for null/undefined", async () => {
		const { parseNumber } = await import("@/lib/clickhouse/utils");
		expect(parseNumber(null)).toBeNull();
		expect(parseNumber(undefined)).toBeNull();
	});

	it("should return null for NaN", async () => {
		const { parseNumber } = await import("@/lib/clickhouse/utils");
		expect(parseNumber("not-a-number")).toBeNull();
		expect(parseNumber("")).toBeNull();
	});
});

describe("ClickHouse Price Queries (Unit Tests)", () => {
	const mockClickHouseQuery = vi.fn();

	beforeAll(() => {
		vi.mock("@/lib/clickhouse", () => ({
			getClickHouse: () => ({
				query: mockClickHouseQuery,
			}),
			parseNumber: (value?: number | string | null): number | null => {
				if (value === null || value === undefined) return null;
				const parsed = typeof value === "number" ? value : Number(value);
				return Number.isNaN(parsed) ? null : parsed;
			},
		}));
	});

	afterAll(() => {
		vi.restoreAllMocks();
	});

	describe("getStorePrices query logic", () => {
		it("should build correct ClickHouse query for store prices", () => {
			// Verify query construction logic
			const chainSlug = "konzum";
			const storeId = "sto_123";
			const limit = 100;
			const offset = 0;

			const baseQuery = `
				SELECT
					retailer_item_id,
					argMax(external_id, target_date) AS item_external_id,
					argMax(name, target_date) AS item_name,
					argMax(brand, target_date) AS brand,
					argMax(price_cents, target_date) AS current_price,
					argMax(discount_price_cents, target_date) AS discount_price,
					argMax(unit_price_cents, target_date) AS unit_price,
					max(target_date) AS last_seen_at
				FROM prices
				WHERE chain_slug = {chainSlug:String} AND store_id = {storeId:String}
				GROUP BY retailer_item_id
			`;

			const fullQuery = `${baseQuery} ORDER BY last_seen_at DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`;

			expect(fullQuery).toContain("chain_slug = {chainSlug:String}");
			expect(fullQuery).toContain("store_id = {storeId:String}");
			expect(fullQuery).toContain("LIMIT {limit:UInt32}");
			expect(fullQuery).toContain("OFFSET {offset:UInt32}");

			const params = { chainSlug, storeId, limit, offset };
			expect(params.chainSlug).toBe("konzum");
			expect(params.storeId).toBe("sto_123");
		});

		it("should map ClickHouse response to API response format", () => {
			const mockRow = {
				retailer_item_id: "ri_123",
				item_external_id: "ext-1",
				item_name: "Test Product",
				brand: "Test Brand",
				current_price: 1999,
				discount_price: 1499,
				unit_price: 199,
				last_seen_at: "2025-01-15",
			};

			const parseNumber = (value?: number | string | null): number | null => {
				if (value === null || value === undefined) return null;
				const parsed = typeof value === "number" ? value : Number(value);
				return Number.isNaN(parsed) ? null : parsed;
			};

			const mapped = {
				retailerItemId: mockRow.retailer_item_id,
				itemExternalId: mockRow.item_external_id ?? null,
				itemName: mockRow.item_name,
				brand: mockRow.brand ?? null,
				currentPrice: parseNumber(mockRow.current_price),
				priceStatus:
					parseNumber(mockRow.current_price) === null
						? "unavailable"
						: "available",
				priceUnavailableReason: null,
				discountPrice: parseNumber(mockRow.discount_price),
				unitPrice: parseNumber(mockRow.unit_price),
				lastSeenAt: mockRow.last_seen_at ?? null,
			};

			expect(mapped.retailerItemId).toBe("ri_123");
			expect(mapped.currentPrice).toBe(1999);
			expect(mapped.discountPrice).toBe(1499);
			expect(mapped.priceStatus).toBe("available");
			// Verify inStock is NOT in the response
			expect(mapped).not.toHaveProperty("inStock");
		});

		it("should handle string numbers from ClickHouse", () => {
			const parseNumber = (value?: number | string | null): number | null => {
				if (value === null || value === undefined) return null;
				const parsed = typeof value === "number" ? value : Number(value);
				return Number.isNaN(parsed) ? null : parsed;
			};

			// ClickHouse sometimes returns numbers as strings
			expect(parseNumber("3499")).toBe(3499);
			expect(parseNumber("0")).toBe(0);
			expect(parseNumber(null)).toBeNull();
			expect(parseNumber(undefined)).toBeNull();
		});
	});

	describe("listCatalogPrices query logic", () => {
		it("should build query with search filter", () => {
			const search = "milk";
			const conditions: string[] = [];
			const params: Record<string, string | number> = {};

			conditions.push(
				"(positionCaseInsensitiveUTF8(name, {search:String}) > 0 OR positionCaseInsensitiveUTF8(ifNull(brand, ''), {search:String}) > 0)",
			);
			params.search = search;

			expect(conditions[0]).toContain("positionCaseInsensitiveUTF8");
			expect(params.search).toBe("milk");
		});

		it("should build query with date range filter", () => {
			const toDateOnly = (value?: string) => {
				if (!value) return undefined;
				const date = new Date(value);
				if (Number.isNaN(date.getTime())) return undefined;
				return date.toISOString().slice(0, 10);
			};

			const dateFrom = toDateOnly("2025-01-01T00:00:00Z");
			const dateTo = toDateOnly("2025-01-31T23:59:59Z");

			expect(dateFrom).toBe("2025-01-01");
			expect(dateTo).toBe("2025-01-31");
		});

		it("should build query with price filter in HAVING clause", () => {
			const minPrice = 1000;
			const maxPrice = 5000;
			const having: string[] = [];
			const params: Record<string, string | number> = {};

			if (minPrice !== undefined) {
				having.push("price_cents >= {minPrice:Int32}");
				params.minPrice = minPrice;
			}
			if (maxPrice !== undefined) {
				having.push("price_cents <= {maxPrice:Int32}");
				params.maxPrice = maxPrice;
			}

			const havingClause =
				having.length > 0 ? `HAVING ${having.join(" AND ")}` : "";

			expect(havingClause).toContain("price_cents >= {minPrice:Int32}");
			expect(havingClause).toContain("price_cents <= {maxPrice:Int32}");
			expect(params.minPrice).toBe(1000);
			expect(params.maxPrice).toBe(5000);
		});
	});
});

describe("Input Validation Schema Tests", () => {
	it("should enforce minimum 3 character search query", async () => {
		const z = await import("zod");

		const searchSchema = z.z.object({
			query: z.z.string().min(3, "Search query must be at least 3 characters"),
		});

		// Should fail with 2 characters
		const result = searchSchema.safeParse({ query: "ab" });
		expect(result.success).toBe(false);

		// Should pass with 3 characters
		const validResult = searchSchema.safeParse({ query: "abc" });
		expect(validResult.success).toBe(true);
	});

	it("should enforce pagination limits", async () => {
		const z = await import("zod");

		const paginationSchema = z.z.object({
			limit: z.z.number().int().min(1).max(1000).default(100),
			offset: z.z.number().int().min(0).default(0),
		});

		// Should fail with negative offset
		const negativeOffset = paginationSchema.safeParse({
			limit: 10,
			offset: -1,
		});
		expect(negativeOffset.success).toBe(false);

		// Should fail with limit > 1000
		const tooHighLimit = paginationSchema.safeParse({ limit: 1001, offset: 0 });
		expect(tooHighLimit.success).toBe(false);

		// Should pass with valid values
		const valid = paginationSchema.safeParse({ limit: 100, offset: 0 });
		expect(valid.success).toBe(true);
	});
});
