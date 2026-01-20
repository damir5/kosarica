# Chain Adapters Guide

This document provides detailed information about each retail chain adapter, including data formats, column mappings, store identification patterns, and special handling requirements.

## Overview

The Price Service implements adapters for 11 Croatian retail chains. Each adapter:

1. **Discovers** price files from the chain's portal/website
2. **Fetches** files with rate limiting and retry
3. **Parses** data into normalized format
4. **Persists** to PostgreSQL database

## Chain Reference

| Chain | Format | Encoding | Delimiter | Special |
|-------|--------|----------|-----------|---------|
| Konzum | CSV | Windows-1250 | Comma | Alt mapping |
| Lidl | CSV in ZIP | Windows-1250 | Semicolon | Multi-GTIN |
| Studenac | XML | UTF-8 | N/A | Dynamic store ID |
| DM | XLSX | UTF-8 | N/A | Numeric indices |
| Plodine | CSV | Windows-1250 | Semicolon | ZIP archive |
| Interspar | CSV | UTF-8 | Semicolon | JSON API |
| Kaufland | CSV | UTF-8 | Tab | JSON API |
| Eurospin | CSV in ZIP | UTF-8 | Semicolon | Option tags |
| KTC | CSV | Windows-1250 | Semicolon | Standard |
| Metro | CSV | UTF-8 | Semicolon | Standard |
| Trgocentar | XML | UTF-8 | N/A | Dynamic anchor |

## Detailed Chain Specifications

### 1. Konzum

**File Format:** CSV
**Encoding:** Windows-1250
**Delimiter:** Comma (`,`)

**Base URL:** `https://www.konzum.hr`

#### Discovery

- **Method:** HTML link extraction from paginated portal
- **URL Pattern:** `/cjenici?date=YYYY-MM-DD&page=N`
- **Max Pages:** 50
- **Link Pattern:** `href="/cjenici/download?title=..."`

#### Column Mappings

**Primary (Croatian):**
```go
ExternalID:     "ŠIFRA PROIZVODA"
Name:           "NAZIV PROIZVODA"
Category:       "KATEGORIJA PROIZVODA"
Brand:          "MARKA PROIZVODA"
Unit:           "JEDINICA MJERE"
UnitQuantity:   "NETO KOLIČINA"
Price:          "MALOPRODAJNA CIJENA"
DiscountPrice:  "MPC ZA VRIJEME POSEBNOG OBLIKA PRODAJE"
Barcodes:       "BARKOD"
UnitPrice:      "CIJENA ZA JEDINICU MJERE"
LowestPrice30d: "NAJNIŽA CIJENA U ZADNJIH 30 DANA"
AnchorPrice:    "SIDRENA CIJENA"
```

**Alternative (English):**
```go
ExternalID:     "Code"
Name:           "Name"
Category:       "Category"
Brand:          "Brand"
Unit:           "Unit"
UnitQuantity:   "Quantity"
Price:          "Price"
DiscountPrice:  "Discount Price"
DiscountStart:  "Discount Start"
DiscountEnd:    "Discount End"
Barcodes:       "Barcode"
```

#### Store Identification

**Filename Pattern:**
```
SUPERMARKET,ADDRESS+POSTAL+CITY,STORE_ID,DATE,TIME.CSV
```

**Extraction Pattern:** `,(\d{4}),` (4-digit store code)

**Example:** `SUPERMARKET,ŽITNA+1A+10310+ZAGREB,0204,2025-01-15,10.30.csv`
- Store ID: `0204`

#### Store Metadata Extraction

Parses filename components:
- **Store Type:** First field (SUPERMARKET, HIPERMARKET)
- **Address:** Decoded from URL encoding (plus → space)
- **Postal Code:** First 5-digit number found
- **City:** Text after postal code

---

### 2. Lidl

**File Format:** CSV in ZIP archive
**Encoding:** Windows-1250
**Delimiter:** Semicolon (`;`)

**Base URL:** `https://tvrtka.lidl.hr`

#### Discovery

- **Method:** HTML link extraction with dynamic download IDs
- **URL Pattern:** `/content/download/{ID}/fileupload/{filename}.zip`
- **Filename Pattern:** `Popis_cijena_po_trgovinama_na_dan_DD_MM_YYYY.zip`

#### Column Mappings

