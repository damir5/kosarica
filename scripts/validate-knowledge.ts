import { validateCatalog } from "@/lib/knowledge/validator";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

async function main() {
	const catalogDir = getArgValue("--catalog-dir");
	const result = await validateCatalog(catalogDir ?? undefined);

	if (result.valid) {
		console.log("Knowledge catalog is valid");
		return;
	}

	console.error(`Knowledge catalog validation failed (${result.errors.length} errors):`);
	for (const issue of result.errors) {
		const path = issue.path ? ` (${issue.path})` : "";
		console.error(`- ${issue.file}${path}: ${issue.message}`);
	}

	process.exitCode = 1;
}

function getArgValue(flag: string): string | null {
	const argv = process.argv.slice(2);
	const idx = argv.indexOf(flag);
	if (idx === -1) {
		return null;
	}
	return argv[idx + 1] ?? null;
}

main().catch((error) => {
	log.error("Knowledge validation failed unexpectedly", { error });
	process.exit(1);
});
