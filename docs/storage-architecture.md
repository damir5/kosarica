# Storage Architecture

This document describes the storage architecture for the Kosarica application, including permanent storage for archives and processed data, and temporary storage for intermediate files.

## Overview

The storage system is organized into two main categories:

1. **Permanent Storage** (`data/storage/`) - Long-term data that needs to be retained
2. **Temporary Storage** (`data/temp/`) - Short-lived intermediate files with automatic cleanup

## Directory Structure

```
data/
├── storage/           # Permanent storage
│   ├── archives/      # Original downloads from retailers (compressed)
│   │   └── {chain}/
│   │       └── {date}/
│   │           ├── {filename}[.gz]     # Data file (smart compression)
│   │           └── {filename}.meta.json # Metadata sidecar
│   │
│   └── parquet/       # Processed query cache
│       └── {chain}/
│           └── {date}/
│               └── prices.parquet
│
└── temp/              # Temporary processing files (auto-cleanup)
    ├── expanded/      # Extracted ZIP contents (timestamped)
    │   └── {timestamp}-{chain}/
    │       └── {extracted-files}.csv[.gz]
    │
    └── test/          # Test artifacts (timestamped)
        └── {timestamp}-{test-name}/
            └── {test-files}
```

## Permanent Storage

### Archives (`data/storage/archives/`)

**Purpose:** Store original downloaded files from retailers for archival and potential re-processing.

**Characteristics:**
- **Compression:** Smart compression based on file type
  - Plain text formats (CSV, XML, JSON) are compressed if >1KB
  - Already-compressed formats (ZIP, GZ) are stored as-is
  - Binary/media files are stored uncompressed
- **Retention:** Indefinite (manual cleanup only)
- **Size:** ~433MB (typical)
- **Metadata:** Sidecar `.meta.json` files contain:
  - Original filename
  - Chain identifier
  - Source URL
  - Download timestamp
  - Compression information

**Key Format:**
```
archives/{chainSlug}/{YYYY-MM-DD}/{filename}[.gz]
```

**Example:**
```
archives/konzum/2026-02-04/SUPERMARKET_IVANIC_GRAD.CSV.gz
archives/konzum/2026-02-04/SUPERMARKET_IVANIC_GRAD.CSV.meta.json
```

### Parquet (`data/storage/parquet/`)

**Purpose:** Store processed price data in columnar format for fast querying.

**Characteristics:**
- **Format:** Apache Parquet (already compressed)
- **Retention:** Indefinite
- **Size:** ~193MB (typical)
- **One file per chain per day**

**Key Format:**
```
parquet/{chainSlug}/{YYYY-MM-DD}/prices.parquet
```

**Example:**
```
parquet/konzum/2026-02-04/prices.parquet
```

## Temporary Storage

### Configuration

Temporary storage is configured via environment variables:

```bash
# Base path for temporary files
TEMP_STORAGE_PATH=./data/temp

# How long to keep temp files (in hours)
TEMP_FILE_RETENTION_HOURS=48
```

### Expanded Files (`data/temp/expanded/`)

**Purpose:** Store extracted contents from ZIP archives during ingestion processing.

**Characteristics:**
- **Lifecycle:** Created during ingestion, deleted after successful processing
- **Retention:** 48 hours (configurable) for failed runs
- **Timestamp Format:** `YYYYMMDD-HHmmss-{chainSlug}`
- **Compression:** Same smart compression as archives

**Key Format:**
```
temp/expanded/{timestamp}-{chainSlug}/{parentZip}/{innerFilename}[.gz]
```

**Example:**
```
temp/expanded/20260204-143022-lidl/cjenici_04_02_2026/store_123.csv.gz
```

### Test Files (`data/temp/test/`)

**Purpose:** Temporary files created during test execution.

**Characteristics:**
- **Lifecycle:** Created by tests, cleaned up after test completion
- **Retention:** 48 hours for orphaned files
- **Timestamp Format:** `YYYYMMDD-HHmmss-{testName}`