**Primary (2026 format):**
```go
ExternalID:     "ŠIFRA"
Name:           "NAZIV"
Category:       "KATEGORIJA_PROIZVODA"
Brand:          "MARKA"
Unit:           "JEDINICA_MJERE"
UnitQuantity:   "NETO_KOLIČINA"
Price:          "MALOPRODAJNA_CIJENA"
DiscountPrice:  "MPC_ZA_VRIJEME_POSEBNOG_OBLIKA_PRODAJE"
Barcodes:       "BARKOD"
UnitPrice:      "CIJENA_ZA_JEDINICU_MJERE"
LowestPrice30d: "NAJNIZA_CIJENA_U_POSLJ._30_DANA"
AnchorPrice:    "Sidrena_cijena_na_dan"
```

**Alternative (Legacy):**
```go
ExternalID:     "Artikl"
Name:           "Naziv artikla"
Category:       "Kategorija"
Brand:          "Robna marka"
Unit:           "Jedinica mjere"
UnitQuantity:   "Količina"
Price:          "Cijena"
DiscountPrice:  "Akcijska cijena"
Barcodes:       "GTIN"
```

#### Store Identification

**Filename Patterns:**
1. `Lidl_DATE_STOREID` → e.g., `Lidl_2024-01-15_42`
2. `Lidl_Poslovnica_LOCATION` → e.g., `Lidl_Poslovnica_Zagreb_Ilica_123`
3. `Supermarket 265_Address_...`

**Extraction:**
- Remove `.csv` extension
- Match patterns in order above
- Return store ID or location identifier

#### Special Features

**ZIP Expansion:**
- ZIP contains per-store CSV files
- Each CSV is extracted and processed independently
- Skips `__MACOSX` directory files

**Multiple GTINs:**
- Single barcode field may contain multiple GTINs
- Separated by semicolon (`;`) or pipe (`|`)
- Automatically split into separate barcode entries

**Example:** `3812345678901;3812345678902` → Two GTINs

---

### 3. Studenac

**File Format:** XML
**Encoding:** UTF-8

**Base URL:** `https://www.studenac.hr`

#### Discovery

- **Method:** HTML link extraction
- **URL Pattern:** Any `.xml` link in portal HTML
- **Date Filter:** Optional YYYY-MM-DD filter via `SetDiscoveryDate()`

#### Field Mappings

**Primary (lowercase/snake_case):**
```go
ExternalID:            "code"
Name:                  "name"
Description:           "description"
Category:              "category"
Subcategory:           "subcategory"
Brand:                 "brand"
Unit:                  "unit"
UnitQuantity:          "quantity"
Price:                 "price"
DiscountPrice:         "discount_price"
DiscountStart:         "discount_start"
DiscountEnd:           "discount_end"
Barcodes:              "barcode"
ImageURL:              "image_url"
UnitPrice:             "unit_price"
UnitPriceBaseQuantity: "unit_price_quantity"
UnitPriceBaseUnit:     "unit_price_unit"
LowestPrice30d:        "lowest_price_30d"
AnchorPrice:           "anchor_price"
AnchorPriceAsOf:       "anchor_price_date"
```

**Alternative (Croatian/uppercase):**
```go
ExternalID:            "Sifra"
Name:                  "Naziv"
Description:           "Opis"
Category:              "Kategorija"
Subcategory:           "Podkategorija"
Brand:                 "Marka"
Unit:                  "Jedinica"
UnitQuantity:          "Kolicina"
Price:                 "Cijena"
DiscountPrice:         "AkcijskaCijena"
DiscountStart:         "PocetakAkcije"
DiscountEnd:           "KrajAkcije"
Barcodes:              "Barkod"
ImageURL:              "Slika"
UnitPrice:             "CijenaZaJedinicuMjere"
UnitPriceBaseQuantity: "JedinicaMjereKolicina"
UnitPriceBaseUnit:     "JedinicaMjereOznaka"
LowestPrice30d:        "NajnizaCijena30Dana"
AnchorPrice:           "SidrenaCijena"
AnchorPriceAsOf:       "SidrenaCijenaDatum"
```

#### Item Path Discovery

Tries multiple paths in order:
1. `products.product`
2. `Products.Product`
3. `Proizvodi.Proizvod`
4. `proizvodi.proizvod`
5. `items.item`
6. `Items.Item`

First non-empty result wins.

#### Store Identification

**Filename Pattern:**
```
{TYPE}-{LOCATION}-T{CODE}-{DATE...}.xml
```

