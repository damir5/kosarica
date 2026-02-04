import { runBarcodeMatching } from "@/lib/matching";

async function main() {
  console.log("Running barcode matching...");
  const startTime = Date.now();

  const result = await runBarcodeMatching({ batchSize: 1000 });

  const duration = Date.now() - startTime;
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
  console.error("Error running barcode matching:", error);
  process.exit(1);
});
