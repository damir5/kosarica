import { execSync } from "node:child_process";

const targets = [
	"src/ingestion/adapters",
	"src/lib/safe-db.ts",
	"src/lib/safe-fetch.ts",
	"src/lib/safe-storage.ts",
	"src/lib/store-enrichment.ts",
	"src/lib/geocoding.ts",
];

const globs = ["!**/*.test.ts", "!**/__tests__/**", "!**/*.spec.ts"];

function main(): void {
	const globArgs = globs.map((glob) => `--glob '${glob}'`).join(" ");
	const command = `rg -n ${globArgs} "\\bthrow\\b" ${targets.join(" ")}`;

	try {
		const output = execSync(command, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});

		if (output.trim().length > 0) {
			console.error("Neverthrow boundary check failed. Found forbidden throw usage:");
			console.error(output.trim());
			process.exit(1);
		}
	} catch (error) {
		if (isExecError(error) && error.status === 1) {
			console.log("Neverthrow boundary check passed.");
			return;
		}

		if (isExecError(error)) {
			console.error("Neverthrow boundary check failed to run:");
			console.error(error.stderr || error.message);
			process.exit(1);
		}

		console.error("Neverthrow boundary check failed with unknown error.");
		process.exit(1);
	}
}

function isExecError(
	value: unknown,
): value is Error & { status?: number; stderr?: string } {
	return value instanceof Error;
}

main();
