import { config } from "dotenv";
config({ path: ".env.development" });
config();

import { runIngestion } from "@/ingestion/pipeline";
import { createLogger } from "@/utils/logger";

const log = createLogger("ingestion");

async function main() {
    console.log("Testing direct ingestion...");

    const result = await runIngestion({
        chainSlug: "konzum",
        targetDate: "2026-02-03",
        force: false,
        source: "test",
    });

    console.log("Ingestion result:", JSON.stringify(result, null, 2));
    log.info("Test ingestion completed", { result });
}

main().catch(e => {
    console.error("Error:", e);
    log.error("Test ingestion failed", { error: e });
    process.exit(1);
});
