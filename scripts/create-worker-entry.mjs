#!/usr/bin/env node
/**
 * Creates a wrapper entry point for Cloudflare Workers.
 *
 * TanStack Start exports additional symbols that confuse wrangler when loading
 * the worker. This script creates a simple wrapper that only exports the
 * default handler.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Find the worker-entry file (it has a hash in the name)
const assetsDir = join(process.cwd(), 'dist/server/assets')

let files
try {
  files = readdirSync(assetsDir)
} catch {
  console.error('Could not read dist/server/assets directory')
  console.error('Make sure to run vite build first')
  process.exit(1)
}

const workerEntryFile = files.find(
  (f) => f.startsWith('worker-entry-') && f.endsWith('.js')
)

if (!workerEntryFile) {
  console.error('Could not find worker-entry-*.js in dist/server/assets')
  process.exit(1)
}

const workerEntryPath = join(assetsDir, workerEntryFile)
const content = readFileSync(workerEntryPath, 'utf-8')

// Find the export name for workerEntry (may be minified)
const match = content.match(/workerEntry as ([a-zA-Z0-9_$]+)/)

if (match) {
  const exportName = match[1]
  console.log(`Found workerEntry export name: ${exportName}`)

  const workerEntry = `// Wrapper to export only the default handler for Cloudflare Workers
import { ${exportName} as server } from './assets/${workerEntryFile}';
export default server;
`

  const outputPath = join(process.cwd(), 'dist/server/index.js')
  writeFileSync(outputPath, workerEntry, 'utf-8')

  console.log('Created worker entry point at dist/server/index.js')
} else {
  console.warn('Could not find workerEntry export name')
  console.warn('Worker entry may not work correctly')
}
