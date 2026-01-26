import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "../index";
import {
	chains,
	ingestionErrors,
	ingestionFiles,
	ingestionRuns,
	productMatchAudit,
	productMatchQueue,
	retailerItems,
	storeItemPricePeriods,
	storeItemState,
	stores,
} from "../schema";

describe("bigint ID type verification", () => {
	let testDb: ReturnType<typeof createInMemoryDb>;

	beforeEach(() => {
		testDb = createInMemoryDb();
		vi.clearAllMocks();
	});

	it("ingestionRuns IDs should be bigint type", async () => {
		const chain = await testDb
			.insert(chains)
			.values({
				slug: "test-chain",
				name: "Test Chain",
			})
			.returning();

		const run = await testDb
			.insert(ingestionRuns)
			.values({
				chainSlug: chain[0].slug,
				source: "cli",
				status: "pending",
			})
			.returning();

		expect(run[0]).toBeDefined();
		expect(typeof run[0].id).toBe("bigint");
	});

	it("ingestionFiles IDs should be bigint type", async () => {
		const chain = await testDb
			.insert(chains)
			.values({
				slug: "file-test-chain",
				name: "File Test Chain",
			})
			.returning();

		const run = await testDb
			.insert(ingestionRuns)
			.values({
				chainSlug: chain[0].slug,
				source: "cli",
				status: "completed",
			})
			.returning();

		const file = await testDb
			.insert(ingestionFiles)
			.values({
				runId: run[0].id,
				filename: "test.csv",
				fileType: "csv",
			})
			.returning();

		expect(file[0]).toBeDefined();
		expect(typeof file[0].id).toBe("bigint");
	});

	it("ingestionErrors IDs should be bigint type", async () => {
		const chain = await testDb
			.insert(chains)
			.values({
				slug: "error-test-chain",
				name: "Error Test Chain",
			})
			.returning();

		const run = await testDb
			.insert(ingestionRuns)
			.values({
				chainSlug: chain[0].slug,
				source: "cli",
				status: "failed",
			})
			.returning();

		const error = await testDb
			.insert(ingestionErrors)
			.values({
				runId: run[0].id,
				errorType: "parse",
				errorMessage: "Test error",
				severity: "error",
			})
			.returning();

		expect(error[0]).toBeDefined();
		expect(typeof error[0].id).toBe("bigint");
	});

	it("storeItemState IDs should be bigint type", async () => {
		const chain = await testDb
			.insert(chains)
			.values({
				slug: "store-test-chain",
				name: "Store Test Chain",
			})
			.returning();

		const store = await testDb
			.insert(stores)
			.values({
				id: "sto-test",
				chainSlug: chain[0].slug,
				name: "Test Store",
				status: "active",
			})
			.returning();

		const retailerItem = await testDb
			.insert(retailerItems)
			.values({
				id: "rit-test",
				retailerItemId: 789,
				barcode: "5555555555555",
				name: "Test Retailer Item",
			})
			.returning();

		const state = await testDb
			.insert(storeItemState)
			.values({
				storeId: store[0].id,
				retailerItemId: retailerItem[0].id,
				currentPrice: 1999,
				inStock: true,
				priceSignature: "sig-test",
			})
			.returning();

		expect(state[0]).toBeDefined();
		expect(typeof state[0].id).toBe("bigint");
	});

	it("storeItemPricePeriods IDs should be bigint type", async () => {
		const chain = await testDb
			.insert(chains)
			.values({
				slug: "period-test-chain",
				name: "Period Test Chain",
			})
			.returning();

		const store = await testDb
			.insert(stores)
			.values({
				id: "sto-period-test",
				chainSlug: chain[0].slug,
				name: "Period Test Store",
				status: "active",
			})
			.returning();

		const retailerItem = await testDb
			.insert(retailerItems)
			.values({
				id: "rit-period-test",
				retailerItemId: 456,
				barcode: "9876543210987",
				name: "Period Test Item",
			})
			.returning();

		const state = await testDb
			.insert(storeItemState)
			.values({
				storeId: store[0].id,
				retailerItemId: retailerItem[0].id,
				currentPrice: 1599,
				inStock: true,
				priceSignature: "sig-period-test",
			})
			.returning();

		const period = await testDb
			.insert(storeItemPricePeriods)
			.values({
				storeItemStateId: state[0].id,
				price: 1599,
				startedAt: new Date(),
			})
			.returning();

		expect(period[0]).toBeDefined();
		expect(typeof period[0].id).toBe("bigint");
	});

	it("productMatchAudit IDs should be bigint type", async () => {
		const retailerItem = await testDb
			.insert(retailerItems)
			.values({
				id: "rit-pmq-test",
				retailerItemId: 123,
				barcode: "1234567890123",
				name: "Match Audit Test Item",
			})
			.returning();

		const queue = await testDb
			.insert(productMatchQueue)
			.values({
				id: "pmq-test",
				retailerItemId: retailerItem[0].id,
			})
			.returning();

		const audit = await testDb
			.insert(productMatchAudit)
			.values({
				queueId: queue[0].id,
				action: "created",
				newState: "{}",
			})
			.returning();

		expect(audit[0]).toBeDefined();
		expect(typeof audit[0].id).toBe("bigint");
	});

	it("bigint IDs should be positive integers", async () => {
		const chain = await testDb
			.insert(chains)
			.values({
				slug: "positive-int-chain",
				name: "Positive Int Test Chain",
			})
			.returning();

		const run = await testDb
			.insert(ingestionRuns)
			.values({
				chainSlug: chain[0].slug,
				source: "test",
				status: "completed",
			})
			.returning();

		expect(run[0].id).toBeDefined();
		expect(typeof run[0].id).toBe("bigint");
		expect(run[0].id).toBeGreaterThan(0n);
	});
});
