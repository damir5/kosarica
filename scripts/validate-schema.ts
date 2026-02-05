import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@/utils/logger";

const log = createLogger("app");

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

// Main validation
let success = true;

success = validateJsonSchemas() && success;
success = validateMigrations() && success;

if (success) {
	console.log("\n✓ All schema validations passed");
	log.info("Schema validation passed");
	process.exit(0);
} else {
	console.error("\n✗ Schema validation failed");
	log.error("Schema validation failed");
	process.exit(1);
}
