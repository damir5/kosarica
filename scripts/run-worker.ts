import { startWorker } from "@/lib/taskqueue/ingestion-worker";
import { config } from "dotenv";

const nodeEnv = process.env.NODE_ENV || "development";
config({ path: `.env.${nodeEnv}` });
config();

console.log("Starting ingestion worker...");
await startWorker();
