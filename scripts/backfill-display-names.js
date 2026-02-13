"use strict";

// scripts/backfill-display-names.ts
var import_drizzle_orm = require("drizzle-orm");
var import_db = require("@/db");
var import_schema = require("@/db/schema");
var import_store_names = require("@/lib/store-names");
var import_logger = require("@/utils/logger");
var log = (0, import_logger.createLogger)("app");
function parseFlags() {
  const args = process.argv.slice(2);
  const flags = { dryRun: false, chain: null, force: false };
  for (const arg of args) {
    if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg.startsWith("--chain=")) {
      flags.chain = arg.slice("--chain=".length);
    } else if (arg === "--force") {
      flags.force = true;
    }
  }
  return flags;
}
async function main() {
  const flags = parseFlags();
  const db = (0, import_db.getDatabase)();
  console.log("=== Backfill Display Names ===");
  console.log(`  dry-run: ${flags.dryRun}`);
  console.log(`  chain:   ${flags.chain ?? "all"}`);
  console.log(`  force:   ${flags.force}`);
  console.log("");
  const conditions = [];
  if (flags.chain) {
    conditions.push((0, import_drizzle_orm.eq)(import_schema.stores.chainSlug, flags.chain));
  }
  const whereClause = conditions.length > 0 ? (0, import_drizzle_orm.and)(...conditions) : void 0;
  const allStores = await db.select({
    id: import_schema.stores.id,
    chainSlug: import_schema.stores.chainSlug,
    name: import_schema.stores.name,
    address: import_schema.stores.address,
    city: import_schema.stores.city,
    postalCode: import_schema.stores.postalCode,
    displayName: import_schema.stores.displayName,
    displayNameManual: import_schema.stores.displayNameManual,
    chainName: import_schema.chains.name
  }).from(import_schema.stores).innerJoin(import_schema.chains, (0, import_drizzle_orm.eq)(import_schema.stores.chainSlug, import_schema.chains.slug)).where(whereClause);
  console.log(`Fetched ${allStores.length} stores total.`);
  const storesForNaming = allStores.map((s) => ({
    id: s.id,
    chainSlug: s.chainSlug,
    name: s.name,
    address: s.address,
    city: s.city,
    postalCode: s.postalCode,
    displayNameManual: flags.force ? false : s.displayNameManual,
    chainName: (0, import_store_names.resolveChainName)(s.chainSlug, s.chainName)
  }));
  const nameMap = (0, import_store_names.generateDisplayNames)(storesForNaming);
  const updates = [];
  for (const store of allStores) {
    const newName = nameMap.get(store.id);
    if (!newName) continue;
    if (store.displayName !== newName) {
      updates.push({
        id: store.id,
        oldName: store.displayName,
        newName
      });
    }
  }
  console.log(`Changes needed: ${updates.length}`);
  console.log(`Skipped (manual): ${allStores.length - nameMap.size}`);
  console.log("");
  if (updates.length === 0) {
    console.log("Nothing to update.");
    return;
  }
  const previewCount = Math.min(updates.length, 20);
  console.log(`Preview (first ${previewCount}):`);
  for (const update of updates.slice(0, previewCount)) {
    console.log(`  ${update.id}: "${update.oldName ?? "(null)"}" \u2192 "${update.newName}"`);
  }
  if (updates.length > previewCount) {
    console.log(`  ... and ${updates.length - previewCount} more`);
  }
  console.log("");
  if (flags.dryRun) {
    console.log("Dry run \u2014 no changes written.");
    return;
  }
  const BATCH_SIZE = 500;
  let written = 0;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    const values = import_drizzle_orm.sql.join(
      batch.map(
        (u) => import_drizzle_orm.sql`(${u.id}, ${u.newName})`
      ),
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
    if (written % 1e3 === 0 || written === updates.length) {
      console.log(`  Written ${written}/${updates.length}`);
    }
  }
  console.log(`
Done. Updated ${written} stores.`);
}
main().catch((err) => {
  log.error("Backfill failed", { error: err });
  console.error("Fatal:", err);
  process.exitCode = 1;
}).finally(() => {
  (0, import_db.closeDatabase)();
});