**Key Format:**
```
temp/test/{timestamp}-{testName}/{files}
```

## Smart Compression

The storage system uses intelligent compression decisions:

### When Files Are Compressed

1. **File size** > 1KB (MIN_COMPRESSION_SIZE)
2. **File type** is compressible (CSV, XML, JSON, TXT, HTML)
3. **Not already compressed** (no .gz, .zip, .bz2 extension)
4. **Compression saves space** (compressed size < original size)

### Compression Detection

The system automatically detects:
- File extensions (`.gz`, `.zip`, `.bz2`, `.xz`, `.zst`, `.7z`, `.rar`)
- Double extensions (`.tar.gz`, `.tgz`)
- Media files that shouldn't be compressed (images, videos, PDFs)
- Office formats that are already compressed (`.xlsx`, `.docx`)

### Implementation

```typescript
// Check if file should be compressed
import { shouldCompressSmart } from "@/lib/storage";

const shouldCompress = shouldCompressSmart(
  filename,    // "prices.csv" or "data.csv.gz"
  fileType     // optional: "csv", "xml", etc.
);
```

## Automatic Cleanup

### Cron Job

A cron job runs every 6 hours to clean up old temporary files:

**Schedule:** `0 */6 * * *` (every 6 hours)  
**Job ID:** `temp-cleanup`  
**Handler:** `src/jobs/cron/handlers/temp-cleanup.ts`

**What it does:**
1. Scans all temporary directories
2. Checks creation timestamp (from directory name)
3. Deletes directories older than `TEMP_FILE_RETENTION_HOURS`
4. Logs cleanup results

### Manual Cleanup

You can manually trigger cleanup:

```bash
# Preview what would be deleted
pnpm tsx scripts/cleanup-temp-storage.ts --dry-run

# Execute cleanup
pnpm tsx scripts/cleanup-temp-storage.ts
```

### Per-Run Cleanup

The ingestion pipeline also performs cleanup:

1. **On Success:** Immediately deletes temp directory for that run
2. **On Failure:** Leaves temp directory for debugging (cleaned up after retention period)
3. **Best Effort:** Attempts cleanup of old temp dirs at start of each ingestion

## Storage Health Monitoring

### Health Check Script

Monitor storage health and get recommendations:

```bash
pnpm tsx scripts/check-storage-health.ts
```

**Reports:**
- Archive sizes and file counts per chain
- Parquet sizes and file counts per chain
- Temporary storage usage
- Compression statistics
- Old temp directories ready for cleanup
- Overall storage breakdown
- Actionable recommendations

**Example Output:**
```
📦 Archives (Original Downloads)
  Total Size: 433.5 MB
  File Count: 2,006
  Chains: 11 (konzum, dm, lidl, ...)

📊 Parquet (Processed Cache)
  Total Size: 193.2 MB
  File Count: 7

🗂️  Temporary Storage
  Total Size: 25.4 MB
  Directory Count: 3
  Ready for cleanup: 1 directories (Would free 8.2 MB)
```

## Migration from Old Structure

If you have old `expanded/` directories in permanent storage, migrate them:

```bash
# Preview migration
pnpm tsx scripts/migrate-expanded-to-temp.ts --dry-run

# Execute migration (deletes old expanded/ directory)
pnpm tsx scripts/migrate-expanded-to-temp.ts
```

**What it does:**
- Removes `data/storage/expanded/` directory
- These files can be regenerated from archives if needed
- Future runs use temporary storage automatically

## API Reference

### Creating Temporary Directories

```typescript
import { createTempDir, createTestTempDir } from "@/lib/storage";

// Create a temp dir for ingestion
const tempDir = await createTempDir("expanded", "konzum");
// Returns: data/temp/expanded/20260204-143022-konzum

// Create a temp dir for tests
const testDir = await createTestTempDir("my-test");
// Returns: data/temp/test/20260204-143022-my-test
```

