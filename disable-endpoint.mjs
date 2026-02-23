import { getDatabase } from "./src/db/index.js";
import { llmEndpoints } from "./src/db/schema.js";
import { eq, and } from "drizzle-orm";

async function disableFailingEndpoint() {
    const db = getDatabase();
    const result = await db.update(llmEndpoints)
        .set({ enabled: false })
        .where(and(
            eq(llmEndpoints.provider, 'nvidia-nim'),
            eq(llmEndpoints.model, 'stepfun-ai/step-3.5-flash')
        ));
    
    console.log(`Disabled failing endpoint: ${result.count} rows affected`);
    process.exit(0);
}

disableFailingEndpoint().catch(err => {
    console.error(err);
    process.exit(1);
});
