/**
 * SQL Batching Utilities for D1
 *
 * Cloudflare D1 has a limit of 100 SQL variables per query (not 999 like SQLite).
 * These utilities provide dynamic batching based on actual parameter counts.
 */

import type { Table } from 'drizzle-orm'

// Cloudflare D1 has a limit of 100 SQL variables per query.
// Use 80 for safety margin with upsert operations.
const D1_MAX_PARAMS = 80

/**
 * Generic database type that works with both D1 (production) and
 * BetterSQLite3 (CLI/local development).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDatabase = any

type DrizzleStatement = {
  toSQL: () => { params?: unknown[] }
}

/**
 * Get the parameter count from a Drizzle statement.
 *
 * @param statement - The Drizzle statement to inspect
 * @param context - Context string for error messages
 * @returns The number of bound parameters
 */
function getStatementParamCount(statement: unknown, context: string): number {
  if (!statement || typeof statement !== 'object') {
    throw new Error(`${context}: expected a Drizzle statement, received ${typeof statement}`)
  }

  const query = statement as Partial<DrizzleStatement>
  if (typeof query.toSQL !== 'function') {
    throw new Error(`${context}: statement is missing a toSQL() method, cannot determine parameter count`)
  }

  const result = query.toSQL()
  if (!result || !Array.isArray(result.params)) {
    throw new Error(`${context}: statement toSQL() did not return a params array`)
  }

  return result.params.length
}

/**
 * Options for batchInsert.
 */
export interface BatchInsertOptions<TData> {
  /**
   * Optional callback to modify the query (e.g. add onConflictDoUpdate).
   * Called each time a batch query is built.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modifyQuery?: (query: any) => any
  /**
   * Optional error handler. Errors are rethrown after the handler runs.
   */
  handleError?: (error: unknown, batch: TData[]) => Promise<void>
}

/**
 * Batches insert operations to avoid hitting D1's parameter limit.
 *
 * Uses dynamic batching based on actual parameter counts rather than
 * fixed batch sizes. This ensures inserts work regardless of column count.
 *
 * @param db - The Drizzle database instance
 * @param table - The table to insert into
 * @param data - The array of data to insert
 * @param options - Configuration options
 */
export async function batchInsert<TTable extends Table, TData extends Record<string, unknown>>(
  db: AnyDatabase,
  table: TTable,
  data: TData[],
  options: BatchInsertOptions<TData> = {},
): Promise<void> {
  if (data.length === 0) return

  let currentBatch: TData[] = []
  let lastHandledError: unknown = null

  const buildQuery = (batch: TData[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = db.insert(table).values(batch) as any
    if (options.modifyQuery) {
      query = options.modifyQuery(query)
    }
    return query
  }

  const executeBatch = async () => {
    if (currentBatch.length === 0) return

    const batch = currentBatch
    currentBatch = []

    const query = buildQuery(batch)

    try {
      await query
    } catch (error) {
      if (options.handleError) {
        await options.handleError(error, batch)
        lastHandledError = error
        return
      }
      throw error
    }
  }

  for (const row of data) {
    currentBatch.push(row)
    const query = buildQuery(currentBatch)
    const params = getStatementParamCount(query, 'batchInsert')

    if (params >= D1_MAX_PARAMS && currentBatch.length > 1) {
      // Remove the last row, flush previous batch, then retry with the row.
      currentBatch.pop()
      await executeBatch()

      currentBatch.push(row)
    }

    // If a single-row batch already exceeds the limit, we still attempt to run it
    // to surface the underlying error rather than looping forever.
    const singleRowQuery = buildQuery(currentBatch)
    const singleRowParams = getStatementParamCount(singleRowQuery, 'batchInsert')
    if (singleRowParams > D1_MAX_PARAMS && currentBatch.length === 1) {
      await executeBatch()
    }
  }

  await executeBatch()

  if (lastHandledError) {
    throw lastHandledError
  }
}

/**
 * Batches an array of statements using db.batch() to avoid hitting D1's parameter limit.
 * Useful for bulk updates or mixed operations.
 *
 * @param db - The Drizzle database instance
 * @param items - The array of items to process
 * @param buildStatement - A function that takes an item and returns a Drizzle statement
 */
export async function batchExecute<TItem>(
  db: AnyDatabase,
  items: TItem[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildStatement: (item: TItem) => any,
): Promise<void> {
  if (items.length === 0) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingStatements: any[] = []
  let currentParams = 0

  const flush = async () => {
    if (pendingStatements.length === 0) return
    await db.batch(pendingStatements)
    pendingStatements.length = 0
    currentParams = 0
  }

  for (const item of items) {
    const statement = buildStatement(item)
    const params = getStatementParamCount(statement, 'batchExecute')

    if (pendingStatements.length > 0 && currentParams + params > D1_MAX_PARAMS) {
      await flush()
    }

    pendingStatements.push(statement)
    currentParams += params

    if (currentParams >= D1_MAX_PARAMS) {
      await flush()
    }
  }

  await flush()
}

/**
 * Compute dynamic batch size for a table based on column count.
 * Returns the maximum number of rows that can fit in D1_MAX_PARAMS.
 *
 * @param columnsPerRow - Number of columns per row
 * @returns Maximum rows per batch
 */
export function computeBatchSize(columnsPerRow: number): number {
  return Math.max(1, Math.floor(D1_MAX_PARAMS / columnsPerRow))
}

export { D1_MAX_PARAMS }
