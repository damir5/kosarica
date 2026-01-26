/**
 * Tests for openapi-ts.config.ts configuration file
 *
 * Verifies that the OpenAPI TypeScript generator configuration is valid
 * and has all expected settings for generating the Go API client.
 */

import { describe, expect, it } from "vitest";

describe("openapi-ts.config.ts configuration", () => {
	it("should export a valid configuration", async () => {
		// Import the config - it returns a Promise from defineConfig
		const configModule = await import("../../openapi-ts.config");
		const config = await configModule.default;

		expect(config).toBeDefined();
		expect(typeof config).toBe("object");
	});

	it("should have correct input URL pointing to Go service Swagger spec", async () => {
		const configModule = await import("../../openapi-ts.config");
		const config = await configModule.default;

		expect(config.input).toBe("http://localhost:3003/docs/doc.json");
	});

	it("should output to src/lib/go-api directory", async () => {
		const configModule = await import("../../openapi-ts.config");
		const config = await configModule.default;

		expect(config.output).toBeDefined();
		expect(config.output.path).toBe("src/lib/go-api");
	});

	it("should use prettier formatting", async () => {
		const configModule = await import("../../openapi-ts.config");
		const config = await configModule.default;

		expect(config.output.format).toBe("prettier");
	});

	it("should include @hey-api/typescript plugin for type definitions", async () => {
		const configModule = await import("../../openapi-ts.config");
		const config = await configModule.default;

		expect(config.plugins).toBeDefined();
		expect(Array.isArray(config.plugins)).toBe(true);
		expect(config.plugins).toContain("@hey-api/typescript");
	});

	it("should include @hey-api/sdk plugin for SDK generation", async () => {
		const configModule = await import("../../openapi-ts.config");
		const config = await configModule.default;

		expect(config.plugins).toContain("@hey-api/sdk");
	});

	it("should include zod plugin for runtime validation schemas", async () => {
		const configModule = await import("../../openapi-ts.config");
		const config = await configModule.default;

		// Find the zod plugin (can be string or object with name)
		const zodPlugin = config.plugins.find(
			(p: string | { name: string }) =>
				p === "zod" || (typeof p === "object" && p.name === "zod"),
		);

		expect(zodPlugin).toBeDefined();
	});

	it("should export zod schemas from index", async () => {
		const configModule = await import("../../openapi-ts.config");
		const config = await configModule.default;

		// Find the zod plugin configuration object
		const zodPlugin = config.plugins.find(
			(p: string | { name: string; exportFromIndex?: boolean }) =>
				typeof p === "object" && p.name === "zod",
		);

		expect(zodPlugin).toBeDefined();
		expect((zodPlugin as { exportFromIndex?: boolean }).exportFromIndex).toBe(
			true,
		);
	});
});
