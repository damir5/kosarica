import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Validate that Drizzle migrations are consistent
function validateMigrations(): boolean {
	console.log("Checking migrations consistency...");
	try {
		const result = execSync("npx drizzle-kit check 2>&1", {
			encoding: "utf-8",
		});
		console.log(result);
		return !result.includes("Error");
	} catch (error) {
		if (error instanceof Error && "stdout" in error) {
			const stdout = (error as { stdout: string }).stdout;
			console.error("Migration check failed:");
			console.error(stdout);
		}
		return false;
	}
}

// Validate that JSON schemas exist and match expected files
function validateJsonSchemas(): boolean {
	console.log("\nChecking JSON schemas...");
	const schemaDir = "shared/schemas/jsonb";
	const expectedSchemas = [
		"task-queue-payload.json",
		"validation-errors.json",
		"cron-job-payload.json",
		"cron-run-metadata.json",
		"archive-metadata.json",
	];

	if (!existsSync(schemaDir)) {
		console.error(`Schema directory ${schemaDir} does not exist`);
		console.error("Run 'pnpm generate:json-schemas' to generate schemas");
		return false;
	}

	const files = readdirSync(schemaDir);
	const missing = expectedSchemas.filter((f) => !files.includes(f));

	if (missing.length > 0) {
		console.error("Missing JSON schema files:", missing.join(", "));
		console.error("Run 'pnpm generate:json-schemas' to generate schemas");
		return false;
	}

	// Validate each schema is valid JSON
	for (const file of expectedSchemas) {
		try {
			const content = readFileSync(join(schemaDir, file), "utf-8");
			JSON.parse(content);
			console.log(`  ✓ ${file}`);
		} catch (error) {
			console.error(`  ✗ ${file} - Invalid JSON`);
			return false;
		}
	}

	return true;
}

// Validate Go types exist
function validateGoTypes(): boolean {
	console.log("\nChecking Go JSONB types...");
	const goTypesDir = "services/price-service/internal/jsonb";
	const requiredFiles = ["types.go", "scanner.go"];

	if (!existsSync(goTypesDir)) {
		console.error(`Go types directory ${goTypesDir} does not exist`);
		return false;
	}

	const files = readdirSync(goTypesDir);
	const missing = requiredFiles.filter((f) => !files.includes(f));

	if (missing.length > 0) {
		console.error("Missing Go type files:", missing.join(", "));
		return false;
	}

	for (const file of requiredFiles) {
		console.log(`  ✓ ${file}`);
	}

	return true;
}

// Validate schema.sql exists for Go service
function validateGoSchema(): boolean {
	console.log("\nChecking Go service schema.sql...");
	const schemaPath = "services/price-service/schema.sql";

	if (!existsSync(schemaPath)) {
		console.error(`Schema file ${schemaPath} does not exist`);
		console.error("Run: mise run db-sync in services/price-service/");
		return false;
	}

	// Check it's valid SQL (no pg_dump-specific commands that sqlc can't parse)
	const content = readFileSync(schemaPath, "utf-8");
	if (content.includes("\\restrict") || content.includes("\\connect")) {
		console.error(`  ✗ ${schemaPath} contains pg_dump commands that sqlc cannot parse`);
		console.error("  The schema.sql needs to be sqlc-compatible DDL");
		return false;
	}

	console.log(`  ✓ ${schemaPath} exists and is sqlc-compatible`);
	return true;
}

// Main validation
let success = true;

success = validateJsonSchemas() && success;
success = validateGoTypes() && success;
success = validateGoSchema() && success;
success = validateMigrations() && success;

if (success) {
	console.log("\n✓ All schema validations passed");
	process.exit(0);
} else {
	console.error("\n✗ Schema validation failed");
	process.exit(1);
}
