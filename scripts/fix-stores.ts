import { and, eq, isNull, not, or, sql } from "drizzle-orm";
import { chains, storeEnrichmentTasks, stores } from "../src/db/schema";
import { generateDisplayNames, resolveChainName } from "../src/lib/store-names";
import { getDatabase } from "../src/db";
import { generatePrefixedId } from "../src/utils/id";

async function main() {
  const db = getDatabase();

  console.log("=== Step 1: Regenerate display names ===");
  
  // Fetch all stores with chain info
  const allStores = await db
    .select({
      id: stores.id,
      chainSlug: stores.chainSlug,
      name: stores.name,
      address: stores.address,
      city: stores.city,
      postalCode: stores.postalCode,
      displayNameManual: stores.displayNameManual,
      chainName: chains.name,
    })
    .from(stores)
    .innerJoin(chains, eq(stores.chainSlug, chains.slug));

  console.log(`Found ${allStores.length} stores`);

  // Generate display names
  const storesForNaming = allStores.map((s) => ({
    ...s,
    chainName: resolveChainName(s.chainSlug, s.chainName),
  }));

  const nameMap = generateDisplayNames(storesForNaming);
  console.log(`Generated ${nameMap.size} display names`);

  // Batch update display names
  const updates = Array.from(nameMap.entries());
  if (updates.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      const values = sql.join(
        batch.map(([id, name]) => sql`(${id}, ${name})`),
        sql`, `,
      );
      
      await db.execute(sql`
        UPDATE stores AS s
        SET display_name = src.display_name,
            updated_at = NOW()
        FROM (VALUES ${values}) AS src(id, display_name)
        WHERE s.id = src.id
      `);
      console.log(`Updated display names: ${Math.min(i + batchSize, updates.length)}/${updates.length}`);
    }
  }

  console.log("\n=== Step 2: Queue geocoding for stores without coordinates ===");
  
  // Find stores with city but no coordinates
  const storesNeedingGeocoding = await db
    .select({
      id: stores.id,
      name: stores.name,
      address: stores.address,
      city: stores.city,
      postalCode: stores.postalCode,
      latitude: stores.latitude,
      longitude: stores.longitude,
    })
    .from(stores)
    .where(
      and(
        not(isNull(stores.city)),
        or(isNull(stores.latitude), isNull(stores.longitude))
      )
    );

  console.log(`Found ${storesNeedingGeocoding.length} stores needing geocoding`);

  if (storesNeedingGeocoding.length > 0) {
    // Check for existing pending tasks
    const existingTasks = await db
      .select({ storeId: storeEnrichmentTasks.storeId })
      .from(storeEnrichmentTasks)
      .where(
        and(
          eq(storeEnrichmentTasks.type, "geocode"),
          eq(storeEnrichmentTasks.status, "pending")
        )
      );
    
    const pendingStoreIds = new Set(existingTasks.map((t) => t.storeId));
    const newStores = storesNeedingGeocoding.filter((s) => !pendingStoreIds.has(s.id));
    
    console.log(`Skipping ${pendingStoreIds.size} stores with pending tasks`);
    console.log(`Creating tasks for ${newStores.length} stores`);

    if (newStores.length > 0) {
      const now = new Date();
      const tasks = newStores.map((store) => ({
        id: generatePrefixedId("set"),
        storeId: store.id,
        type: "geocode" as const,
        status: "pending" as const,
        inputData: JSON.stringify({
          name: store.name,
          address: store.address,
          city: store.city,
          postalCode: store.postalCode,
          latitude: store.latitude,
          longitude: store.longitude,
        }),
        createdAt: now,
      }));

      const taskBatchSize = 100;
      for (let i = 0; i < tasks.length; i += taskBatchSize) {
        const batch = tasks.slice(i, i + taskBatchSize);
        await db.insert(storeEnrichmentTasks).values(batch);
        console.log(`Created geocoding tasks: ${Math.min(i + taskBatchSize, tasks.length)}/${tasks.length}`);
      }
    }
  }

  console.log("\n=== Done ===");
  
  // Final stats
  const finalStats = await db
    .select({
      chainSlug: stores.chainSlug,
      total: sql<number>`count(*)`.as("total"),
      withCity: sql<number>`count(city)`.as("with_city"),
      geocoded: sql<number>`count(latitude)`.as("geocoded"),
    })
    .from(stores)
    .groupBy(stores.chainSlug);

  console.log("\nStore stats by chain:");
  console.log("Chain".padEnd(12), "Total", "City", "Geocoded");
  for (const row of finalStats) {
    console.log(
      row.chainSlug.padEnd(12),
      String(row.total).padStart(5),
      String(row.withCity).padStart(4),
      String(row.geocoded).padStart(8)
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
