import { config } from "dotenv";
config({ path: ".env.development" });
config();

import { scheduleTask } from "@/lib/taskqueue";
import { chainIds } from "@/ingestion/adapters/config";

const TARGET_DATE = "2026-02-06";

async function main() {
  console.log(`Scheduling ingestion for ${chainIds.length} chains for date ${TARGET_DATE}...`);

  const taskIds: string[] = [];

  for (const chain of chainIds) {
    try {
      const result = await scheduleTask({
        taskType: "ingestion",
        priority: 10,
        payload: {
          type: "ingestion",
          chainSlug: chain,
          targetDate: TARGET_DATE,
          force: true,
          source: "bulk-2026",
        },
      });
      taskIds.push(result.id);
      console.log(`  ✓ Scheduled ingestion for ${chain}: ${result.id}`);
    } catch (error) {
      console.error(`  ✗ Failed to schedule ingestion for ${chain}:`, error);
    }
  }

  console.log(`\nScheduled ${taskIds.length} ingestion tasks:`);
  console.log(`  Chains: ${chainIds.join(", ")}`);
  console.log(`  Date: ${TARGET_DATE}`);
  console.log(`  Task IDs: ${taskIds.join(", ")}`);
  console.log("\nWorker will process these tasks in the background.");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
