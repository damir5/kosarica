/**
 * Tests for @hey-api/openapi-ts dependency installation
 *
 * Verifies that the package is properly installed and can be imported.
 */

import { describe, expect, it } from "vitest";

describe("@hey-api/openapi-ts installation", () => {
	it("should be importable from @hey-api/openapi-ts", async () => {
		// Dynamic import to verify the package is installed
		const openapiTs = await import("@hey-api/openapi-ts");

		// Verify the defineConfig function exists (main configuration function)
		expect(openapiTs.defineConfig).toBeDefined();
		expect(typeof openapiTs.defineConfig).toBe("function");
	});

	it("should have createClient function available", async () => {
		// The createClient function is used at runtime for API calls
		const openapiTs = await import("@hey-api/openapi-ts");

		expect(openapiTs.createClient).toBeDefined();
		expect(typeof openapiTs.createClient).toBe("function");
	});

	it("should allow defining a valid configuration", async () => {
		const { defineConfig } = await import("@hey-api/openapi-ts");

		// This configuration matches what we'll use for the Go API client
		// defineConfig returns a Promise
		const config = await defineConfig({
			input: "http://localhost:3003/docs/doc.json",
			output: { path: "src/lib/go-api", format: "prettier" },
			plugins: ["@hey-api/sdk", "zod"],
		});

		expect(config).toBeDefined();
		expect(config.input).toBe("http://localhost:3003/docs/doc.json");
		expect(config.output).toBeDefined();
		expect(config.plugins).toContain("@hey-api/sdk");
		expect(config.plugins).toContain("zod");
	});

	it("should support the zod plugin for schema validation", async () => {
		const { defineConfig } = await import("@hey-api/openapi-ts");

		// Zod plugin configuration for runtime validation
		// defineConfig returns a Promise
		const config = await defineConfig({
			input: "http://localhost:3003/docs/doc.json",
			output: "src/lib/go-api",
			plugins: [
				{
					name: "zod",
				},
			],
		});

		expect(config).toBeDefined();
		expect(config.plugins).toBeDefined();
		expect(Array.isArray(config.plugins)).toBe(true);
	});

	it("should support the SDK plugin configuration", async () => {
		const { defineConfig } = await import("@hey-api/openapi-ts");

		// SDK plugin for typed API functions
		// defineConfig returns a Promise
		const config = await defineConfig({
			input: "http://localhost:3003/docs/doc.json",
			output: "src/lib/go-api",
			plugins: [
				{
					name: "@hey-api/sdk",
				},
			],
		});

		expect(config).toBeDefined();
		expect(config.plugins).toBeDefined();
	});
});
