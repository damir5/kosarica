# PLAN1 - Price Availability + Ingestion Performance

## Goals
- Preserve products when source price is missing/invalid/non-positive.
- Keep ingestion write path batched and highly performant.
- Show clear user-facing state: **Price unavailable**.
- Run barcode matching automatically on cron.

## Implemented
- Added explicit price availability model in normalized ingestion rows:
  - `priceStatus: "available" | "unavailable"`
  - `priceUnavailableReason: "missing" | "invalid" | "non_positive"`
- Updated XML/CSV/XLSX parsing so missing/invalid prices are classified as unavailable (not dropped).
- Updated adapter validation logic so unavailable rows are accepted if other required fields are valid.
- Extended parquet payload with:
  - `price_status`
  - `price_unavailable_reason`
  - nullable `price_cents`
- Updated ClickHouse schema:
  - `price_cents Nullable(Int32)`
  - `price_status LowCardinality(String)`
  - `price_unavailable_reason Nullable(LowCardinality(String))`
- Added ClickHouse migration `0002_price_availability.sql` with backfill.
- Updated price query routers to return `priceStatus` and `priceUnavailableReason`.
- Updated catalog table UI to render unavailable prices as **Price unavailable**.
- Added ingestion run/file metadata counters for availability breakdown.
- Added scheduled cron handler for barcode matching (`barcode-matching`, daily 09:00 UTC).
- Improved barcode matching query to skip items already queued for manual review.

## Validation Focus
- Parser regression: rows with missing prices remain ingestible and classified.
- Ingestion metadata now reports available/unavailable counts by reason.
- Catalog/API response includes nullable price + explicit status.
- Scheduled matching runs independently from ingestion workers.
