#!/usr/bin/env tsx
/**
 * Sync Remote Database to Local
 *
 * Downloads a remote D1 database (test or prod) and restores it to the local development database.
 * Creates a backup of the current local database before overwriting.
 *
 * Usage:
 *   pnpm db:sync-test          # Sync from test environment
 *   pnpm db:sync-prod          # Sync from prod environment
 *   tsx scripts/sync-db.ts --source=test
 *   tsx scripts/sync-db.ts --source=prod
 */
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[0;31m",
  green: "\x1b[0;32m",
  yellow: "\x1b[1;33m",
  blue: "\x1b[0;34m",
  magenta: "\x1b[0;35m",
  cyan: "\x1b[0;36m",
};

function log(message: string, color: keyof typeof colors = "reset"): void {
  console.log(`${colors[color]}[SYNC-DB]${colors.reset} ${message}`);
}

function logError(message: string): void {
  console.error(`${colors.red}[SYNC-DB] ERROR:${colors.reset} ${message}`);
}

/**
 * Compute the sqlite filename from database_id using miniflare's hash function.
 * This matches the algorithm in miniflare's durableObjectNamespaceIdFromName().
 */
function computeSqliteFilename(databaseId: string): string {
  const uniqueKey = "miniflare-D1DatabaseObject";
  const key = createHash("sha256").update(uniqueKey).digest();
  const nameHmac = createHmac("sha256", key).update(databaseId).digest().subarray(0, 16);
  const hmac = createHmac("sha256", key).update(nameHmac).digest().subarray(0, 16);
  return Buffer.concat([nameHmac, hmac]).toString("hex");
}

/**
 * Parse a wrangler JSONC config file to extract D1 database configuration.
 * Handles JSONC (JSON with comments) by stripping comments.
 */
function parseWranglerConfig(configPath: string): { databaseName: string; databaseId: string } {
  const fullPath = resolve(process.cwd(), configPath);
  if (!existsSync(fullPath)) {
    throw new Error(`${configPath} not found`);
  }

  const content = readFileSync(fullPath, "utf-8");
  // Strip single-line comments (// ...) and multi-line comments (/* ... */)
  const jsonContent = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  const config = JSON.parse(jsonContent);
  const d1Databases = config.d1_databases;

  if (!d1Databases || d1Databases.length === 0) {
    throw new Error(`No d1_databases found in ${configPath}`);
  }

  const db = d1Databases[0];
  return {
    databaseName: db.database_name,
    databaseId: db.database_id,
  };
}

/**
 * Create a timestamped backup of the current local database.
 */
