#!/usr/bin/env tsx
/**
 * Trigger Bulk Ingestion Script
 * 
 * Triggers ingestion tasks for all configured chains and specified dates
 */

import { chainIds } from "@/ingestion/adapters/config";
import { getDatabase } from "@/db";
import { scheduleTask } from "@/lib/taskqueue";
import { createLogger } from "@/utils/logger";

const log = createLogger("ingestion");

const args = process.argv.slice(2);
const datesArg = args.find((arg) => arg.startsWith("--dates="))?.split("=")[1];
const chainsArg = args.find((arg) => arg.startsWith("--chains="))?.split("=")[1];

const targetDates = datesArg
  ? datesArg.split(",")
  : ["2026-02-07", "2026-02-08", "2026-02-09"];

const chains = chainsArg
  ? chainsArg.split(",").map((c) => c.trim())
  : chainIds;

log.info("Starting bulk ingestion", {
  targetDates,
  chains,
  totalTasks: targetDates.length * chains.length,
});

const db = getDatabase();

async function main() {
  let scheduled = 0;
  let skipped = 0;

  for (const date of targetDates) {
    for (const chain of chains) {
      try {
        // Check if already ingested for this date/chain
        const existingRun = await db.execute(`
          SELECT id, status
          FROM ingestion_runs
          WHERE chain_slug = '${chain}'
          AND target_date::date = '${date}'
          AND source = 'scheduled'
          ORDER BY started_at DESC
          LIMIT 1
        `);

        const rows = (existingRun as { rows?: unknown[] }).rows ?? [];
        if (rows.length > 0) {
          const run = rows[0] as { id: string; status: string };
          log.info(`Skipping ${chain} for ${date} - already ${run.status}`, {
            runId: run.id,
          });
          skipped++;
          continue;
        }

        await scheduleTask({
          taskType: "ingestion",
          priority: 0,
          payload: {
            type: "ingestion",
            chainSlug: chain,
            targetDate: date,
            force: false,
            source: "manual",
          },
        });

        log.info(`Scheduled ${chain} for ${date}`);
        scheduled++;
      } catch (error) {
        log.error(`Failed to schedule ${chain} for ${date}`, { error });
      }
    }
  }

  log.info("Bulk ingestion complete", {
    scheduled,
    skipped,
    total: scheduled + skipped,
  });
}

main().catch((error) => {
  log.error("Bulk ingestion failed", { error });
  process.exit(1);
});
