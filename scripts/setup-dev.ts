#!/usr/bin/env tsx
/**
 * Development setup script
 * - Initializes .env from example if missing
 * - Runs database migrations
 * - Seeds default admin user if database is empty
 */

import { execSync } from 'node:child_process'
import { existsSync, copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomBytes, scryptSync } from 'node:crypto'
import Database from 'better-sqlite3'
import { generatePrefixedId } from '../src/utils/id'

const ROOT = resolve(import.meta.dirname, '..')

function log(msg: string) {
  console.log(`[setup] ${msg}`)
}

function error(msg: string) {
  console.error(`[setup] ERROR: ${msg}`)
}

function run(cmd: string, options?: { silent?: boolean }) {
  if (!options?.silent) log(`Running: ${cmd}`)
  try {
    return execSync(cmd, { cwd: ROOT, stdio: options?.silent ? 'pipe' : 'inherit' })
  } catch (e) {
    return null
  }
}

// Hash password using scrypt (better-auth compatible)
// Must match: N=16384, r=16, p=1, dkLen=64
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const normalizedPassword = password.normalize('NFKC')
  const hash = scryptSync(normalizedPassword, salt, 64, {
    N: 16384,
    r: 16,
    p: 1,
    maxmem: 128 * 16384 * 16 * 2,
  }).toString('hex')
  return `${salt}:${hash}`
}


async function main() {
  log('Starting development setup...')

  // 1. Initialize .env from example
  const envPath = resolve(ROOT, '.env')
  const envExamplePath = resolve(ROOT, '.env.example')

  if (!existsSync(envPath)) {
    if (existsSync(envExamplePath)) {
      copyFileSync(envExamplePath, envPath)
      log('Created .env from .env.example')

      // Generate a random secret
      const secret = randomBytes(32).toString('hex')
      const content = readFileSync(envPath, 'utf-8')
      const updated = content.replace(
        /^BETTER_AUTH_SECRET=.*$/m,
        `BETTER_AUTH_SECRET=${secret}`
      )
      writeFileSync(envPath, updated)
      log('Generated random BETTER_AUTH_SECRET')
    } else {
      error('.env.example not found, please create it first')
      process.exit(1)
    }
  } else {
    log('.env already exists, skipping')
  }

  // 2. Determine database path from .env
  const envContent = readFileSync(envPath, 'utf-8')
  const dbPathMatch = envContent.match(/^DATABASE_PATH=(.*)$/m)
  const dbPath = dbPathMatch ? dbPathMatch[1].trim() : './data/app.db'
  const fullDbPath = resolve(ROOT, dbPath)

  // Ensure data directory exists
  const dataDir = dirname(fullDbPath)
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
    log(`Created data directory: ${dataDir}`)
  }

  const dbExists = existsSync(fullDbPath)

  // 3. Run migrations
  log('Running database migrations...')
  run('pnpm db:migrate')

  // 4. Seed default admin if this is a fresh database
  if (!dbExists) {
    log('Fresh database detected, seeding default admin user...')

    const db = new Database(fullDbPath)

    try {
      const now = Math.floor(Date.now() / 1000)
      const userId = generatePrefixedId('usr')
      const accountId = generatePrefixedId('acc')
      const passwordHash = hashPassword('admin123')

      // Create superadmin user
      db.prepare(`
        INSERT INTO user (id, name, email, emailVerified, role, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, 'Admin', 'admin@local.dev', 1, 'superadmin', now, now)

      // Create credential account for password login
      db.prepare(`
        INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(accountId, userId, 'credential', userId, passwordHash, now, now)

      // Create default app settings
      const settingsId = generatePrefixedId('cfg')
      db.prepare(`
        INSERT OR IGNORE INTO app_settings (id, appName, updatedAt)
        VALUES (?, ?, ?)
      `).run(settingsId, 'Kosarica', now)

      log('')
      log('='.repeat(50))
      log('Default superadmin user created:')
      log('  Email:    admin@local.dev')
      log('  Password: admin123')
      log('='.repeat(50))
      log('')
    } finally {
      db.close()
    }
  } else {
    log('Database already exists, skipping seed')
  }

  log('Setup complete!')
}

main().catch((e) => {
  error(e.message)
  process.exit(1)
})
