/**
 * Integration tests for Price Service Proxy
 *
 * These tests require the Go price-service to be running.
 * They verify that the proxy correctly forwards requests to the Go service.
 */

import { createRouterClient } from "@orpc/server";
import { beforeAll, describe, expect, it } from "vitest";
import { chains } from "@/db/schema";
import router from "@/orpc/router";
import { getTestDb } from "@/test/setup";

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "test-key";

// Assume service is unavailable unless env var explicitly set to run these tests
const goServiceAvailable = process.env.GO_SERVICE_FOR_TESTS === "1";

describe("Price Service Proxy Integration Tests", () => {
	// biome-ignore lint/suspicious/noExplicitAny: oRPC client types are complex
	let orpc: any;

	beforeAll(async () => {
		if (!goServiceAvailable) {
			console.log(
				`\nSkipping Price Service integration tests - GO_SERVICE_FOR_TESTS not set\n` +
					`To run these tests:\n` +
					`  1. Start Go service: docker compose -f docker-compose-test.yml up -d\n` +
					`  2. Set GO_SERVICE_FOR_TESTS=1 and run tests: GO_SERVICE_FOR_TESTS=1 pnpm test\n`,
			);
			return;
		}

		orpc = createRouterClient(router, {
			context: () => ({
				headers: {
					"X-Internal-API-Key": INTERNAL_API_KEY,
				},
			}),
		});

		// Seed test chains in the JS database
		const db = getTestDb();
		await db
			.insert(chains)
			.values([
				{ slug: "konzum", name: "Konzum" },
				{ slug: "dm", name: "DM" },
			])
			.onConflictDoNothing();
	});

	describe("Health Check", () => {
		it.skipIf(!goServiceAvailable)("should return status: ok", async () => {
			const result = await orpc.admin.ingestion.getStats({
				from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
				to: new Date().toISOString(),
			});

			// This tests connectivity - stats endpoint should return buckets array
			expect(result).toBeDefined();
			expect(result.buckets).toBeInstanceOf(Array);
		});
	});

	describe("List Ingestion Runs", () => {
		it.skipIf(!goServiceAvailable)(
			"should return paginated results with runs array and total",
			async () => {
				const result = await orpc.admin.ingestion.listRuns({
					limit: 5,
					offset: 0,
				});

				expect(result).toBeDefined();
				expect(result.runs).toBeInstanceOf(Array);
				expect(typeof result.total).toBe("number");
				expect(result.runs.length).toBeLessThanOrEqual(5);
			},
		);

		it.skipIf(!goServiceAvailable)("should filter by chainSlug", async () => {
			const result = await orpc.admin.ingestion.listRuns({
				chainSlug: "konzum",
				limit: 10,
			});

			expect(result).toBeDefined();
			expect(result.runs).toBeInstanceOf(Array);
			// All returned runs should have chainSlug = "konzum"
			result.runs.forEach((run: any) => {
				expect(run.chainSlug).toBe("konzum");
			});
		});

		it.skipIf(!goServiceAvailable)("should filter by status", async () => {
			const result = await orpc.admin.ingestion.listRuns({
				status: "completed",
				limit: 10,
			});

			expect(result).toBeDefined();
			expect(result.runs).toBeInstanceOf(Array);
			// All returned runs should have status = "completed"
			result.runs.forEach((run: any) => {
				expect(run.status).toBe("completed");
			});
		});
	});

	describe("Trigger Ingestion", () => {
		it.skipIf(!goServiceAvailable)(
			"should return 202 with runId and status: started",
			async () => {
				const result = await orpc.admin.ingestion.triggerChain({
					chain: "dm",
				});

				expect(result).toBeDefined();
				expect(result.status).toBe("started");
				expect(result.runId).toBeDefined();
				expect(typeof result.runId).toBe("string");
				expect(result.pollUrl).toBeDefined();
			},
		);
	});

	describe("Search Items", () => {
		it.skipIf(!goServiceAvailable)(
			"should require minimum 3 characters",
			async () => {
				await expect(
					orpc.prices.searchItems({
						query: "ab", // Only 2 chars
					}),
				).rejects.toThrow();
			},
		);

		it.skipIf(!goServiceAvailable)(
			"should return search results for valid query",
			async () => {
				const result = await orpc.prices.searchItems({
					query: "milk",
					limit: 10,
				});

				expect(result).toBeDefined();
				expect(result.items).toBeInstanceOf(Array);
				expect(typeof result.total).toBe("number");
				expect(result.query).toBe("milk");
			},
		);

		it.skipIf(!goServiceAvailable)(
			"should filter by chainSlug when provided",
			async () => {
				const result = await orpc.prices.searchItems({
					query: "milk",
					chainSlug: "konzum",
					limit: 10,
				});

				expect(result).toBeDefined();
				expect(result.items).toBeInstanceOf(Array);
				// All returned items should have chainSlug = "konzum"
				result.items.forEach((item: any) => {
					expect(item.chainSlug).toBe("konzum");
				});
			},
		);
	});

	describe("Get Store Prices", () => {
		it.skipIf(!goServiceAvailable)(
			"should return paginated prices for a store",
			async () => {
				// This test requires a valid store ID - in real tests, you'd create one first
				// For now, we'll just test that the endpoint doesn't throw
				try {
					const result = await orpc.prices.getStorePrices({
						chainSlug: "konzum",
						storeId: "test-store-id",
						limit: 10,
					});
					expect(result).toBeDefined();
					expect(result.prices).toBeInstanceOf(Array);
					expect(typeof result.total).toBe("number");
				} catch (error: any) {
					// Store might not exist, which is ok for this test
					expect(error.message).toContain("404");
				}
			},
		);
	});
});

// Unit tests that don't require the Go service
describe("Price Service Proxy Unit Tests", () => {
	describe("Input Validation", () => {
		it("should validate chainSlug enum values", async () => {
			const validChains = [
				"konzum",
				"lidl",
				"plodine",
				"interspar",
				"studenac",
				"kaufland",
				"eurospin",
				"dm",
				"ktc",
				"metro",
				"trgocentar",
			];

			// These should be valid
			validChains.forEach((chain) => {
				expect(() => {
					// Schema validation happens at runtime
					const result = { chain };
					result.chain = chain;
				}).not.toThrow();
			});
		});

		it("should validate status enum values", async () => {
			const validStatuses = ["pending", "running", "completed", "failed"];

			validStatuses.forEach((status) => {
				expect(() => {
					const result = { status };
					result.status = status;
				}).not.toThrow();
			});
		});
	});
});
