import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Tests verifying that redundant schema generation files have been cleaned up.
 * These files are replaced by the OpenAPI + @hey-api/openapi-ts approach.
 */
describe("Schema Cleanup Verification", () => {
	const projectRoot = path.resolve(import.meta.dirname, "../..");

	describe("Deleted directories", () => {
		it("should not have services/price-service/cmd/schema-gen/ directory", () => {
			const schemaGenDir = path.join(
				projectRoot,
				"services/price-service/cmd/schema-gen",
			);
			expect(fs.existsSync(schemaGenDir)).toBe(false);
		});

		it("should not have src/lib/go-schemas/ directory", () => {
			const goSchemasDir = path.join(projectRoot, "src/lib/go-schemas");
			expect(fs.existsSync(goSchemasDir)).toBe(false);
		});

		it("should not have shared/schemas/ directory", () => {
			const sharedSchemasDir = path.join(projectRoot, "shared/schemas");
			expect(fs.existsSync(sharedSchemasDir)).toBe(false);
		});
	});

	describe("Deleted files", () => {
		it("should not have scripts/generate-schemas.ts file", () => {
			const generateSchemasFile = path.join(
				projectRoot,
				"scripts/generate-schemas.ts",
			);
			expect(fs.existsSync(generateSchemasFile)).toBe(false);
		});

		it("should not have src/lib/go-rpc.ts file", () => {
			const goRpcFile = path.join(projectRoot, "src/lib/go-rpc.ts");
			expect(fs.existsSync(goRpcFile)).toBe(false);
		});
	});

	describe("Cleaned up configuration", () => {
		it("should not have schema:generate script in package.json", () => {
			const packageJsonPath = path.join(projectRoot, "package.json");
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
			expect(packageJson.scripts["schema:generate"]).toBeUndefined();
		});

		it("should not have json-schema-to-zod in devDependencies", () => {
			const packageJsonPath = path.join(projectRoot, "package.json");
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
			expect(packageJson.devDependencies["json-schema-to-zod"]).toBeUndefined();
		});

		it("should not have schema-generate task in mise.toml", () => {
			const miseTomlPath = path.join(projectRoot, "mise.toml");
			const miseToml = fs.readFileSync(miseTomlPath, "utf-8");
			expect(miseToml).not.toContain("[tasks.schema-generate]");
		});

		it("should not have schema-check task in mise.toml", () => {
			const miseTomlPath = path.join(projectRoot, "mise.toml");
			const miseToml = fs.readFileSync(miseTomlPath, "utf-8");
			expect(miseToml).not.toContain("[tasks.schema-check]");
		});
	});

	describe("New OpenAPI-based system in place", () => {
		it("should have src/lib/go-api/ directory with generated SDK", () => {
			const goApiDir = path.join(projectRoot, "src/lib/go-api");
			expect(fs.existsSync(goApiDir)).toBe(true);
		});

		it("should have swag task in mise.toml", () => {
			const miseTomlPath = path.join(projectRoot, "mise.toml");
			const miseToml = fs.readFileSync(miseTomlPath, "utf-8");
			expect(miseToml).toContain("[tasks.swag]");
		});

		it("should have generate-go-api task in mise.toml", () => {
			const miseTomlPath = path.join(projectRoot, "mise.toml");
			const miseToml = fs.readFileSync(miseTomlPath, "utf-8");
			expect(miseToml).toContain("[tasks.generate-go-api]");
		});

		it("should have generate:go-api script in package.json", () => {
			const packageJsonPath = path.join(projectRoot, "package.json");
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
			expect(packageJson.scripts["generate:go-api"]).toBe("openapi-ts");
		});
	});

	describe("Documentation updated", () => {
		it("should have updated AGENTS.md referencing OpenAPI", () => {
			const agentsMdPath = path.join(projectRoot, "AGENTS.md");
			const agentsMd = fs.readFileSync(agentsMdPath, "utf-8");
			expect(agentsMd).toContain("mise run swag");
			expect(agentsMd).toContain("mise run generate-go-api");
			expect(agentsMd).not.toContain("mise run schema-generate");
		});

		it("should have updated services/price-service/AGENTS.md referencing OpenAPI", () => {
			const serviceAgentsMdPath = path.join(
				projectRoot,
				"services/price-service/AGENTS.md",
			);
			const serviceAgentsMd = fs.readFileSync(serviceAgentsMdPath, "utf-8");
			expect(serviceAgentsMd).toContain("OpenAPI");
			expect(serviceAgentsMd).toContain("swag annotations");
			expect(serviceAgentsMd).not.toContain("jsonschema tags");
		});
	});
});
