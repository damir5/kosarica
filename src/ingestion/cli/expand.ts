#!/usr/bin/env npx tsx
/**
 * CLI Command: expand
 *
 * Expands ZIP files into entries, computing hashes and tracking metadata.
 *
 * Usage:
 *   npx tsx src/ingestion/cli/expand.ts -f <file_path>
 *   npx tsx src/ingestion/cli/expand.ts -f archive.zip -o ./output
 *   npx tsx src/ingestion/cli/expand.ts -f archive.zip --list-only
 *   npx tsx src/ingestion/cli/expand.ts -f archive.zip --json
 */

import { Command } from 'commander'
import { unzipSync } from 'fflate'
import { computeSha256 } from '../core/storage'
import type { ExpandedFile, FileType } from '../core/types'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Detect file type from filename extension.
 */
function detectFileType(filename: string): FileType {
  const ext = path.extname(filename).toLowerCase()
  switch (ext) {
    case '.csv':
      return 'csv'
    case '.xml':
      return 'xml'
    case '.xlsx':
      return 'xlsx'
    case '.zip':
      return 'zip'
    default:
      return 'csv' // default fallback
  }
}

/**
 * Format file size for human-readable output.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// ============================================================================
// Entry Information
// ============================================================================

/**
 * Information about an extracted entry.
 */
interface EntryInfo {
  /** Filename within the ZIP */
  filename: string
  /** Detected file type */
  type: FileType
  /** File size in bytes */
  size: number
  /** SHA256 hash of the content */
  hash: string
  /** Path where file was extracted (only if not list-only) */
  extractedPath?: string
}

/**
 * Result of the expand operation.
 */
interface ExpandResult {
  /** Source ZIP file path */
  sourceFile: string
  /** Output directory */
  outputDir: string
  /** Whether extraction was performed */
  extracted: boolean
  /** List of entries */
  entries: EntryInfo[]
  /** Total size of all entries */
  totalSize: number
  /** Number of entries */
  entryCount: number
}

// ============================================================================
// Main Expand Function
// ============================================================================

/**
 * Expand a ZIP file and extract entries.
 *
 * @param filePath - Path to the ZIP file
 * @param outputDir - Directory to extract to
 * @param listOnly - If true, only list contents without extracting
 * @returns Expand result with entry information
 */
async function expandZipFile(
  filePath: string,
  outputDir: string,
  listOnly: boolean,
): Promise<ExpandResult> {
  // Read the ZIP file
  const zipBuffer = await fs.readFile(filePath)
  const zipData = new Uint8Array(zipBuffer)

  // Extract all entries using fflate
  const unzipped = unzipSync(zipData)

  const entries: EntryInfo[] = []
  let totalSize = 0

  // Process each entry
  for (const [filename, content] of Object.entries(unzipped)) {
    // Skip directories (they end with /)
    if (filename.endsWith('/')) {
      continue
    }

    // Compute hash
    const hash = await computeSha256(content)
    const size = content.byteLength
    totalSize += size

    const entryInfo: EntryInfo = {
      filename,
      type: detectFileType(filename),
      size,
      hash,
    }

    // Extract file if not list-only mode
    if (!listOnly) {
      const extractPath = path.join(outputDir, filename)
      const extractDir = path.dirname(extractPath)

      // Ensure directory exists
      await fs.mkdir(extractDir, { recursive: true })

      // Write file
      await fs.writeFile(extractPath, content)
      entryInfo.extractedPath = extractPath
    }

    entries.push(entryInfo)
  }

  return {
    sourceFile: filePath,
    outputDir,
    extracted: !listOnly,
    entries,
    totalSize,
    entryCount: entries.length,
  }
}

// ============================================================================
// CLI Output Functions
// ============================================================================

/**
 * Print result in human-readable format.
 */
function printHumanReadable(result: ExpandResult): void {
  console.log(`\nZIP File: ${result.sourceFile}`)
  console.log(`Output Directory: ${result.outputDir}`)
  console.log(`Mode: ${result.extracted ? 'Extract' : 'List only'}`)
  console.log(`\nEntries (${result.entryCount} files, ${formatSize(result.totalSize)} total):`)
  console.log('─'.repeat(80))

  for (const entry of result.entries) {
    const typeLabel = entry.type.toUpperCase().padEnd(4)
    const sizeLabel = formatSize(entry.size).padStart(12)
    console.log(`  [${typeLabel}] ${sizeLabel}  ${entry.filename}`)
    console.log(`           SHA256: ${entry.hash}`)
    if (entry.extractedPath) {
      console.log(`           Extracted: ${entry.extractedPath}`)
    }
  }

  console.log('─'.repeat(80))
  console.log(`\nSummary:`)
  console.log(`  Total files: ${result.entryCount}`)
  console.log(`  Total size: ${formatSize(result.totalSize)}`)
  if (result.extracted) {
    console.log(`  Files extracted to: ${result.outputDir}`)
  }
}

/**
 * Print result as JSON.
 */
function printJson(result: ExpandResult): void {
  console.log(JSON.stringify(result, null, 2))
}

// ============================================================================
// CLI Program
// ============================================================================

const program = new Command()

program
  .name('expand')
  .description('Expand ZIP files into entries with metadata tracking')
  .requiredOption('-f, --file <path>', 'Path to ZIP file (required)')
  .option('-o, --output-dir <dir>', 'Output directory (default: same as input file)')
  .option('--json', 'Output result as JSON')
  .option('--list-only', 'Only list contents without extracting')
  .action(async (options) => {
    try {
      const filePath = path.resolve(options.file)

      // Verify file exists
      try {
        await fs.access(filePath)
      } catch {
        if (options.json) {
          console.log(
            JSON.stringify({
              error: true,
              message: `File not found: ${filePath}`,
            }),
          )
        } else {
          console.error(`Error: File not found: ${filePath}`)
        }
        process.exit(1)
      }

      // Determine output directory
      let outputDir: string
      if (options.outputDir) {
        outputDir = path.resolve(options.outputDir)
      } else {
        // Default: same directory as input file
        outputDir = path.dirname(filePath)
      }

      // Run expansion
      const result = await expandZipFile(filePath, outputDir, options.listOnly || false)

      // Output result
      if (options.json) {
        printJson(result)
      } else {
        printHumanReadable(result)
      }

      process.exit(0)
    } catch (error) {
      if (options.json) {
        console.log(
          JSON.stringify({
            error: true,
            message: error instanceof Error ? error.message : String(error),
          }),
        )
      } else {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
      process.exit(1)
    }
  })

program.parse()
