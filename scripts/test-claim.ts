import { config } from "dotenv";
config({ path: ".env.development" });
config();

import { claimTasks, startProcessing } from "@/lib/taskqueue/index";

async function main() {
    console.log("Testing task claim...");
    const tasks = await claimTasks("test-worker", 1, ["ingestion"]);
    console.log("Claimed tasks:", JSON.stringify(tasks, null, 2));

    if (tasks.length > 0) {
        console.log("Starting processing...");
        await startProcessing(tasks[0].id);
        console.log("Task processing started");
        console.log("Payload:", tasks[0].payload);
    }
}

main().catch(e => {
    console.error("Error:", e);
    process.exit(1);
});
