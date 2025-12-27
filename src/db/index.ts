import { drizzle as drizzleD1 } from 'drizzle-orm/d1'
import * as schema from './schema'

export type Database = ReturnType<typeof createDb>

export function createDb(d1: D1Database) {
  return drizzleD1(d1, { schema })
}

// Re-export schema for convenience
export * from './schema'
