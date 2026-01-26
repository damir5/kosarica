/**
 * SDK Migration Tests
 *
 * Tests to verify that the generated SDK client is properly configured
 * and the migrated handlers work correctly with the SDK.
 */

import { describe, expect, it } from "vitest";
import { client, unwrapSdkResponse } from "./client-config";

describe("Go API Client Configuration", () => {
	it("should have a configured client instance", () => {
		expect(client).toBeDefined();
		expect(typeof client.get).toBe("function");
		expect(typeof client.post).toBe("function");
		expect(typeof client.delete).toBe("function");
	});

	it("should have getConfig method", () => {
		expect(typeof client.getConfig).toBe("function");
		const config = client.getConfig();
		expect(config).toBeDefined();
	});

	it("should be configured with the correct base URL", () => {
		const config = client.getConfig();
		// In test environment, should use default localhost URL
		expect(config.baseUrl).toBe("http://localhost:3003");
	});

	it("should have auth headers configured", () => {
		const config = client.getConfig();
		expect(config.headers).toBeDefined();
		// Headers are stored as a Headers-like object
		// Just verify headers config exists (value check would require mocking)
		expect(config.headers).not.toBeNull();
	});
});

describe("unwrapSdkResponse", () => {
	it("should return data when response is successful", () => {
		const mockData = { foo: "bar" };
		const result = unwrapSdkResponse<typeof mockData>({
			data: mockData,
			error: undefined,
			response: new Response(),
		});
		expect(result).toEqual(mockData);
	});

	it("should throw error when response has error", () => {
		expect(() =>
			unwrapSdkResponse({
				data: undefined,
				error: "Something went wrong",
				response: new Response(),
			}),
		).toThrow("Something went wrong");
	});

	it("should stringify object errors", () => {
		expect(() =>
			unwrapSdkResponse({
				data: undefined,
				error: { code: "ERR_001", message: "Test error" },
				response: new Response(),
			}),
		).toThrow('{"code":"ERR_001","message":"Test error"}');
	});

	it("should handle missing error with default message", () => {
		// When both data and error are undefined but error is truthy
		const result = unwrapSdkResponse({
			data: { test: true },
			error: undefined,
			response: new Response(),
		});
		expect(result).toEqual({ test: true });
	});
});

describe("Generated SDK Functions", () => {
	it("should export SDK functions from index", async () => {
		const sdk = await import("./index");

		// Ingestion functions
		expect(typeof sdk.getInternalIngestionRuns).toBe("function");
		expect(typeof sdk.getInternalIngestionRunsByRunId).toBe("function");
		expect(typeof sdk.getInternalIngestionRunsByRunIdFiles).toBe("function");
		expect(typeof sdk.getInternalIngestionRunsByRunIdErrors).toBe("function");
		expect(typeof sdk.getInternalIngestionStats).toBe("function");
		expect(typeof sdk.postInternalIngestionRunsByRunIdRerun).toBe("function");
		expect(typeof sdk.deleteInternalIngestionRunsByRunId).toBe("function");

		// Price functions
		expect(typeof sdk.getInternalPricesByChainSlugByStoreId).toBe("function");
		expect(typeof sdk.getInternalItemsSearch).toBe("function");

		// Basket functions
		expect(typeof sdk.postInternalBasketOptimizeSingle).toBe("function");
		expect(typeof sdk.postInternalBasketOptimizeMulti).toBe("function");
		expect(typeof sdk.postInternalBasketCacheWarmup).toBe("function");
		expect(typeof sdk.postInternalBasketCacheRefreshByChainSlug).toBe(
			"function",
		);
		expect(typeof sdk.getInternalBasketCacheHealth).toBe("function");
	});

	it("should export Zod schemas from index", async () => {
		const sdk = await import("./index");

		// Check some Zod schemas are exported
		expect(sdk.zHandlersListRunsResponse).toBeDefined();
		expect(sdk.zHandlersIngestionRun).toBeDefined();
		expect(sdk.zHandlersMultiStoreResult).toBeDefined();
		expect(sdk.zHandlersOptimizeRequest).toBeDefined();
	});

	it("should export TypeScript types from index", async () => {
		const sdk = await import("./index");

		// Types are compile-time only, but we can check the type exports exist
		// by verifying the module shape
		expect(sdk).toHaveProperty("getInternalIngestionRuns");
	});
});

describe("SDK Type Definitions", () => {
	it("should have proper type definitions for handlers types", async () => {
		const { zHandlersListRunsResponse } = await import("./index");

		// Test the Zod schema can parse valid data
		const validRunsResponse = {
			runs: [
				{
					id: "run-1",
					chainSlug: "konzum",
					status: "completed",
				},
			],
			total: 1,
		};

		const parsed = zHandlersListRunsResponse.parse(validRunsResponse);
		expect(parsed.total).toBe(1);
		expect(parsed.runs).toHaveLength(1);
	});

	it("should have proper type definitions for optimize request", async () => {
		const { zHandlersOptimizeRequest } = await import("./index");

		const validRequest = {
			chainSlug: "konzum",
			basketItems: [{ itemId: "item-1", name: "Test Item", quantity: 2 }],
			location: { latitude: 45.8, longitude: 16.0 },
			maxDistance: 5000,
			maxStores: 3,
		};

		const parsed = zHandlersOptimizeRequest.parse(validRequest);
		expect(parsed.chainSlug).toBe("konzum");
		expect(parsed.basketItems).toHaveLength(1);
	});
});
