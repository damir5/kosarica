import { getDatabase } from "./src/db";
import { llmEndpoints } from "./src/db/schema";
import { eq } from "drizzle-orm";

async function checkTimeout() {
    const db = getDatabase();
    const result = await db.select({
        id: llmEndpoints.id,
        model: llmEndpoints.model,
        timeoutMs: llmEndpoints.timeoutMs
    }).from(llmEndpoints);

    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
}

checkTimeout().catch(err => {
    console.error(err);
    process.exit(1);
});
