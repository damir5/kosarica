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

const patterns = [
	{ regex: "\\bthrow\\b", label: "throw" },
	{ regex: "\\btry\\b", label: "try" },
	{ regex: "\\bcatch\\b", label: "catch" },
] as const;

interface ViolationResult {
	label: string;
	output: string;
}

function searchPattern(pattern: string): string {
	const globArgs = globs.map((glob) => `--glob '${glob}'`).join(" ");
	const command = `rg -n ${globArgs} "${pattern}" ${targets.join(" ")}`;

	try {
		return execSync(command, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		// rg returns exit code 1 when no matches found - this is success
		if (isExecError(error) && error.status === 1) {
			return "";
		}
		throw error;
	}
}

function main(): void {
	const violations: ViolationResult[] = [];

	for (const { regex, label } of patterns) {
		const output = searchPattern(regex);
		if (output.trim().length > 0) {
			violations.push({ label, output: output.trim() });
		}
	}

	if (violations.length > 0) {
		console.error("Neverthrow boundary check failed. Found forbidden keywords:");
		console.error("");

		for (const { label, output } of violations) {
			console.error(`--- ${label} ---`);
			console.error(output);
			console.error("");
		}

		process.exit(1);
	}

	console.log("Neverthrow boundary check passed.");
}

function isExecError(
	value: unknown,
): value is Error & { status?: number; stderr?: string } {
	return value instanceof Error;
}

main();
