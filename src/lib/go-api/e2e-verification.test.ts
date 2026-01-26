/**
 * End-to-End Verification Tests for OpenAPI Migration
 *
 * These tests verify the complete integration of:
 * 1. Go swag annotations generating valid OpenAPI spec
 * 2. @hey-api/openapi-ts generating TypeScript SDK from the spec
 * 3. SDK client configuration and usage
 * 4. Zod schemas for runtime validation
 *
 * Run with: pnpm test src/lib/go-api/e2e-verification.test.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("OpenAPI E2E Verification", () => {
	describe("Phase 1: Go OpenAPI Spec Generation", () => {
		const swaggerJsonPath = resolve(
			__dirname,
			"../../../services/price-service/docs/swagger.json",
		);

		it("should have swagger.json file generated", () => {
			expect(existsSync(swaggerJsonPath)).toBe(true);
		});

		it("should have valid JSON in swagger.json", () => {
			const content = readFileSync(swaggerJsonPath, "utf-8");
			const spec = JSON.parse(content);
			expect(spec).toBeDefined();
			expect(spec.swagger).toBe("2.0");
		});

		it("should have correct API metadata", () => {
			const content = readFileSync(swaggerJsonPath, "utf-8");
			const spec = JSON.parse(content);
			expect(spec.info.title).toBe("Price Service API");
			expect(spec.info.version).toBe("1.0");
			expect(spec.basePath).toBe("/internal");
		});

		it("should have all expected endpoints documented", () => {
			const content = readFileSync(swaggerJsonPath, "utf-8");
			const spec = JSON.parse(content);
			const paths = Object.keys(spec.paths);

			// Price endpoints (paths include /internal prefix)
			expect(paths).toContain("/internal/prices/{chainSlug}/{storeId}");
			expect(paths).toContain("/internal/items/search");

			// Ingestion endpoints
			expect(paths).toContain("/internal/ingestion/runs");
			expect(paths).toContain("/internal/ingestion/runs/{runId}");
			expect(paths).toContain("/internal/ingestion/runs/{runId}/files");
			expect(paths).toContain("/internal/ingestion/runs/{runId}/errors");
			expect(paths).toContain("/internal/ingestion/runs/{runId}/rerun");
			expect(paths).toContain("/internal/ingestion/stats");

			// Basket optimization endpoints
			expect(paths).toContain("/internal/basket/optimize/single");
			expect(paths).toContain("/internal/basket/optimize/multi");
			expect(paths).toContain("/internal/basket/cache/warmup");
			expect(paths).toContain("/internal/basket/cache/refresh/{chainSlug}");
			expect(paths).toContain("/internal/basket/cache/health");
		});

		it("should have type definitions for request/response objects", () => {
			const content = readFileSync(swaggerJsonPath, "utf-8");
			const spec = JSON.parse(content);
			const definitions = Object.keys(spec.definitions || {});

			// Core types
			expect(definitions).toContain("handlers.GetStorePricesResponse");
			expect(definitions).toContain("handlers.SearchItemsResponse");
			expect(definitions).toContain("handlers.ListRunsResponse");
			expect(definitions).toContain("handlers.IngestionRun");
			expect(definitions).toContain("handlers.OptimizeRequest");
			expect(definitions).toContain("handlers.MultiStoreResult");
		});
	});

	describe("Phase 2: TypeScript SDK Generation", () => {
		const goApiDir = resolve(__dirname);

		it("should have generated SDK files", () => {
			expect(existsSync(resolve(goApiDir, "sdk.gen.ts"))).toBe(true);
			expect(existsSync(resolve(goApiDir, "types.gen.ts"))).toBe(true);
			expect(existsSync(resolve(goApiDir, "zod.gen.ts"))).toBe(true);
			expect(existsSync(resolve(goApiDir, "index.ts"))).toBe(true);
			expect(existsSync(resolve(goApiDir, "client.gen.ts"))).toBe(true);
		});

		it("should have client configuration file", () => {
			expect(existsSync(resolve(goApiDir, "client-config.ts"))).toBe(true);
		});

		it("should export SDK functions from index", async () => {
			const sdk = await import("./index");

			// Ingestion SDK functions
			expect(typeof sdk.getInternalIngestionRuns).toBe("function");
			expect(typeof sdk.getInternalIngestionRunsByRunId).toBe("function");
			expect(typeof sdk.getInternalIngestionRunsByRunIdFiles).toBe("function");
			expect(typeof sdk.getInternalIngestionRunsByRunIdErrors).toBe("function");
			expect(typeof sdk.getInternalIngestionStats).toBe("function");
			expect(typeof sdk.postInternalIngestionRunsByRunIdRerun).toBe("function");
			expect(typeof sdk.deleteInternalIngestionRunsByRunId).toBe("function");

			// Price SDK functions
			expect(typeof sdk.getInternalPricesByChainSlugByStoreId).toBe("function");
			expect(typeof sdk.getInternalItemsSearch).toBe("function");

			// Basket SDK functions
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

			// Verify Zod schemas are exported
			expect(sdk.zHandlersListRunsResponse).toBeDefined();
			expect(sdk.zHandlersIngestionRun).toBeDefined();
			expect(sdk.zHandlersGetStorePricesResponse).toBeDefined();
			expect(sdk.zHandlersSearchItemsResponse).toBeDefined();
			expect(sdk.zHandlersOptimizeRequest).toBeDefined();
			expect(sdk.zHandlersMultiStoreResult).toBeDefined();
			expect(sdk.zHandlersGetStatsResponse).toBeDefined();
		});

		it("should have proper Zod schema shapes", async () => {
			const sdk = await import("./index");

			// Test that Zod schemas can parse valid data
			const runsResponse = {
				runs: [
					{
						id: "run-123",
						chainSlug: "konzum",
						status: "completed",
						source: "api",
						createdAt: new Date().toISOString(),
					},
				],
				total: 1,
			};

			const parsed = sdk.zHandlersListRunsResponse.parse(runsResponse);
			expect(parsed.total).toBe(1);
			expect(parsed.runs?.[0]?.id).toBe("run-123");
		});
	});

	describe("Phase 3: Client Configuration", () => {
		it("should export configured client", async () => {
			const { client } = await import("./client-config");
			expect(client).toBeDefined();
			expect(typeof client.get).toBe("function");
			expect(typeof client.post).toBe("function");
			expect(typeof client.delete).toBe("function");
		});

		it("should have unwrapSdkResponse helper", async () => {
			const { unwrapSdkResponse } = await import("./client-config");
			expect(typeof unwrapSdkResponse).toBe("function");
		});

		it("should unwrap successful responses", async () => {
			const { unwrapSdkResponse } = await import("./client-config");

			const mockData = { runs: [], total: 0 };
			const result = unwrapSdkResponse({
				data: mockData,
				error: undefined,
				response: new Response(),
			});

			expect(result).toEqual(mockData);
		});

		it("should throw on error responses", async () => {
			const { unwrapSdkResponse } = await import("./client-config");

			expect(() =>
				unwrapSdkResponse({
					data: undefined,
					error: "Test error",
					response: new Response(),
				}),
			).toThrow("Test error");
		});

		it("should stringify object errors", async () => {
			const { unwrapSdkResponse } = await import("./client-config");

			expect(() =>
				unwrapSdkResponse({
					data: undefined,
					error: { code: "ERR_001", message: "Test error" },
					response: new Response(),
				}),
			).toThrow('{"code":"ERR_001","message":"Test error"}');
		});
	});

	describe("Phase 4: Cleanup Verification", () => {
		it("should not have old schema-gen directory", () => {
			const schemaGenPath = resolve(
				__dirname,
				"../../../services/price-service/cmd/schema-gen",
			);
			expect(existsSync(schemaGenPath)).toBe(false);
		});

		it("should not have old go-schemas directory", () => {
			const goSchemasPath = resolve(__dirname, "../go-schemas");
			expect(existsSync(goSchemasPath)).toBe(false);
		});

		it("should not have old go-rpc.ts file", () => {
			const goRpcPath = resolve(__dirname, "../go-rpc.ts");
			expect(existsSync(goRpcPath)).toBe(false);
		});

		it("should not have old generate-schemas.ts script", () => {
			const generateSchemasPath = resolve(
				__dirname,
				"../../../scripts/generate-schemas.ts",
			);
			expect(existsSync(generateSchemasPath)).toBe(false);
		});

		it("should not have old shared/schemas directory", () => {
			const sharedSchemasPath = resolve(__dirname, "../../../shared/schemas");
			expect(existsSync(sharedSchemasPath)).toBe(false);
		});
	});

	describe("Configuration Verification", () => {
		it("should have openapi-ts config at project root", () => {
			const configPath = resolve(__dirname, "../../../openapi-ts.config.ts");
			expect(existsSync(configPath)).toBe(true);
		});

		it("should have generate:go-api script in package.json", () => {
			const packageJsonPath = resolve(__dirname, "../../../package.json");
			const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
			expect(packageJson.scripts["generate:go-api"]).toBe("openapi-ts");
		});

		it("should have swag task in mise.toml", () => {
			const miseTomlPath = resolve(__dirname, "../../../mise.toml");
			const content = readFileSync(miseTomlPath, "utf-8");
			expect(content).toContain("[tasks.swag]");
			expect(content).toContain("swaggo/swag/cmd/swag");
		});

		it("should have generate-go-api task in mise.toml", () => {
			const miseTomlPath = resolve(__dirname, "../../../mise.toml");
			const content = readFileSync(miseTomlPath, "utf-8");
			expect(content).toContain("[tasks.generate-go-api]");
			expect(content).toContain("pnpm generate:go-api");
		});
	});
});
