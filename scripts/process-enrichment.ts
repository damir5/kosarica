import { eq } from "drizzle-orm";
import { getDatabase } from "../src/db";
import { storeEnrichmentTasks, stores } from "../src/db/schema";
import { geocodeAddress, type GeocodingInput } from "../src/lib/geocoding";

async function processGeocodeTask(task: { id: string; storeId: string; inputData: string }) {
  const db = getDatabase();
  
  // Update task to processing
  await db
    .update(storeEnrichmentTasks)
    .set({ status: "processing" })
    .where(eq(storeEnrichmentTasks.id, task.id));

  // Get store
  const [store] = await db
    .select()
    .from(stores)
    .where(eq(stores.id, task.storeId));

  if (!store) {
    await db
      .update(storeEnrichmentTasks)
      .set({ status: "failed", errorMessage: "Store not found" })
      .where(eq(storeEnrichmentTasks.id, task.id));
    return { success: false, error: "Store not found" };
  }

  try {
    const input: GeocodingInput = {
      address: store.address,
      city: store.city,
      postalCode: store.postalCode,
      country: "hr",
    };

    const result = await geocodeAddress(input);

    if (result.latitude && result.longitude) {
      await db
        .update(stores)
        .set({
          latitude: result.latitude.toString(),
          longitude: result.longitude.toString(),
          updatedAt: new Date(),
        })
        .where(eq(stores.id, store.id));

      await db
        .update(storeEnrichmentTasks)
        .set({ status: "completed" })
        .where(eq(storeEnrichmentTasks.id, task.id));

      return { success: true };
    } else {
      await db
        .update(storeEnrichmentTasks)
        .set({ status: "failed", errorMessage: "No coordinates returned" })
        .where(eq(storeEnrichmentTasks.id, task.id));

      return { success: false, error: "No coordinates returned" };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(storeEnrichmentTasks)
      .set({ status: "failed", errorMessage })
      .where(eq(storeEnrichmentTasks.id, task.id));

    return { success: false, error: errorMessage };
  }
}

async function main() {
  const db = getDatabase();
  const batchSize = 10;
  let processed = 0;
  let success = 0;
  let failed = 0;

  console.log("Starting geocoding enrichment processing...");

  while (true) {
    const tasks = await db
      .select({
        id: storeEnrichmentTasks.id,
        storeId: storeEnrichmentTasks.storeId,
        inputData: storeEnrichmentTasks.inputData,
      })
      .from(storeEnrichmentTasks)
      .where(eq(storeEnrichmentTasks.status, "pending"))
      .limit(batchSize);

    if (tasks.length === 0) {
      console.log("No more pending tasks");
      break;
    }

    for (const task of tasks) {
      const result = await processGeocodeTask(task);
      processed++;
      if (result.success) {
        success++;
        console.log(`[${processed}] Geocoded store ${task.storeId}`);
      } else {
        failed++;
        console.log(`[${processed}] Failed for store ${task.storeId}: ${result.error}`);
      }
      
      // Rate limiting: wait 200ms between requests
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log(`Progress: ${processed} processed, ${success} success, ${failed} failed`);
  }

  console.log("\n=== Final Stats ===");
  console.log(`Total processed: ${processed}`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);

  // Show remaining pending
  const remaining = await db
    .select({ count: sql`count(*)` })
    .from(storeEnrichmentTasks)
    .where(eq(storeEnrichmentTasks.status, "pending"));
  console.log(`Remaining pending: ${remaining[0]?.count}`);

  process.exit(0);
}

import { sql } from "drizzle-orm";
main().catch(console.error);
