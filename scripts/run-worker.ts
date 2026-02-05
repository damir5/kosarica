import { startWorker } from "@/lib/taskqueue/run-worker";
import { config } from "dotenv";
import { createLogger } from "@/utils/logger";

const log = createLogger("scheduler");

const nodeEnv = process.env.NODE_ENV || "development";
config({ path: `.env.${nodeEnv}` });
config();

log.info("Starting worker...");
await startWorker();
