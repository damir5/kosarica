"use strict";

// scripts/update-display-names-and-geocode.ts
var import_drizzle_orm = require("drizzle-orm");
var import_db = require("@/db");
var import_schema = require("@/db/schema");
var import_store_names = require("@/lib/store-names");
var import_geocoding = require("@/lib/geocoding");
var import_logger = require("@/utils/logger");
var log = (0, import_logger.createLogger)("app");
var BASELINE_DELAY_MS = 1500;
function parseFlags() {
  const args = process.argv.slice(2);
  const flags = { dryRun: false };
  for (const arg of args) {
    if (arg === "--dry-run") {
      flags.dryRun = true;
    }
  }
  return flags;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function updateAllDisplayNames(dryRun) {
  const db = (0, import_db.getDatabase)();
  const allStores = await db.select({
    id: import_schema.stores.id,
    chainSlug: import_schema.stores.chainSlug,
    name: import_schema.stores.name,
    address: import_schema.stores.address,
    city: import_schema.stores.city,
    postalCode: import_schema.stores.postalCode,
    displayNameManual: import_schema.stores.displayNameManual,
    chainName: import_schema.chains.name
  }).from(import_schema.stores).innerJoin(import_schema.chains, (0, import_drizzle_orm.eq)(import_schema.stores.chainSlug, import_schema.chains.slug)).where(
    import_drizzle_orm.sql`${import_schema.stores.displayNameManual} = false OR ${import_schema.stores.displayNameManual} IS NULL`
  );
  if (allStores.length === 0) {
    console.log("No stores need display name updates.");
    return 0;
  }
  const storesForNaming = allStores.map((s) => ({
    id: s.id,
    chainSlug: s.chainSlug,
    name: s.name,
    address: s.address,
    city: s.city,
    postalCode: s.postalCode,
    displayNameManual: s.displayNameManual,
    chainName: (0, import_store_names.resolveChainName)(s.chainSlug, s.chainName)
  }));
  const nameMap = (0, import_store_names.generateDisplayNames)(storesForNaming);
  const updates = Array.from(nameMap.entries());
  if (dryRun) {
    console.log(`[DRY RUN] Would update ${updates.length} display names.`);
    for (const [id, name] of updates.slice(0, 5)) {
      console.log(`  ${id} -> "${name}"`);
    }
    if (updates.length > 5) {
      console.log(`  ... and ${updates.length - 5} more`);
    }
    return updates.length;
  }
  const BATCH_SIZE = 500;
  let written = 0;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    const values = import_drizzle_orm.sql.join(
      batch.map(([id, name]) => import_drizzle_orm.sql`(${id}, ${name})`),
      import_drizzle_orm.sql`, `
    );
    await db.execute(import_drizzle_orm.sql`
			UPDATE stores AS s
			SET display_name = src.display_name,
				updated_at = NOW()
			FROM (VALUES ${values}) AS src(id, display_name)
			WHERE s.id = src.id
		`);
    written += batch.length;
  }
  console.log(`Updated ${written} display names.`);
  return written;
}
async function main() {
  const flags = parseFlags();
  const db = (0, import_db.getDatabase)();
  console.log("=== Update Display Names + Batch Geocode ===");
  console.log(`  dry-run: ${flags.dryRun}`);
  console.log("");
  console.log("Step 1: Updating display names for all stores...");
  const displayNamesUpdated = await updateAllDisplayNames(flags.dryRun);
  console.log("");
  console.log("Step 2: Geocoding stores missing coordinates...");
  const storesToGeocode = await db.select({
    id: import_schema.stores.id,
    chainSlug: import_schema.stores.chainSlug,
    name: import_schema.stores.name,
    address: import_schema.stores.address,
    city: import_schema.stores.city,
    postalCode: import_schema.stores.postalCode
  }).from(import_schema.stores).where(import_drizzle_orm.sql`${import_schema.stores.latitude} IS NULL OR ${import_schema.stores.longitude} IS NULL`).orderBy(import_schema.stores.id);
  console.log(`Found ${storesToGeocode.length} stores missing coordinates.`);
  if (storesToGeocode.length === 0) {
    console.log("No stores to geocode.");
    return;
  }
  const stats = {
    displayNamesUpdated,
    processed: 0,
    geocodedHigh: 0,
    geocodedMedium: 0,
    skippedLow: 0,
    skippedNoData: 0,
    errors: 0,
    coordsWritten: 0,
    addressFieldsWritten: 0
  };
  let consecutiveFailures = 0;
  for (const store of storesToGeocode) {
    stats.processed += 1;
    if (!store.city && !store.address) {
      stats.skippedNoData += 1;
      if (stats.processed % 50 === 0) {
        printProgress(stats, storesToGeocode.length);
      }
      continue;
    }
    const outcome = await (0, import_geocoding.geocodeAddress)({
      address: store.address,
      city: store.city,
      postalCode: store.postalCode,
      country: "hr"
    });
    if (outcome.isErr()) {
      stats.errors += 1;
      consecutiveFailures += 1;
      console.error(`  [ERROR] ${store.id}: ${outcome.error.message}`);
      if (consecutiveFailures >= 3) {
        console.log("  Pausing 30s due to repeated failures...");
        await sleep(3e4);
      }
      await sleep(BASELINE_DELAY_MS);
      continue;
    }
    consecutiveFailures = 0;
    const result = outcome.value;
    if (!result.found) {
      stats.skippedLow += 1;
      await sleep(BASELINE_DELAY_MS);
      continue;
    }
    const { confidence, cityMatch } = result;
    const hasInputCity = Boolean(store.city?.trim());
    if (confidence === "high") {
      stats.geocodedHigh += 1;
      if (!flags.dryRun) {
        const updateData = {
          updatedAt: /* @__PURE__ */ new Date()
        };
        if (result.latitude && result.longitude) {
          updateData.latitude = result.latitude;
          updateData.longitude = result.longitude;
          stats.coordsWritten += 1;
        }
        if (result.city && !store.city) {
          updateData.city = result.city;
          stats.addressFieldsWritten += 1;
        }
        if (result.street && !store.address) {
          const addr = result.houseNumber ? `${result.street} ${result.houseNumber}` : result.street;
          updateData.address = addr;
          stats.addressFieldsWritten += 1;
        }
        if (result.postcode && !store.postalCode) {
          updateData.postalCode = result.postcode;
          stats.addressFieldsWritten += 1;
        }
        await db.update(import_schema.stores).set(updateData).where((0, import_drizzle_orm.eq)(import_schema.stores.id, store.id));
      }
      console.log(`  [HIGH] ${store.id}: ${result.displayName}`);
    } else if (confidence === "medium") {
      stats.geocodedMedium += 1;
      if (!flags.dryRun && cityMatch && hasInputCity) {
        const updateData = {
          updatedAt: /* @__PURE__ */ new Date()
        };
        if (result.street && !store.address) {
          const addr = result.houseNumber ? `${result.street} ${result.houseNumber}` : result.street;
          updateData.address = addr;
          stats.addressFieldsWritten += 1;
        }
        if (result.postcode && !store.postalCode) {
          updateData.postalCode = result.postcode;
          stats.addressFieldsWritten += 1;
        }
        if (Object.keys(updateData).length > 1) {
          await db.update(import_schema.stores).set(updateData).where((0, import_drizzle_orm.eq)(import_schema.stores.id, store.id));
        }
      }
      console.log(`  [MED]  ${store.id}: ${result.displayName} (cityMatch=${cityMatch})`);
    } else {
      stats.skippedLow += 1;
      console.log(`  [LOW]  ${store.id}: skipped (needs manual review)`);
    }
    if (stats.processed % 50 === 0) {
      printProgress(stats, storesToGeocode.length);
    }
    await sleep(BASELINE_DELAY_MS);
  }
  console.log("\n=== Summary ===");
  console.log(`  Display names updated: ${stats.displayNamesUpdated}`);
  console.log(`  Processed:           ${stats.processed}`);
  console.log(`  Geocoded (high):     ${stats.geocodedHigh} (auto-approved)`);
  console.log(`  Geocoded (med):      ${stats.geocodedMedium}`);
  console.log(`  Skipped (low):       ${stats.skippedLow} (needs review)`);
  console.log(`  Skipped (no data):    ${stats.skippedNoData}`);
  console.log(`  Errors:              ${stats.errors}`);
  console.log(`  Coords written:       ${stats.coordsWritten}`);
  console.log(`  Address fields:       ${stats.addressFieldsWritten}`);
}
function printProgress(stats, total) {
  const pct = (stats.processed / total * 100).toFixed(1);
  console.log(
    `  Progress: ${stats.processed}/${total} (${pct}%) | high=${stats.geocodedHigh} med=${stats.geocodedMedium} low=${stats.skippedLow} err=${stats.errors}`
  );
}
main().catch((err) => {
  log.error("Update display names + geocode failed", { error: err });
  console.error("Fatal:", err);
  process.exitCode = 1;
}).finally(() => {
  (0, import_db.closeDatabase)();
});
