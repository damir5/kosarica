import { getDatabase } from "./src/db/index.js";
import { llmEndpoints } from "./src/db/schema.js";

async function listEndpoints() {
    const db = getDatabase();
    const result = await db.select().from(llmEndpoints);
    console.log("LLM Endpoints:");
    console.table(result.map(r => ({
        id: r.id,
        provider: r.provider,
        model: r.model,
        enabled: r.enabled,
        timeoutMs: r.timeoutMs
    })));
    process.exit(0);
}

listEndpoints().catch(err => {
    console.error(err);
    process.exit(1);
});
