# Retailers Publishing Prices under the 2025 Law

**Croatian law NN 75/2025** (effective May 15, 2025) mandates that large grocery retailers (supermarkets, hypermarkets, discounters, cash&carry) publish daily price lists for food, beverages, cosmetics, cleaning and household goods.

Each list must be:
- Machine-readable
- Include product details (name, code, brand, quantity, unit, price, price per unit, barcode, category)
- Separated by store location (enabling per-store catalogs)

For example, Konzum publishes 188 store-specific files, Plodine 146, SPAR 143, and Lidl 111.

---

## Major Retail Chains

### Konzum (DP Konzum plus d.o.o.)

Konzum provides daily CSV price lists per store on its website. Its "Objava cjenika" page lists dates and under each date the available store files.

**Example filename:**
```
SUPERMARKET,VALKANELA 10 52450 VRSAR,0613,43525,29.12.2025,05-20.CSV
```

Each filename encodes:
- Store type (SUPERMARKET)
- Address (VALKANELA 10, VRSAR)
- Postal code (52450)
- Store code (0613, 43525)
- Date (29.12.2025)
- Time (05-20)

**Format:** Semicolon-separated CSV with one row per product containing all required fields.

**Availability:** Files remain available for 30 days from publication.

**Website:** https://www.konzum.hr/cjenici

---

### Lidl Hrvatska

Lidl's official site publishes a calendar of daily price ZIPs for each date. On the "Popis maloprodajnih cijena" page, each date's entry links to a ZIP archive.

**Example:**
```
Cijene na dan 30.11.2025 potražite ovdje
```

Inside each ZIP are CSVs (one per Lidl store) containing product prices and barcodes. ZIP filenames include Lidl store IDs and names.

**Website:** https://tvrtka.lidl.hr/cijene

---

### Plodine

Plodine publishes price lists on its "Info o cijenama" page in CSV or XML format. Plodine provided 146 store-specific files as of 15.5.2025.

Store location can be inferred from file names or contents (each file corresponds to one Plodine branch).

**Website:** https://www.plodine.hr/info-o-cijenama

---

### SPAR (SPAR Hrvatska d.o.o.)

SPAR publishes daily CSV price lists via its "Maloprodajni cjenici" webpage with a date picker.

**Format:** CSV format (fields separated by `;`, decimal comma)

Each CSV corresponds to one SPAR store or supermarket. Store identity is encoded in the file content or name.

**Website:** https://www.spar.hr/usluge/cjenici

---

### Studenac (Studenac d.d.)

Studenac's site has a "Popis maloprodajnih cijena" page with CSV or PDF files. By analogy, each file would be per store.

---

### Kaufland (Kaufland Hrvatska k.d.)

Kaufland's price lists are accessible under "Kaufland akcije – MPC popis" on its website as an HTML table or downloadable CSV.

The page lists prices per store as a table with columns for store location and price.

**Website:** https://www.kaufland.hr/akcije-novosti/mpc-popis.html

---

### Eurospin (Eurospin d.o.o.)

Eurospin's "Cjenik" page contains daily price lists. The data is machine-readable, likely one CSV per store or a combined file.

**Website:** https://eurospin.hr/cjenik/

---

### dm-drogerie markt (dm-drogerie markt d.o.o.)

Unlike others, dm offers a **single XLSX file** covering all stores (since dm prices are identical everywhere).

**Example filename:**
```
dm_trgovine_dm_online_shop_208_8.12.2025_05.04.00.XLSX
```

Each file contains all products and prices for the current date. Store location is implicit (same list for every store).

**Website:** https://www.dm.hr/novo/promocije/nove-oznake-cijena-i-vazeci-cjenik-u-dm-u-2906632

---

### KTC (KTC d.d.)

KTC's site provides per-store CSVs. First select a store from a list, then the store's page shows dated CSV links.

**Example filename:**
```
TRGOVINA-TRG J.J.STROSSMAYERA 8 KRIZEVCI-PJ06-1-20251130-071002.CSV
```

The filename encodes:
- Address (J.J. Strossmayera 8, Križevci)
- Store code (PJ-06)
- Date

**Format:** Semicolon-separated CSV with all product details.

**Website:** https://www.ktc.hr/cjenici

---

### Metro (Metro Cash & Carry d.o.o.)

Metro publishes daily CSVs per wholesale center. Its "Cjenici" page links to metrocjenik.com.hr, which is a directory of files.

**Example filename:**
```
cash_and_carry_prodavaonica_METRO_20250801T0630_S10_JANKOMIR_31,_ZAGREB.csv
```

The filename encodes:
- Store code (S10)
- Address (Jankomir 31, Zagreb)
- Date and time

**Currency:** Euro (€)

**Website:** https://www.metro-cc.hr/cjenici

---

### Trgocentar (Trgocentar d.o.o.)

Trgocentar publishes separate **XML files** for each store. Its "Datoteke sa cjenicima" page is an index of XMLs.

**Example filenames:**
```
SUPERMARKET_BANA_JOSIPA_JELACICA_139_ZAPRESIC_P060_211_091220250746.xml
SUPERMARKET_103_BRIGADE_8_ZABOK_P080_210_081220250745.xml
```

Each filename contains:
- Store name
- Internal code (e.g. P060 for Zaprešić)
- Timestamp

**Website:** https://trgocentar.com/Trgovine-cjenik/

---

## Regional Chains

The following smaller chains also publish under the law:

- **Žabac** (Žabac d.o.o.) - smaller chain in Međimurje
- **Vrutak** (Vrutak d.d.) - Lidl Group's local name
- **Ribola** (Ribola d.o.o.) - regional chain
- **NTL** (NTL d.o.o.) - "Naplata tržišnog lanca", franchise network
- **Boso** - regional chain
- **Brodokomerc** - regional chain
- **Lorenco** - regional chain
- **Trgovina Krk** - island Krk stores

These chains follow similar patterns: daily file per store (CSV/XML), with location info in the filename or within.

---

## Implementation Summary

All covered chains make price lists available (often CSV or XML) via their websites. The data is always:
- Dated
- Store-specific
- Machine-readable

For each chain, the plan is to:
1. Fetch each store's daily file
2. Parse the CSV/XML to extract product and price fields
3. Use the store identifier (from filename or content) to assign prices to a specific location

This fulfills the functional need to compare prices by product, chain, and location.

---

## Sources

- Croatian regulation NN 75/2025
- [Iste cijene za sve? Što nam govore novi podaci o trgovinama diljem Hrvatske](https://eizg.hr/iste-cijene-za-sve-sto-nam-govore-novi-podaci-o-trgovinama-diljem-hrvatske/7228) - Ekonomski institut Zagreb
- [Croatian retailers to publish prices of basic products daily](https://seenews.com/news/croatian-retailers-to-publish-prices-of-basic-products-daily-1274634) - SeeNews
- [cijene-api](https://github.com/senko/cijene-api) - Servis za preuzimanje cijena proizvoda u trgovačkim lancima u Hrvatskoj
- [Reddit: 15.05 je, di su online cijene svih trgovina?](https://www.reddit.com/r/CroIT/comments/1knfmhx/1505_je_di_su_online_cijenesvih_trgovina/)
