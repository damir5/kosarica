# Kaufland CSV Ingestion Issues

## Summary

Kaufland CSV ingestion has data quality issues caused by column misalignment in source files. Rows with shifted columns cause incorrect data to be parsed into brand, name, unit, and unit_quantity fields.

## Issue Categories

| Issue Type | Count | Description |
|------------|-------|-------------|
| brand_is_category | 13 | `brand` column contains category names (KOZMETIKA, HRANA, PIĆE) |
| brand_is_price | 3 | `brand` column contains prices or barcodes (1.000, 4063367412301) |
| name_is_garbage | 4 | `name` is just numbers (49, 3, 481022682) |
| llm_failed | 22 | Valid names that LLM failed to categorize |

## Root Cause

The source CSV files have rows where columns are shifted left or right, likely due to:
1. Missing or extra delimiters in certain rows
2. Multiline values not properly quoted
3. Data entry errors in the source system

### Example of Column Misalignment

**Expected row:**
```
šifra,naziv,kategorija,marka,jedinica,neto,cijena
12345,Coca Cola 2L,PIĆE,Coca Cola,L,2,2.99
```

**Problematic row (shifted):**
```
12345,PIĆE,,Coca Cola,2,2.99,
```

This causes:
- `name` = "PIĆE" (category in name field)
- `category` = "" (empty)
- `brand` = "Coca Cola" (actual brand)
- `unit` = "2" (price in unit field)

## Column Mapping

From `src/ingestion/adapters/chains/kaufland.ts`:

```typescript
const kauflandColumnMapping: CsvColumnMapping = {
  externalId: "šifra proizvoda",
  name: "naziv proizvoda",
  category: "kategorija proizvoda",
  brand: "marka proizvoda",
  unit: "jedinica mjere",
  unitQuantity: "neto količina(KG)",
  price: "maloprod.cijena(EUR)",
};
```

## Detection Patterns

### Brand Contains Category
```sql
SELECT * FROM retailer_items
WHERE chain_slug = 'kaufland'
AND brand IN ('KOZMETIKA', 'HRANA', 'PIĆE', 'DODACI PREHRANI', 'KUĆNA NJEGA');
```

### Brand Contains Price/Barcode
```sql
SELECT * FROM retailer_items
WHERE chain_slug = 'kaufland'
AND (brand ~ '^[0-9]+\.[0-9]+$' OR brand ~ '^[0-9]{8,}$');
```

### Name Is Garbage
```sql
SELECT * FROM retailer_items
WHERE chain_slug = 'kaufland'
AND name ~ '^[0-9]+$';
```

## Proposed Fixes

### 1. Add Validation in CSV Parser

Add validation rules in `src/ingestion/adapters/chains/kaufland.ts`:

```typescript
// Known category values that should NOT appear in brand column
const CATEGORY_VALUES = [
  'KOZMETIKA', 'HRANA', 'PIĆE', 'DODACI PREHRANI', 
  'KUĆNA NJEGA', 'DJECA', 'KUĆANSTVO'
];

// Validate parsed row
function validateRow(row: ParsedRow): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  // Check if brand contains a category name
  if (CATEGORY_VALUES.includes(row.brand?.toUpperCase())) {
    issues.push('brand_is_category');
  }
  
  // Check if brand looks like a price or barcode
  if (/^[0-9]+\.[0-9]+$/.test(row.brand) || /^[0-9]{8,}$/.test(row.brand)) {
    issues.push('brand_is_price_or_barcode');
  }
  
  // Check if name is garbage (only numbers)
  if (/^[0-9]+$/.test(row.name)) {
    issues.push('name_is_garbage');
  }
  
  return { valid: issues.length === 0, issues };
}
```

### 2. Skip or Flag Invalid Rows

Options:
- **Skip invalid rows**: Don't ingest rows with detected issues
- **Flag for review**: Ingest but mark with a quality flag
- **Attempt correction**: Try to realign columns based on patterns

### 3. Log Quality Issues

Add logging for data quality issues:

```typescript
if (issues.length > 0) {
  logger.warn('CSV data quality issue', {
    chain: 'kaufland',
    externalId: row.externalId,
    issues,
    rawRow: row,
  });
}
```

## Manual Fixes Applied

### Category Sync (2026-02-25)

Fixed category sync bug where `normalized_category` was not synced to `category`:

```sql
UPDATE retailer_items ri
SET category = rif.normalized_category
FROM retailer_item_features rif
WHERE rif.retailer_item_id = ri.id
  AND rif.normalized_category IS NOT NULL
  AND (ri.category IS NULL OR ri.category = '');
-- Fixed 9 items
```

### Manual Category Assignments (2026-02-25)

Manually categorized 39 Kaufland items:

| Category | Count | Brands/Patterns |
|----------|-------|-----------------|
| pice | 13 | Teekanne, Badel, Stella, Ožujsko, Heineken, etc. |
| hrana | 10 | K-Classic, Florea, Zwiefel, etc. |
| kozmetika | 8 | Nivea, Dove, Fa, Garnier, etc. |
| ostalo | 4 | Garbage names (49, 3, barcodes) |
| kucanstvo | 2 | Put Zagreb, etc. |
| kuca_i_vrt | 1 | Jumbo |
| djeca | 1 | Diset |

## Files to Modify

1. `src/ingestion/adapters/chains/kaufland.ts` - Add validation logic
2. `src/ingestion/adapters/csv-parser.ts` - Potentially add common validation helpers

## Testing

1. Download recent Kaufland CSV files from staging
2. Run ingestion with validation logging enabled
3. Verify issues are detected and logged
4. Confirm valid rows are still ingested correctly

## Metrics to Track

- Count of rows with `brand_is_category`
- Count of rows with `brand_is_price`
- Count of rows with `name_is_garbage`
- Total rows skipped vs ingested
