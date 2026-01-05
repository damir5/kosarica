import { env } from 'cloudflare:test'
import { beforeAll } from 'vitest'

// Migrations are read in vitest.config.ts and passed via TEST_MIGRATIONS binding
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[]
  }
}

interface D1Migration {
  name: string
  queries: string[]
}

/**
 * Apply D1 migrations directly without importing from config module.
 * This avoids the node:worker_threads dependency issue.
 */
async function applyMigrations(
  db: D1Database,
  migrations: D1Migration[],
): Promise<void> {
  for (const migration of migrations) {
    // Collect all non-empty queries as prepared statements
    const statements: D1PreparedStatement[] = []
    for (const query of migration.queries) {
      const trimmed = query.trim()
      if (trimmed) {
        statements.push(db.prepare(trimmed))
      }
    }
    // Execute all statements in a batch
    if (statements.length > 0) {
      await db.batch(statements)
    }
  }
}

beforeAll(async () => {
  if (env.TEST_MIGRATIONS) {
    await applyMigrations(env.DB, env.TEST_MIGRATIONS)
  }
})