**Extraction Pattern:** `-T(\d+)-` (T-code)

**Example:** `SUPERMARKET-Bijela_uvala_5_FUNTANA-T598-229-2026-12-29-07-00-14-559375.xml`
- Store ID: `598` (from T598)

#### Store Metadata Extraction

**Pattern:** `{TYPE}-{LOCATION}-T{CODE}-`

**Example:** `SUPERMARKET-Bijela_uvala_5_FUNTANA-T598-...`
- Store Type: `SUPERMARKET`
- Location: `Bijela_uvala_5_FUNTANA`
- City: `FUNTANA` (last ALL-UPPER word)

**Dynamic Store ID from XML:**

If filename doesn't contain T-code, tries extracting from XML item:
1. `item.store_id`
2. `item.storeId`
3. `item.Store.Id`

---

### 4. DM (Drogerie Markt)

**File Format:** XLSX
**Encoding:** UTF-8

**Base URL:** `https://www.dm.hr`

#### Discovery

- **Method:** Static URL for national pricing file
- **Scope:** National pricing (single store for entire country)
- **Fallback:** Local files in `./data/ingestion/dm/`

#### Column Mappings

**Web Format (numeric indices, skip 3 rows):**
```go
Name:           1           // Column B
Category:       2           // Column C
Brand:          3           // Column D
Price:          5           // Column F
UnitPrice:      6           // Column G
DiscountPrice:  7           // Column H
```

**Local Format (Croatian headers):**
```go
ExternalID:     "Šifra"
Name:           "Naziv"
Category:       "Kategorija"
Brand:          "Marka"
Price:          "Cijena"
```

#### Special Features

**Header Row Count:** 3 (web format)

**National Pricing:** All DM stores in Croatia share the same prices. Database will have a single DM store.

**Excel Serial Dates:** Discount dates are Excel serial numbers (days since 1900-01-01), accounting for the 1900 leap year bug.

---

### 5. Plodine

**File Format:** CSV in ZIP archive
**Encoding:** Windows-1250
**Delimiter:** Semicolon (`;`)

**Base URL:** `https://www.plodine.hr`

#### Discovery

- **Method:** HTML link extraction
- **Pattern:** `.zip` files in portal

#### Column Mappings

```go
ExternalID:     "ŠIFRA"
Name:           "NAZIV"
Category:       "KATEGORIJA"
Brand:          "MARKA"
Price:          "CIJENA"
DiscountPrice:  "AKCIJSKA CIJENA"
Barcodes:       "BARKOD"
UnitPrice:      "CIJENA ZA JEDINICU MJERE"
```

#### Store Identification

**Filename Pattern:** Contains store ID or location name

Extraction uses base class methods with filename prefix patterns:
- `(?i)^Plodine[_-]?`
- `(?i)^cjenik[_-]?`

---

### 6. Interspar

**File Format:** CSV
**Encoding:** UTF-8
**Delimiter:** Semicolon (`;`)

**Base URL:** `https://www.interspar.hr`

#### Discovery

- **Method:** JSON API
- **Endpoint:** `Cjenik{YYYYMMDD}.json`
- **Format:** JSON array of file metadata

#### Column Mappings

```go
ExternalID:     "Artikl"
Name:           "Naziv"
Category:       "Kategorija"
Price:          "Cijena"
DiscountPrice:  "Akcijska cijena"
Barcodes:       "GTIN"
```

---

### 7. Kaufland

**File Format:** CSV
**Encoding:** UTF-8
**Delimiter:** Tab (`\t`)

**Base URL:** `https://www.kaufland.hr`

#### Discovery

- **Method:** JSON API
- **Format:** JSON array of downloadable files

#### Column Mappings

```go
ExternalID:     "Artikel"
Name:           "Bezeichnung"
Category:       "Kategorie"
Price:          "Preis"
Barcodes:       "GTIN"
```

---

### 8. Eurospin

**File Format:** CSV in ZIP archive
**Encoding:** UTF-8
**Delimiter:** Semicolon (`;`)

**Base URL:** `https://www.eurospin.hr`

#### Discovery

- **Method:** HTML `<option>` tag extraction
- **Pattern:** `<option value="...">filename</option>`

#### Column Mappings

```go
ExternalID:     "Codice"
Name:           "Descrizione"
Category:       "Categoria"
Price:          "Prezzo"
Barcodes:       "EAN"
```

---

### 9. KTC