### Listing Temporary Directories

```typescript
import { listTempDirs, listAllTempDirs } from "@/lib/storage";

// List temp dirs in a category
const expandedDirs = await listTempDirs("expanded");

// List all temp dirs
const allDirs = await listAllTempDirs();

// Each dir info includes:
// - path: full filesystem path
// - name: directory name
// - createdAt: parsed creation timestamp
// - sizeBytes: total size
// - ageHours: age in hours
// - shouldCleanup: true if older than retention period
```

### Manual Cleanup

```typescript
import { cleanupTempDirs, deleteTempDir } from "@/lib/storage";

// Clean up old temp dirs in a category
const cleaned = await cleanupTempDirs("expanded");

// Clean up all old temp dirs
const allCleaned = await cleanupTempDirs();

// Delete a specific temp dir
await deleteTempDir("/path/to/temp/dir");
```

### Storage Keys

```typescript
import { 
  buildArchiveKey, 
  buildParquetKey,
  buildTempExpandedKey,
  formatTimestamp 
} from "@/lib/storage";

// Archive key
const archiveKey = buildArchiveKey("konzum", new Date(), "prices.csv");
// Returns: archives/konzum/2026-02-04/prices.csv

// Parquet key
const parquetKey = buildParquetKey("konzum", new Date());
// Returns: parquet/konzum/2026-02-04/prices.parquet

// Temp expanded key
const timestamp = formatTimestamp(new Date());
const expandedKey = buildTempExpandedKey(
  timestamp,
  "konzum",
  "cjenici.zip",
  "store123.csv"
);
// Returns: temp/expanded/20260204-143022-konzum/cjenici/store123.csv
```

## Best Practices

### For Developers

1. **Always use temp storage** for intermediate files
2. **Include timestamps** in temp directory names (use `createTempDir()`)
3. **Clean up on success** but leave files on error for debugging
4. **Use smart compression** - let the system decide
5. **Check storage health** periodically with the health check script

### For Tests

1. **Use `createTestTempDir()`** instead of hardcoded paths
2. **Clean up in test teardown** with `deleteTempDir()`
3. **Don't worry about orphaned files** - auto-cleanup handles them

### For Operations

1. **Monitor temp storage** - if it grows large, reduce retention period
2. **Run health checks** before and after major operations
3. **Keep archives** - they're the source of truth for re-processing
4. **Parquet files are derived** - can be regenerated from archives

## Troubleshooting

### Temp storage growing too large

**Symptoms:** `data/temp/` directory is >10% of archives size

**Solutions:**
1. Check for stuck ingestion runs: `pnpm tsx scripts/check-storage-health.ts`
2. Manually clean up: `pnpm tsx scripts/cleanup-temp-storage.ts`
3. Reduce retention: Set `TEMP_FILE_RETENTION_HOURS=24` in `.env`

### Missing temp cleanup

**Symptoms:** Old temp directories not being cleaned up automatically

**Solutions:**
1. Check cron job is running: Verify scheduler is active
2. Check job registration: `temp-cleanup` should be in `cron_jobs` table
3. Check logs for errors during cleanup
4. Run manual cleanup as workaround

### Compression not working

**Symptoms:** All files stored uncompressed or all files compressed

**Solutions:**
1. Check file type metadata is being set correctly
2. Verify `MIN_COMPRESSION_SIZE` threshold (default: 1KB)
3. Check logs for compression errors
4. Review smart compression logic in `src/lib/storage/compression.ts`

## Future Enhancements

Potential improvements to consider:

1. **S3/Cloud Storage Support:** Abstract storage interface to support cloud backends
2. **Compression Statistics:** Track compression ratios and storage savings
3. **Archive Cleanup:** Implement retention policies for old archives
4. **Deduplication:** Detect and remove duplicate archives
5. **Tiered Storage:** Move old archives to cheaper cold storage
6. **Backup Integration:** Automatic backup of critical archives
