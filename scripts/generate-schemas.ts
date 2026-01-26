/**
 * Schema Generator
 *
 * Converts JSON Schema files generated from Go types to Zod schemas.
 * This script reads schemas from shared/schemas/*.json and generates
 * TypeScript files with Zod schemas in src/lib/go-schemas/*.ts
 *
 * Usage:
 *   pnpm tsx scripts/generate-schemas.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { jsonSchemaToZod } from "json-schema-to-zod";

const SCHEMAS_DIR = join(process.cwd(), "shared/schemas");
const OUTPUT_DIR = join(process.cwd(), "src/lib/go-schemas");

interface JsonSchemaDef {
	type?: string;
	properties?: Record<string, unknown>;
	required?: string[];
	items?: unknown;
	$ref?: string;
	additionalProperties?: boolean;
	[key: string]: unknown;
}

interface JsonSchema {
	$defs?: Record<string, JsonSchemaDef>;
	$schema?: string;
	$id?: string;
	title?: string;
	description?: string;
}

// Resolve $ref references within a schema
function resolveRefs(schema: JsonSchemaDef, defs: Record<string, JsonSchemaDef>): JsonSchemaDef {
	if (!schema) return schema;

	// If this is a $ref, resolve it
	if (schema.$ref) {
		const refName = schema.$ref.replace("#/$defs/", "");
		const resolved = defs[refName];
		if (resolved) {
			return resolveRefs({ ...resolved }, defs);
		}
	}

	// Create a new object with resolved properties
	const result: JsonSchemaDef = { ...schema };

	// Remove additionalProperties: false to avoid .strict() in generated code
	// This is important because Go may send additional fields we don't care about
	delete result.additionalProperties;

	// Resolve properties recursively
	if (result.properties) {
		result.properties = Object.fromEntries(
			Object.entries(result.properties).map(([key, value]) => [
				key,
				resolveRefs(value as JsonSchemaDef, defs),
			])
		);
	}

	// Resolve items (for arrays)
	if (result.items) {
		if (typeof result.items === "object" && !Array.isArray(result.items)) {
			result.items = resolveRefs(result.items as JsonSchemaDef, defs);
		}
	}

	return result;
}

function generateZodSchemas() {
	// Ensure output directory exists
	if (!existsSync(OUTPUT_DIR)) {
		mkdirSync(OUTPUT_DIR, { recursive: true });
	}

	// Get all JSON schema files
	const schemaFiles = readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith(".json"));

	if (schemaFiles.length === 0) {
		console.error("No schema files found in", SCHEMAS_DIR);
		process.exit(1);
	}

	const generatedFiles: string[] = [];

	for (const schemaFile of schemaFiles) {
		const schemaPath = join(SCHEMAS_DIR, schemaFile);
		const outputFile = schemaFile.replace(".json", ".ts");
		const outputPath = join(OUTPUT_DIR, outputFile);

		console.log(`Processing ${schemaFile}...`);

		const schemaContent = readFileSync(schemaPath, "utf-8");
		const schema: JsonSchema = JSON.parse(schemaContent);

		if (!schema.$defs || Object.keys(schema.$defs).length === 0) {
			console.warn(`  Skipping ${schemaFile}: no definitions found`);
			continue;
		}

		const zodSchemas: string[] = [];
		const typeExports: string[] = [];

		// Generate Zod schema for each definition
		for (const [typeName, typeDef] of Object.entries(schema.$defs)) {
			try {
				// Resolve all $refs to create a standalone schema
				const resolvedSchema = resolveRefs(typeDef, schema.$defs);

				// Type assertion needed because our simplified JsonSchemaDef doesn't match
				// the library's full JsonSchema type, but the resolved schema is valid
				const zodCode = jsonSchemaToZod(resolvedSchema as Parameters<typeof jsonSchemaToZod>[0], {
					module: "none",
				});

				// Clean up the output - it should be just the z.xxx() code
				let cleanedCode = zodCode.trim();

				// Remove trailing semicolon if present
				if (cleanedCode.endsWith(";")) {
					cleanedCode = cleanedCode.slice(0, -1);
				}

				zodSchemas.push(`export const ${typeName}Schema = ${cleanedCode};`);
				typeExports.push(
					`export type ${typeName} = z.infer<typeof ${typeName}Schema>;`
				);
			} catch (error) {
				console.error(`  Error generating schema for ${typeName}:`, error);
			}
		}

		if (zodSchemas.length === 0) {
			console.warn(`  No schemas generated for ${schemaFile}`);
			continue;
		}

		// Generate output file
		const output = `/**
 * Auto-generated Zod schemas from Go types
 * DO NOT EDIT - regenerate with: pnpm schema:generate
 *
 * Source: shared/schemas/${schemaFile}
 */

import { z } from "zod";

// ============================================================================
// Schemas
// ============================================================================

${zodSchemas.join("\n\n")}

// ============================================================================
// Types
// ============================================================================

${typeExports.join("\n")}
`;

		writeFileSync(outputPath, output);
		console.log(`  Generated ${outputFile} (${zodSchemas.length} schemas)`);
		generatedFiles.push(outputFile);
	}

	// Generate index file
	const indexContent = `/**
 * Auto-generated index for Go schema types
 * DO NOT EDIT - regenerate with: pnpm schema:generate
 */

${generatedFiles.map((f) => `export * from "./${f.replace(".ts", "")}";`).join("\n")}
`;

	writeFileSync(join(OUTPUT_DIR, "index.ts"), indexContent);
	console.log(`\nGenerated index.ts`);

	// Format generated files with biome
	console.log("\nFormatting with biome...");
	try {
		execSync(`pnpm biome format --write ${OUTPUT_DIR}`, { stdio: "inherit" });
	} catch {
		console.warn("Warning: biome formatting failed, continuing anyway");
	}

	console.log(`\nSchema generation complete! Generated ${generatedFiles.length} files.`);
}

generateZodSchemas();
