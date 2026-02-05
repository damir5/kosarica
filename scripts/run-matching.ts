import { runBarcodeMatching } from "@/lib/matching";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

async function main() {
  log.info("Running barcode matching...");
  const startTime = Date.now();

  const result = await runBarcodeMatching({ batchSize: 1000 });

  const duration = Date.now() - startTime;
  // Use console.log for user-facing results
  console.log("\n=== Barcode Matching Results ===");
  console.log(`Run ID: ${result.runId}`);
  console.log(`New products: ${result.newProducts}`);
  console.log(`New links: ${result.newLinks}`);
  console.log(`Suspicious flags: ${result.suspiciousFlags}`);
  console.log(`Skipped (invalid barcodes): ${result.skipped}`);
  console.log(`Duration: ${duration}ms`);
  console.log("===============================\n");
}

main().catch((error) => {
  log.error("Error running barcode matching", { error });
  process.exit(1);
});
