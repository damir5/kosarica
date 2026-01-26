/**
 * Tests for generate:go-api script configuration
 *
 * Verifies that the generate:go-api script is properly configured
 * in package.json and mise.toml for TypeScript SDK generation from Go OpenAPI spec.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("generate:go-api script configuration", () => {
	describe("package.json", () => {
		const packageJson = JSON.parse(
			readFileSync(resolve(process.cwd(), "package.json"), "utf-8"),
		);

		it("should have generate:go-api script defined", () => {
			expect(packageJson.scripts).toBeDefined();
			expect(packageJson.scripts["generate:go-api"]).toBeDefined();
		});

		it("should use openapi-ts command for generate:go-api", () => {
			expect(packageJson.scripts["generate:go-api"]).toBe("openapi-ts");
		});

		it("should have @hey-api/openapi-ts as dev dependency", () => {
			expect(packageJson.devDependencies).toBeDefined();
			expect(packageJson.devDependencies["@hey-api/openapi-ts"]).toBeDefined();
		});
	});

	describe("mise.toml", () => {
		const miseToml = readFileSync(resolve(process.cwd(), "mise.toml"), "utf-8");

		it("should have generate-go-api task defined", () => {
			expect(miseToml).toContain("[tasks.generate-go-api]");
		});

		it("should have description for generate-go-api task", () => {
			expect(miseToml).toContain(
				'description = "Generate TypeScript SDK from Go OpenAPI spec"',
			);
		});

		it("should run pnpm generate:go-api command", () => {
			expect(miseToml).toContain('run = "pnpm generate:go-api"');
		});
	});

	describe("openapi-ts.config.ts", () => {
		it("should have config file at project root", () => {
			const configPath = resolve(process.cwd(), "openapi-ts.config.ts");
			const configExists = (() => {
				try {
					readFileSync(configPath, "utf-8");
					return true;
				} catch {
					return false;
				}
			})();
			expect(configExists).toBe(true);
		});

		it("should export valid configuration", async () => {
			const configModule = await import("../../openapi-ts.config");
			const config = await configModule.default;

			expect(config).toBeDefined();
			expect(config.input).toBeDefined();
			expect(config.output).toBeDefined();
			expect(config.plugins).toBeDefined();
		});
	});
});