**File Format:** CSV
**Encoding:** Windows-1250
**Delimiter:** Semicolon (`;`)

**Base URL:** `https://www.ktc.hr`

#### Discovery

- **Method:** Static file URL
- **Pattern:** Direct download link

#### Column Mappings

```go
ExternalID:     "Šifra"
Name:           "Naziv"
Category:       "Kategorija"
Brand:          "Marka"
Price:          "Cijena"
DiscountPrice:  "Akcijska cijena"
Barcodes:       "Barkod"
```

---

### 10. Metro

**File Format:** CSV
**Encoding:** UTF-8
**Delimiter:** Semicolon (`;`)

**Base URL:** `https://www.metro.hr`

#### Discovery

- **Method:** Static file URL
- **Pattern:** Direct download link

#### Column Mappings

```go
ExternalID:     "SKU"
Name:           "Name"
Category:       "Category"
Price:          "Price"
Barcodes:       "EAN"
```

---

### 11. Trgocentar

**File Format:** XML
**Encoding:** UTF-8

**Base URL:** `https://www.trgocentar.hr`

#### Discovery

- **Method:** HTML link extraction
- **Pattern:** `.xml` files

#### Field Mappings

```go
ExternalID:     "sifra"
Name:           "naziv"
Category:       "kategorija"
Price:          "cijena"
Barcodes:       "barkod"
```

#### Special Features

**Dynamic Anchor Price:**
- Anchor price may have field name like `c_123456` (c_ + 6 digits)
- Pattern: `c_(\d{6})`
- Extracted via regex search in XML structure

**Store Identification:**
- Pattern: `P(\d{3})` (P + 3 digits)
- Example: `P123` → Store ID: `123`

---

## Common Patterns

### Store ID Extraction

Most chains use one of these patterns:

1. **Filename patterns:** Regex extract from filename
2. **XML fields:** Store ID in XML structure
3. **Metadata:** Store info in downloadable file metadata

### Price Format Handling

**European Format:** `1.234,56` (comma decimal, dot thousands)
- Common in: Konzum, Lidl, Studenac, Plodine, KTC

**US Format:** `1,234.56` (dot decimal, comma thousands)
- Common in: Metro, Interspar, Kaufland

**Detection:** Last comma > last dot = European

### Encoding Detection

**Windows-1250 Detection:**
Score byte sequences for Croatian characters:
- Š (0x8A), š (0x9A)
- Đ (0xD0), đ (0xF0)
- Č (0xC8), č (0xE8)
- Ž (0x8E), ž (0x9E)
- Ć (0xC6), ć (0xE6)

### Alternative Mapping Fallback

```go
// Try primary mapping
result := parseWithMapping(content, primaryMapping)

// If 0 valid rows, try alternative
if result.ValidRows == 0 && alternativeMapping != nil {
    result = parseWithMapping(content, alternativeMapping)
}
```

## Adding a New Chain

1. **Identify format:** CSV, XML, XLSX, ZIP
2. **Determine encoding:** Windows-1250 or UTF-8
3. **Find discovery method:** Portal scraping, API, static URL
4. **Map columns:** Create primary and alternative mappings
5. **Extract store ID:** Filename pattern or XML field
6. **Create adapter:** Extend BaseCsvAdapter, BaseXmlAdapter, or BaseXlsxAdapter
7. **Register:** Add to `internal/adapters/registry/registry.go`
8. **Test:** Add integration test in `tests/integration/chains_test.go`

## Debugging

### Enable Debug Logging

Set log level to debug:
```bash
export LOG_LEVEL=debug
./price-service
```

### Parse Local File

```bash
price-service-cli parse ~/sample.csv --chain konzum
```

### Discovery Test

```bash
price-service-cli discover lidl
```

### Inspect Database

```sql
-- Check recent ingestion runs
SELECT status, processed_files, processed_entries
FROM ingestion_runs
ORDER BY created_at DESC LIMIT 5;

-- Check items per chain
SELECT chain_slug, COUNT(*) as item_count
FROM retailer_items
GROUP BY chain_slug
ORDER BY chain_slug;

-- Check store coverage
SELECT s.name, COUNT(rib.retailer_item_id) as item_count
FROM stores s
JOIN store_item_state sis ON s.id = sis.store_id
JOIN retailer_item_barcodes rib ON sis.retailer_item_id = rib.retailer_item_id
GROUP BY s.id, s.name;
```
