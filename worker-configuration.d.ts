// Cloudflare D1 Database type (from @cloudflare/workers-types)
interface D1Database {
  prepare(query: string): D1PreparedStatement
  dump(): Promise<ArrayBuffer>
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
  exec(query: string): Promise<D1ExecResult>
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(colName?: string): Promise<T | null>
  run<T = unknown>(): Promise<D1Result<T>>
  all<T = unknown>(): Promise<D1Result<T>>
  raw<T = unknown>(): Promise<T[]>
}

interface D1Result<T = unknown> {
  results?: T[]
  success: boolean
  error?: string
  meta?: {
    duration: number
    last_row_id: number | null
    changes: number | null
    served_by: string
    internal_stats: unknown
  }
}

interface D1ExecResult {
  count: number
  duration: number
}

// Application environment bindings
interface Env {
  DB: D1Database
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  PASSKEY_RP_ID?: string
  PASSKEY_RP_NAME?: string
}
