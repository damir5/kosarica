import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import * as schemas from "../src/db/jsonb-schemas";

const outputDir = "shared/schemas/jsonb";
mkdirSync(outputDir, { recursive: true });

// Map schema names to their Zod schemas
const schemaMap = {
	"task-queue-payload": schemas.taskQueuePayload,
	"validation-errors": schemas.validationErrors,
	"cron-job-payload": schemas.cronJobPayload,
	"cron-run-metadata": schemas.cronRunMetadata,
	"archive-metadata": schemas.archiveMetadata,
};

for (const [name, schema] of Object.entries(schemaMap)) {
	// Use Zod v4's native z.toJSONSchema()
	const jsonSchema = z.toJSONSchema(schema, { target: "draft-07" });

	// Add title based on filename
	const title = name
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join("");
	(jsonSchema as Record<string, unknown>).title = title;

	writeFileSync(`${outputDir}/${name}.json`, JSON.stringify(jsonSchema, null, 2));
	console.log(`Generated ${name}.json`);
}

console.log("Generated JSON schemas in", outputDir);
