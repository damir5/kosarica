/**
 * CLI Command: Parse a single file using a chain adapter
 *
 * Usage: npx tsx src/ingestion/cli/parse.ts -c konzum -f <path>
 *
 * Parses a price data file using the specified chain adapter and outputs
 * the result as a summary table or JSON.
 */

import { Command } from 'commander'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import {
  CHAIN_IDS,
  isValidChainId,
  chainAdapterRegistry,
  type ChainId,
} from '../chains'
import type { ParseResult, ParseOptions, NormalizedRow } from '../core/types'

// Import all chain adapter factories
import { createKonzumAdapter } from '../chains/konzum'
import { createLidlAdapter } from '../chains/lidl'
import { createPlodineAdapter } from '../chains/plodine'
import { createIntersparAdapter } from '../chains/interspar'
import { createStudenacAdapter } from '../chains/studenac'
import { createKauflandAdapter } from '../chains/kaufland'
import { createEurospinAdapter } from '../chains/eurospin'
import { createDmAdapter } from '../chains/dm'
import { createKtcAdapter } from '../chains/ktc'
import { createMetroAdapter } from '../chains/metro'
import { createTrgocentarAdapter } from '../chains/trgocentar'

/**
 * Register all chain adapters in the registry.
 */
function registerAllAdapters(): void {
  chainAdapterRegistry.register('konzum', createKonzumAdapter())
  chainAdapterRegistry.register('lidl', createLidlAdapter())
  chainAdapterRegistry.register('plodine', createPlodineAdapter())
  chainAdapterRegistry.register('interspar', createIntersparAdapter())
  chainAdapterRegistry.register('studenac', createStudenacAdapter())
  chainAdapterRegistry.register('kaufland', createKauflandAdapter())
  chainAdapterRegistry.register('eurospin', createEurospinAdapter())
  chainAdapterRegistry.register('dm', createDmAdapter())
  chainAdapterRegistry.register('ktc', createKtcAdapter())
  chainAdapterRegistry.register('metro', createMetroAdapter())
  chainAdapterRegistry.register('trgocentar', createTrgocentarAdapter())
}

/**
 * Format a price value in cents to a displayable string.
 */
function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * Truncate a string to a maximum length.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}

/**
 * Print a summary of the parse result.
 */
function printSummary(result: ParseResult, filename: string): void {
  console.log('\n=== Parse Summary ===')
  console.log(`File: ${filename}`)
  console.log(`Total rows: ${result.totalRows}`)
  console.log(`Valid rows: ${result.validRows}`)
  console.log(`Errors: ${result.errors.length}`)
  console.log(`Warnings: ${result.warnings.length}`)

  if (result.errors.length > 0) {
    console.log('\n--- Errors (first 10) ---')
    result.errors.slice(0, 10).forEach((err) => {
      const location = err.rowNumber ? `Row ${err.rowNumber}` : 'Unknown row'
      const field = err.field ? ` [${err.field}]` : ''
      console.log(`  ${location}${field}: ${err.message}`)
      if (err.originalValue) {
        console.log(`    Original value: "${truncate(err.originalValue, 50)}"`)
      }
    })
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more errors`)
    }
  }

  if (result.warnings.length > 0) {
    console.log('\n--- Warnings (first 10) ---')
    result.warnings.slice(0, 10).forEach((warn) => {
      const location = warn.rowNumber ? `Row ${warn.rowNumber}` : 'Unknown row'
      const field = warn.field ? ` [${warn.field}]` : ''
      console.log(`  ${location}${field}: ${warn.message}`)
    })
    if (result.warnings.length > 10) {
      console.log(`  ... and ${result.warnings.length - 10} more warnings`)
    }
  }
}

/**
 * Print rows in a table format.
 */
function printTable(rows: NormalizedRow[], maxRows: number = 10): void {
  if (rows.length === 0) {
    console.log('\nNo rows to display.')
    return
  }

  const displayRows = rows.slice(0, maxRows)

  console.log('\n--- Sample Rows ---')
  console.log(
    '| Row | Store | Name | Price | Discount | Barcodes |',
  )
  console.log(
    '|-----|-------|------|-------|----------|----------|',
  )

  for (const row of displayRows) {
    const store = truncate(row.storeIdentifier || '-', 12)
    const name = truncate(row.name || '-', 30)
    const price = formatPrice(row.price)
    const discount = row.discountPrice ? formatPrice(row.discountPrice) : '-'
    const barcodes = row.barcodes.length > 0 ? truncate(row.barcodes.join(','), 20) : '-'

    console.log(
      `| ${row.rowNumber.toString().padStart(3)} | ${store.padEnd(12)} | ${name.padEnd(30)} | ${price.padStart(7)} | ${discount.padStart(8)} | ${barcodes.padEnd(20)} |`,
    )
  }

  if (rows.length > maxRows) {
    console.log(`\n... and ${rows.length - maxRows} more rows`)
  }
}

/**
 * Main CLI function.
 */
async function main(): Promise<void> {
  const program = new Command()

  program
    .name('parse')
    .description('Parse a single price data file using a chain adapter')
    .requiredOption('-c, --chain <chain>', `Chain ID (${CHAIN_IDS.join(', ')})`)
    .requiredOption('-f, --file <path>', 'Path to file to parse')
    .option('-l, --limit <n>', 'Limit rows parsed (for testing)', parseInt)
    .option('--json', 'Output result as JSON')
    .option('--skip-invalid', 'Skip rows with validation errors')

  program.parse()

  const opts = program.opts<{
    chain: string
    file: string
    limit?: number
    json?: boolean
    skipInvalid?: boolean
  }>()

  // Validate chain ID
  if (!isValidChainId(opts.chain)) {
    console.error(`Error: Invalid chain ID "${opts.chain}"`)
    console.error(`Valid chain IDs: ${CHAIN_IDS.join(', ')}`)
    process.exit(1)
  }

  const chainId: ChainId = opts.chain

  // Resolve file path
  const filePath = path.resolve(opts.file)

  // Check if file exists
  try {
    await fs.access(filePath)
  } catch {
    console.error(`Error: File not found: ${filePath}`)
    process.exit(1)
  }

  // Register all adapters
  registerAllAdapters()

  // Get the adapter
  const adapter = chainAdapterRegistry.getAdapter(chainId)
  if (!adapter) {
    console.error(`Error: No adapter registered for chain "${chainId}"`)
    process.exit(1)
  }

  // Read the file
  const fileBuffer = await fs.readFile(filePath)
  const content = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength,
  ) as ArrayBuffer

  // Build parse options
  const parseOptions: ParseOptions = {}
  if (opts.limit !== undefined && !Number.isNaN(opts.limit)) {
    parseOptions.limit = opts.limit
  }
  if (opts.skipInvalid) {
    parseOptions.skipInvalid = true
  }

  // Parse the file
  const filename = path.basename(filePath)

  if (!opts.json) {
    console.log(`Parsing ${filename} with ${adapter.name} adapter...`)
  }

  const result = await adapter.parse(content, filename, parseOptions)

  // Output result
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    printSummary(result, filename)
    printTable(result.rows)
  }

  // Exit with error code if there were validation errors
  if (result.errors.length > 0 && !opts.skipInvalid) {
    process.exit(2)
  }
}

// Run the CLI
main().catch((error) => {
  console.error('Fatal error:', error.message)
  process.exit(1)
})
