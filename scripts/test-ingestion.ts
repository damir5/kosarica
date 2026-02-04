import { config } from "dotenv";
config({ path: ".env.development" });
config();

import { runIngestion } from "@/ingestion/pipeline";

async function main() {
    console.log("Testing direct ingestion...");

    const result = await runIngestion({
        chainSlug: "konzum",
        targetDate: "2026-02-03",
        force: false,
        source: "test",
    });

    console.log("Ingestion result:", JSON.stringify(result, null, 2));
}

main().catch(e => {
    console.error("Error:", e);
    process.exit(1);
});
