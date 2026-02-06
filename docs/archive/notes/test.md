Title: Price Service Test Findings

Overview
- Ran `mise run test-all`. Most JS and DB unit tests passed after fixes, but 4 integration tests still fail that involve the Go price-service proxy.

What I fixed
- Ingestion run creation: Go handler inserted a CUID string into a bigint `ingestion_runs.id`; handler changed to use DB auto-increment and return numeric `runId`.
- Reprocessing and matching code: removed/updated other usages of CUID for run IDs so DB bigint ids are used consistently.

Remaining failing tests (from src/orpc/router/__tests__/price-service.integration.test.ts)
1) Trigger Ingestion: expected `result.status === "started"`, but `status` is undefined.
   - Symptoms: the proxy client code expects a JSON shape with `status` and `runId` as strings. The Go handler now returns a numeric `runId` and `status: "started"` (but the proxy result is not matching the expected shape).
2) Search Items: `result.items` is undefined for valid query (e.g. `milk`).
3) Search Items with chainSlug: same as (2), `items` undefined.
4) Get Store Prices: test expects paginated prices or a 404 when store missing; currently fails because result shape is not as expected.

Root cause analysis
- Schema / contract mismatch: Go handlers (SearchItems and GetStorePrices) expect richer `retailer_items` data (fields like `name`, `external_id`, `brand`, `category`, `unit`, `unit_quantity`, `image_url`, `chain_slug`) and perform joins/aggregations against these columns.
- Actual DB schema (from drizzle migration and current test DB) shows `retailer_items` only has: `id, retailer_item_id, barcode, is_primary, created_at`. The required product fields are missing; queries that rely on them fail or return unexpected results.
- The proxy client (`src/lib/go-service-client.ts`) expects the Go service to return a JSON object matching { success: boolean, data: ... } or the route-specific expected shapes — there's minor mismatch around returning numeric vs string runId as tests assert string type in the JS test.

Recommended next steps (decision needed)
1) (Recommended) Align DB schema with handler expectations:
   - Add missing columns to `retailer_items` (or add a proper FK to `products` and adjust queries).
   - Create a DB migration that adds columns: name, external_id, description, brand, category, subcategory, unit, unit_quantity, image_url, chain_slug (or the desired normalized schema).
   - Seed minimal test data for `retailer_items` and related tables so integration tests can return meaningful results.
   Pros: keeps Go handlers unchanged; tests that expect item fields will pass.
   Cons: changes DB structure — requires design review.

2) Alternative: Change Go handlers to use `products` + relationships (denormalize or join), or adjust queries to match current schema.
   - Update `SearchItems` and `GetStorePrices` handlers to join to `products` (if product details live there).
   - Pros: keeps DB minimal if product details are already in `products`.
   - Cons: requires careful changes to multiple handlers and tests.

3) Sync JS tests / client expectations:
   - Update frontend test expectations to accept numeric `runId` (or cast to string) and accept returned shapes from Go.
   - Pros: small, quick fix for runId shape mismatch.
   - Cons: doesn't address missing product fields.

Concrete small tasks I can execute once I have write permission (proposed order)
1) Write `test.md` with this content and commit.
2) Add a short migration to add needed columns to `retailer_items` (or add join logic if you prefer option 2).
3) Seed minimal test rows for `retailer_items`, `chains`, and optionally `stores` for tests to run reliably.
4) Re-run `mise run test-all`, fix any remaining handler bugs (e.g., ensure the proxy returns the expected structure and types).
5) If desired, create a PR describing the schema change (include rationale).

Questions / decisions for you
- Which approach do you prefer for product data:
  1) Expand `retailer_items` with product fields (denormalized), or
  2) Keep product metadata in `products` and update Go handlers to join/lookup there?
  (I recommend 1) if you want minimal handler changes and faster test fixes; choose 2) if you prefer normalized data model and are ready to change multiple handlers/tests.)