function backupCurrentDatabase(sqlitePath: string): void {
  if (!existsSync(sqlitePath)) {
    log("No existing local database to backup", "yellow");
    return;
  }

  const backupsDir = resolve(process.cwd(), "backups");
  mkdirSync(backupsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = `local-db-backup-${timestamp}.zip`;
  const backupPath = join(backupsDir, backupName);

  log(`Creating backup: ${backupName}`, "cyan");

  const sqliteDir = resolve(sqlitePath, "..");
  const sqliteFilename = sqlitePath.split("/").pop()!;

  const result = spawnSync(
    "zip",
    ["-j", backupPath, `${sqliteFilename}`, `${sqliteFilename}-wal`, `${sqliteFilename}-shm`],
    {
      cwd: sqliteDir,
      stdio: "pipe",
    },
  );

  if (result.status !== 0) {
    // zip returns 12 if some files don't exist (WAL/SHM), that's okay
    if (result.status !== 12) {
      logError(`Backup failed: ${result.stderr?.toString()}`);
      throw new Error("Backup failed");
    }
  }

  log(`Backup created: ${backupPath}`, "green");
}

/**
 * Export remote database using wrangler.
 */
function exportRemoteDatabase(databaseName: string, configPath: string, outputPath: string): void {
  log(`Exporting remote database: ${databaseName}`, "cyan");
  log(`Using config: ${configPath}`, "blue");
  log("This may take a few minutes...", "yellow");

  const result = spawnSync(
    "wrangler",
    ["d1", "export", databaseName, "--remote", `--config=${configPath}`, `--output=${outputPath}`],
    {
      stdio: "inherit",
      cwd: process.cwd(),
    },
  );

  if (result.status !== 0) {
    throw new Error(`Failed to export remote database (exit code: ${result.status})`);
  }

  log("Remote database exported", "green");
}

/**
 * Delete local database files.
 */
function deleteLocalDatabase(sqlitePath: string): void {
  log("Deleting local database files", "cyan");

  const files = [sqlitePath, `${sqlitePath}-wal`, `${sqlitePath}-shm`];

  for (const file of files) {
    if (existsSync(file)) {
      rmSync(file);
      log(`Deleted: ${file.split("/").pop()}`, "yellow");
    }
  }
}

/**
 * Import SQL file into local database using sqlite3.
 * Wraps content with optimization pragmas for faster import.
 */
function importDatabase(sqlitePath: string, sqlFilePath: string): void {
  log("Importing database with optimizations...", "cyan");

  const sqliteDir = resolve(sqlitePath, "..");
  mkdirSync(sqliteDir, { recursive: true });

  const startTime = Date.now();
  const sqlContent = readFileSync(sqlFilePath, "utf-8");

  const optimizedSql = `
PRAGMA journal_mode = MEMORY;
PRAGMA synchronous = OFF;
PRAGMA foreign_keys = OFF;
PRAGMA cache_size = -64000;
BEGIN TRANSACTION;
${sqlContent}
COMMIT;
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
`;

  const result = spawnSync("sqlite3", [sqlitePath], {
    input: optimizedSql,
    stdio: ["pipe", "inherit", "inherit"],
    maxBuffer: 500 * 1024 * 1024,
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  if (result.status !== 0) {
    throw new Error(`Failed to import database (exit code: ${result.status})`);
  }

  log(`Database imported in ${duration}s`, "green");
}

const CONFIG_MAP = {
  test: "wrangler.test.jsonc",
  prod: "wrangler.prod.jsonc",
} as const;

const LOCAL_CONFIG = "wrangler.jsonc";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      source: { type: "string", short: "s" },
    },
  });

  const source = values.source as "test" | "prod" | undefined;

  if (!source || !["test", "prod"].includes(source)) {
    logError("Please specify --source=test or --source=prod");
    console.log("\nUsage:");
    console.log("  pnpm db:sync-test    # Sync from test environment");
    console.log("  pnpm db:sync-prod    # Sync from prod environment");
    process.exit(1);
  }

  const remoteConfig = CONFIG_MAP[source];

  try {
    log(`Starting ${source} database sync`, "magenta");

    const remote = parseWranglerConfig(remoteConfig);
    const local = parseWranglerConfig(LOCAL_CONFIG);

    log(`Remote database: ${remote.databaseName} (from ${remoteConfig})`, "blue");
    log(`Local database: ${local.databaseName} (from ${LOCAL_CONFIG})`, "blue");

    const sqliteFilename = computeSqliteFilename(local.databaseId);
    log(`Computed sqlite filename: ${sqliteFilename}.sqlite`, "blue");

    const sqlitePath = resolve(
      process.cwd(),
      ".wrangler/state/v3/d1/miniflare-D1DatabaseObject",
      `${sqliteFilename}.sqlite`,
    );

    backupCurrentDatabase(sqlitePath);

    const tempSqlPath = join(tmpdir(), `${source}-export-${Date.now()}.sql`);
    exportRemoteDatabase(remote.databaseName, remoteConfig, tempSqlPath);

    deleteLocalDatabase(sqlitePath);
    importDatabase(sqlitePath, tempSqlPath);

    log("Cleaning up temp files", "cyan");
    unlinkSync(tempSqlPath);

    log(`${source.charAt(0).toUpperCase() + source.slice(1)} database sync complete!`, "green");
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
