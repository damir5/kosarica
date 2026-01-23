import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createInMemoryDb } from "../index";
import {
	chains,
	ingestionRuns,
	ingestionFiles,
	ingestionErrors,
	storeItemState,
	storeItemPricePeriods,
	productMatchAudit,
} from "../schema";

describe("bigint ID type verification", () => {
	let testDb: ReturnType<typeof createInMemoryDb>;

	beforeEach(() => {
		testDb = createInMemoryDb();
		vi.clearAllMocks();
	});

	it("ingestionRuns IDs should be bigint type", async () => {
		const chain = await testDb.insert(chains).values({
			slug: "test-chain",
			name: "Test Chain",
		});

		const run = await testDb.insert(ingestionRuns).values({
			chainSlug: chain.slug,
			source: "cli",
			status: "pending",
		}).returning();

		expect(run[0]).toBeDefined();
		expect(typeof run[0].id).toBe("bigint");
	});

	it("ingestionFiles IDs should be bigint type", async () => {
		const chain = await testDb.insert(chains).values({
			slug: "file-test-chain",
			name: "File Test Chain",
		});

		const run = await testDb.insert(ingestionRuns).values({
			chainSlug: chain.slug,
			source: "cli",
			status: "completed",
		}).returning();

		const file = await testDb.insert(ingestionFiles).values({
			runId: run[0].id,
			filename: "test.csv",
			fileType: "csv",
		}).returning();

		expect(file[0]).toBeDefined();
		expect(typeof file[0].id).toBe("bigint");
	});

	it("ingestionErrors IDs should be bigint type", async () => {
		const chain = await testDb.insert(chains).values({
			slug: "error-test-chain",
			name: "Error Test Chain",
		});

		const run = await testDb.insert(ingestionRuns).values({
			chainSlug: chain.slug,
			source: "cli",
			status: "failed",
		}).returning();

		const error = await testDb.insert(ingestionErrors).values({
			runId: run[0].id,
			errorType: "parse",
			errorMessage: "Test error",
			severity: "error",
		}).returning();

		expect(error[0]).toBeDefined();
		expect(typeof error[0].id).toBe("bigint");
	});

	it("storeItemState IDs should be bigint type", async () => {
		const store = await testDb.insert(testDb.schema.stores).values({
			id: "sto-test",
			chainSlug: "store-test-chain",
			name: "Test Store",
			status: "active",
		}).returning();

		const state = await testDb.insert(storeItemState).values({
			storeId: store.id,
			currentPrice: 1999,
			inStock: true,
			priceSignature: "sig-test",
		}).returning();

		expect(state[0]).toBeDefined();
		expect(typeof state[0].id).toBe("bigint");
	});

	it("storeItemPricePeriods IDs should be bigint type", async () => {
		const store = await testDb.insert(testDb.schema.stores).values({
			id: "sto-period-test",
			chainSlug: "period-test-chain",
			name: "Period Test Store",
			status: "active",
		}).returning();

		const state = await testDb.insert(storeItemState).values({
			storeId: store.id,
			currentPrice: 1599,
			inStock: true,
			priceSignature: "sig-period-test",
		}).returning();

		const period = await testDb.insert(storeItemPricePeriods).values({
			storeItemStateId: state[0].id,
			price: 1599,
			startedAt: new Date(),
		}).returning();

		expect(period[0]).toBeDefined();
		expect(typeof period[0].id).toBe("bigint");
	});

	it("productMatchAudit IDs should be bigint type", async () => {
		const audit = await testDb.insert(productMatchAudit).values({
			queueId: "pmq-test",
			action: "created",
			newState: "{}",
		}).returning();

		expect(audit[0]).toBeDefined();
		expect(typeof audit[0].id).toBe("bigint");
	});

	it("bigint IDs should be positive integers", async () => {
		const chain = await testDb.insert(chains).values({
			slug: "positive-int-chain",
			name: "Positive Int Test Chain",
		});

		const run = await testDb.insert(ingestionRuns).values({
			chainSlug: chain.slug,
			source: "test",
			status: "completed",
		}).returning();

		expect(run[0].id).toBeDefined();
		expect(typeof run[0].id).toBe("bigint");
		expect(run[0].id).toBeGreaterThan(0n);
	});
});
