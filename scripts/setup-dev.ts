#!/usr/bin/env tsx
/**
 * Development setup script
 * - Initializes .dev.vars from example if missing
 * - Runs database migrations
 * - Seeds default admin user if database is empty
 */

import { execSync } from 'node:child_process'
import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes, scryptSync } from 'node:crypto'
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

function runOutput(cmd: string): string {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim()
  } catch {
    return ''
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

  // 1. Initialize .dev.vars from example
  const devVarsPath = resolve(ROOT, '.dev.vars')
  const devVarsExamplePath = resolve(ROOT, '.dev.vars.example')

  if (!existsSync(devVarsPath)) {
    if (existsSync(devVarsExamplePath)) {
      copyFileSync(devVarsExamplePath, devVarsPath)
      log('Created .dev.vars from .dev.vars.example')

      // Generate a random secret
      const secret = randomBytes(32).toString('hex')
      const content = readFileSync(devVarsPath, 'utf-8')
      const updated = content.replace(
        'your-secret-key-min-32-chars-here',
        secret
      )
      writeFileSync(devVarsPath, updated)
      log('Generated random BETTER_AUTH_SECRET')
    } else {
      error('.dev.vars.example not found, please create it first')
      process.exit(1)
    }
  } else {
    log('.dev.vars already exists, skipping')
  }

  // 2. Check if D1 database exists locally
  const wranglerDir = resolve(ROOT, '.wrangler')
  const d1Dir = resolve(wranglerDir, 'state', 'v3', 'd1')
  const dbExists = existsSync(d1Dir)

  // 3. Run migrations
  log('Running database migrations...')
  run('pnpm db:migrate:local')

  // 4. Seed default admin if this is a fresh database
  if (!dbExists) {
    log('Fresh database detected, seeding default admin user...')

    const now = Math.floor(Date.now() / 1000)
    const userId = generatePrefixedId('usr')
    const accountId = generatePrefixedId('acc')
    const passwordHash = hashPassword('admin123')

    // Create superadmin user
    const userSql = `INSERT INTO user (id, name, email, emailVerified, role, createdAt, updatedAt) VALUES ('${userId}', 'Admin', 'admin@local.dev', 1, 'superadmin', ${now}, ${now});`

    // Create credential account for password login
    const accountSql = `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES ('${accountId}', '${userId}', 'credential', '${userId}', '${passwordHash}', ${now}, ${now});`

    // Create default app settings
    const settingsId = generatePrefixedId('cfg')
    const settingsSql = `INSERT OR IGNORE INTO app_settings (id, appName, updatedAt) VALUES ('${settingsId}', 'Kosarica', ${now});`

    run(`wrangler d1 execute kosarica-db --local --command "${userSql}"`)
    run(`wrangler d1 execute kosarica-db --local --command "${accountSql}"`)
    run(`wrangler d1 execute kosarica-db --local --command "${settingsSql}"`)

    log('')
    log('='.repeat(50))
    log('Default superadmin user created:')
    log('  Email:    admin@local.dev')
    log('  Password: admin123')
    log('='.repeat(50))
    log('')
  } else {
    log('Database already exists, skipping seed')
  }

  log('Setup complete!')
}

main().catch((e) => {
  error(e.message)
  process.exit(1)
})
