package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"runtime"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kosarica/price-service/config"
	adaptersconfig "github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/ingestion"
	zipexpand "github.com/kosarica/price-service/internal/ingestion/zip"
	"github.com/kosarica/price-service/internal/jsonb"
	"github.com/kosarica/price-service/internal/pkg/cuid2"
	"github.com/kosarica/price-service/internal/storage"
	"github.com/kosarica/price-service/internal/taskqueue"
	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog/log"
)

// ============================================================================
// In-Memory Data Structures for Clustering
// ============================================================================

// storeRowData holds a single row from a store's data file
type storeRowData struct {
	StoreIdentifier string
	Row             types.NormalizedRow
}

// itemKey uniquely identifies an item by external ID or barcodes
type itemKey struct {
	ExternalID string
	Barcode    string // primary barcode (first in list)
}

// priceTierKey uniquely identifies a price tier using itemKey (not DB ID)
type priceTierKey struct {
	ItemKey       itemKey
	Price         int
	DiscountPrice int // -1 means NULL
}

// itemData holds aggregated item data
type itemData struct {
	Name        string
	ExternalID  string
	Barcodes    []string
	UnitPrice   *int
	AnchorPrice *int
}

// storePriceRef represents a store's reference to a price tier
type storePriceRef struct {
	StoreIdentifier string
	ItemKey         itemKey
	PriceTierKey    priceTierKey
	InStock         bool
}

// HandleClusterTask processes an ingestion_cluster task from the queue.
// In the redesigned pipeline, this is the Load+Cluster task that:
// 1. Acquires a semaphore slot for heap-based concurrency control
// 2. Loads archives from the database for this run
// 3. Parses content directly from storage (no intermediate JSON files)
// 4. Creates price tiers and store price references using memory-first clustering
func HandleClusterTask(ctx context.Context, payload jsonb.TaskQueuePayload, tq *taskqueue.TaskQueue, taskID string) error {
	// Extract cluster payload from generic payload
	var clusterPayload jsonb.ClusterPayload
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}
	if err := json.Unmarshal(payloadBytes, &clusterPayload); err != nil {
		return fmt.Errorf("failed to unmarshal cluster payload: %w", err)
	}

	chainSlug := clusterPayload.ChainSlug
	runID := clusterPayload.RunID

	if chainSlug == "" || runID == "" {
		return fmt.Errorf("missing required fields in cluster payload")
	}

	log.Info().
		Str("chain", chainSlug).
		Str("runId", runID).
		Str("taskId", taskID).
		Msg("Processing load+cluster task")

	// If this task is re-queued after its finalize child completes, skip reprocessing.
	task, err := tq.GetTask(ctx, taskID)
	if err != nil {
		log.Warn().Err(err).Str("taskId", taskID).Msg("Failed to load task record")
	} else if task.ExpectedChildren > 0 && task.CompletedChildren >= task.ExpectedChildren {
		log.Info().
			Str("taskId", taskID).
			Int("expectedChildren", task.ExpectedChildren).
			Int("completedChildren", task.CompletedChildren).
			Msg("Finalize child completed; skipping re-run of cluster task")
		return nil
	}

	// Acquire semaphore slot for concurrency control
	if err := ingestion.AcquireSlot(ctx); err != nil {
		return fmt.Errorf("failed to acquire import slot: %w", err)
	}
	defer ingestion.ReleaseSlot()

	log.Info().
		Str("runId", runID).
		Msg("Acquired import slot")

	startTime := time.Now()

	// Get target date from run record
	queries := sqlcgen.New(database.Pool())
	run, err := queries.GetIngestionRun(ctx, runID)
	if err != nil {
		return fmt.Errorf("failed to get ingestion run: %w", err)
	}

	// Extract target date (default to today if not set)
	targetDate := time.Now()
	if run.TargetDate.Valid {
		targetDate = run.TargetDate.Time
	}

	log.Info().
		Str("runId", runID).
		Time("targetDate", targetDate).
		Msg("Using target date for ingestion")

	// Initialize chain registry
	if err := registry.InitializeDefaultAdapters(); err != nil {
		return fmt.Errorf("failed to initialize chain registry: %w", err)
	}

	// Get adapter for parsing
	adapter, err := registry.GetAdapter(adaptersconfig.ChainID(chainSlug))
	if err != nil {
		return fmt.Errorf("failed to get adapter for %s: %w", chainSlug, err)
	}

	// Initialize storage backend
	storageBackend, err := storage.NewStorageBackend(&config.Get().Storage)
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}

	// ========================================================================
	// Phase 1: Load and Parse Archives
	// ========================================================================
	loadStart := time.Now()
	allStoreData, storeIdentifiers, loadStats, err := loadAndParseArchives(ctx, adapter, storageBackend, runID)
	if err != nil {
		return fmt.Errorf("failed to load archives: %w", err)
	}
	loadDuration := time.Since(loadStart)

	log.Info().
		Str("runId", runID).
		Int("archivesLoaded", loadStats.archivesLoaded).
		Int("archivesSkipped", loadStats.archivesSkipped).
		Int("storesLoaded", len(storeIdentifiers)).
		Int("totalRows", len(allStoreData)).
		Dur("loadDuration", loadDuration).
		Msg("Phase 1 complete: loaded and parsed archives")

	if len(allStoreData) == 0 {
		log.Warn().Str("runId", runID).Msg("No data loaded from archives, spawning finalize anyway")
		return spawnFinalizeTask(ctx, tq, taskID, chainSlug, runID)
	}

	// ========================================================================
	// Phase 2: Deduplicate Items and Group by Price Tier
	// ========================================================================
	clusterStart := time.Now()
	uniqueItems := deduplicateItems(allStoreData)
	priceTiers, storePriceRefs := groupByPriceTier(allStoreData)
	clusterDuration := time.Since(clusterStart)

	log.Info().
		Str("runId", runID).
		Int("uniqueItems", len(uniqueItems)).
		Int("priceTiers", len(priceTiers)).
		Int("storePriceRefs", len(storePriceRefs)).
		Dur("clusterDuration", clusterDuration).
		Msg("Phase 2 complete: grouped data")

	// ========================================================================
	// Phase 3: Batch Write to Database
	// ========================================================================
	persistStart := time.Now()
	stats, err := batchWriteToDatabase(ctx, chainSlug, storeIdentifiers, uniqueItems, priceTiers, storePriceRefs, targetDate)
	if err != nil {
		return fmt.Errorf("failed to write to database: %w", err)
	}
	persistDuration := time.Since(persistStart)

	// Calculate memory usage estimate
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)
	memoryMB := int64(memStats.Alloc / 1024 / 1024)

	// Log detailed stats
	log.Info().
		Int("archives_loaded", loadStats.archivesLoaded).
		Int("total_rows", len(allStoreData)).
		Int("unique_stores", len(storeIdentifiers)).
		Int("unique_items", len(uniqueItems)).
		Int("price_tiers", len(priceTiers)).
		Int64("memory_estimate_mb", memoryMB).
		Dur("load_duration", loadDuration).
		Dur("cluster_duration", clusterDuration).
		Dur("persist_duration", persistDuration).
		Msg("Cluster task complete")

	log.Info().
		Str("runId", runID).
		Int("storesUpserted", stats.storesUpserted).
		Int("itemsUpserted", stats.itemsUpserted).
		Int("tiersInserted", stats.tiersInserted).
		Int("refsInserted", stats.refsInserted).
		Dur("totalDuration", time.Since(startTime)).
		Msg("Load+Cluster task complete")

	// Spawn finalize task
	return spawnFinalizeTask(ctx, tq, taskID, chainSlug, runID)
}

// ============================================================================
// Phase 1: Load and Parse Archives
// ============================================================================

type loadStats struct {
	archivesLoaded  int
	archivesSkipped int
}

// loadAndParseArchives loads archives for this run and parses them directly from storage
func loadAndParseArchives(
	ctx context.Context,
	adapter interface{},
	storageBackend storage.Storage,
	runID string,
) ([]storeRowData, []string, *loadStats, error) {
	// Get archives for this run from the database
	archives, err := database.GetArchivesByRunId(ctx, runID)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to get archives for run %s: %w", runID, err)
	}

	log.Info().
		Str("runId", runID).
		Int("archiveCount", len(archives)).
		Msg("Found archives to load")

	stats := &loadStats{}
	var allData []storeRowData
	storeIdentifierSet := make(map[string]struct{})

	for i, archive := range archives {
		// Load archive content from storage
		content, err := storageBackend.Get(ctx, archive.ArchivePath)
		if err != nil {
			log.Warn().Err(err).
				Str("archiveId", archive.ID).
				Str("archivePath", archive.ArchivePath).
				Msg("Failed to load archive, skipping")
			stats.archivesSkipped++
			continue
		}

		// Parse archive content
		fileType := types.FileType(archive.OriginalFormat)
		var parseResult *types.ParseResult

		if fileType == types.FileTypeZIP {
			parseResult, err = parseZipArchive(ctx, adapter, content, archive.Filename)
		} else {
			parseResult, err = parseSingleFile(adapter, content, archive.Filename)
		}

		if err != nil {
			log.Warn().Err(err).
				Str("archiveId", archive.ID).
				Str("filename", archive.Filename).
				Msg("Failed to parse archive, skipping")
			stats.archivesSkipped++
			continue
		}

		// Convert parsed rows to storeRowData
		for _, row := range parseResult.Rows {
			if row.StoreIdentifier != "" {
				storeIdentifierSet[row.StoreIdentifier] = struct{}{}
			}

			allData = append(allData, storeRowData{
				StoreIdentifier: row.StoreIdentifier,
				Row:             row,
			})
		}

		stats.archivesLoaded++

		if (i+1)%10 == 0 {
			log.Info().
				Str("runId", runID).
				Int("archivesLoaded", i+1).
				Int("totalArchives", len(archives)).
				Int("rowsLoaded", len(allData)).
				Msg("Archive loading progress")
		}
	}

	// Convert store identifier set to slice
	storeIdentifiers := make([]string, 0, len(storeIdentifierSet))
	for id := range storeIdentifierSet {
		storeIdentifiers = append(storeIdentifiers, id)
	}

	return allData, storeIdentifiers, stats, nil
}

// parseSingleFile parses a single CSV/XML file
func parseSingleFile(adapter interface{}, content []byte, filename string) (*types.ParseResult, error) {
	type parser interface {
		Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error)
	}

	parseAdapter, ok := adapter.(parser)
	if !ok {
		return nil, fmt.Errorf("adapter does not implement Parse interface")
	}

	return parseAdapter.Parse(content, filename, nil)
}

// parseZipArchive expands and parses all CSV files from a ZIP archive
func parseZipArchive(ctx context.Context, adapter interface{}, content []byte, filename string) (*types.ParseResult, error) {
	// Expand ZIP using the zipexpand package
	expanded, err := zipexpand.ExpandInMemory(content, filename)
	if err != nil {
		return nil, fmt.Errorf("failed to expand ZIP: %w", err)
	}

	if len(expanded) == 0 {
		return nil, fmt.Errorf("no supported files extracted from %s", filename)
	}

	type parser interface {
		Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error)
	}

	parseAdapter, ok := adapter.(parser)
	if !ok {
		return nil, fmt.Errorf("adapter does not implement Parse interface")
	}

	result := &types.ParseResult{
		Rows:     make([]types.NormalizedRow, 0),
		Errors:   make([]types.ParseError, 0),
		Warnings: make([]types.ParseWarning, 0),
	}

	for _, inner := range expanded {
		if inner.Type != types.FileTypeCSV {
			continue
		}

		innerResult, err := parseAdapter.Parse(inner.Content, inner.InnerFilename, nil)
		if err != nil {
			log.Warn().Err(err).Str("innerFile", inner.InnerFilename).Msg("Failed to parse inner file")
			continue
		}

		result.TotalRows += innerResult.TotalRows
		result.ValidRows += innerResult.ValidRows
		result.Rows = append(result.Rows, innerResult.Rows...)
		result.Errors = append(result.Errors, innerResult.Errors...)
		result.Warnings = append(result.Warnings, innerResult.Warnings...)
	}

	return result, nil
}

// ============================================================================
// Phase 2: Deduplicate Items and Group by Price Tier
// ============================================================================

// deduplicateItems groups rows by item identity (externalId or barcode)
func deduplicateItems(allData []storeRowData) map[itemKey]itemData {
	items := make(map[itemKey]itemData)

	for _, sd := range allData {
		row := sd.Row
		externalID := ""
		if row.ExternalID != nil {
			externalID = *row.ExternalID
		}
		key := itemKey{
			ExternalID: externalID,
		}
		if len(row.Barcodes) > 0 {
			key.Barcode = row.Barcodes[0]
		}

		// Skip if neither identifier is present
		if key.ExternalID == "" && key.Barcode == "" {
			continue
		}

		if _, exists := items[key]; !exists {
			items[key] = itemData{
				Name:        row.Name,
				ExternalID:  externalID,
				Barcodes:    row.Barcodes,
				UnitPrice:   row.UnitPrice,
				AnchorPrice: row.AnchorPrice,
			}
		}
	}

	return items
}

// groupByPriceTier groups rows by (item, price, discountPrice) to create tiers
func groupByPriceTier(allData []storeRowData) (map[priceTierKey]struct{}, []storePriceRef) {
	tiers := make(map[priceTierKey]struct{})
	var refs []storePriceRef

	for _, sd := range allData {
		row := sd.Row
		externalID := ""
		if row.ExternalID != nil {
			externalID = *row.ExternalID
		}
		iKey := itemKey{
			ExternalID: externalID,
		}
		if len(row.Barcodes) > 0 {
			iKey.Barcode = row.Barcodes[0]
		}

		// Skip if item has no identifier
		if iKey.ExternalID == "" && iKey.Barcode == "" {
			continue
		}

		// Build price tier key using itemKey (not DB ID)
		discountPrice := -1
		if row.DiscountPrice != nil {
			discountPrice = *row.DiscountPrice
		}

		ptKey := priceTierKey{
			ItemKey:       iKey,
			Price:         row.Price,
			DiscountPrice: discountPrice,
		}

		// Track unique tiers
		tiers[ptKey] = struct{}{}

		// Track store→tier references (assume in stock - NormalizedRow doesn't track this)
		refs = append(refs, storePriceRef{
			StoreIdentifier: sd.StoreIdentifier,
			ItemKey:         iKey,
			PriceTierKey:    ptKey,
			InStock:         true,
		})
	}

	return tiers, refs
}

// ============================================================================
// Phase 3: Batch Write to Database
// ============================================================================

type writeStats struct {
	storesUpserted int
	itemsUpserted  int
	tiersInserted  int
	refsInserted   int
}

func batchWriteToDatabase(
	ctx context.Context,
	chainSlug string,
	storeIdentifiers []string,
	uniqueItems map[itemKey]itemData,
	priceTiers map[priceTierKey]struct{},
	storePriceRefs []storePriceRef,
	targetDate time.Time,
) (*writeStats, error) {
	pool := database.Pool()
	stats := &writeStats{}

	// ========================================================================
	// Step 1: Resolve stores and build identifier→storeID map (no upsert here)
	// ========================================================================
	log.Info().Int("stores", len(storeIdentifiers)).Msg("Resolving store IDs...")

	storeIDMap, err := loadStoreIDMap(ctx, pool, chainSlug, storeIdentifiers)
	if err != nil {
		return nil, fmt.Errorf("failed to load stores: %w", err)
	}
	stats.storesUpserted = len(storeIDMap)
	if missing := len(storeIdentifiers) - len(storeIDMap); missing > 0 {
		log.Warn().Int("missingStores", missing).Msg("Store IDs missing; store_prep may have skipped some archives")
	}

	// Fail if we have store identifiers but none could be resolved - prevents silent no-ops
	if len(storeIDMap) == 0 && len(storeIdentifiers) > 0 {
		return nil, fmt.Errorf("all %d store identifiers failed to resolve; store_prep may not have run for chain %s", len(storeIdentifiers), chainSlug)
	}

	// ========================================================================
	// Step 2: Insert missing retailer items + rare updates; build key→itemID map
	// ========================================================================
	log.Info().Int("items", len(uniqueItems)).Msg("Inserting retailer items (insert-only + rare updates)...")

	itemIDMap, err := upsertRetailerItemsBatch(ctx, pool, chainSlug, uniqueItems)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert retailer items: %w", err)
	}
	stats.itemsUpserted = len(itemIDMap)

	log.Info().
		Str("chain", chainSlug).
		Time("targetDate", targetDate).
		Msg("Persisting price tiers/refs with COPY + atomic swap (delete+insert)")

	// ========================================================================
	// Step 3: Prepare price tier snapshot and build key→tierID map
	// ========================================================================
	log.Info().Int("tiers", len(priceTiers)).Msg("Preparing price tier snapshot...")

	now := time.Now()
	tierCopyRows, tierIDMap, tiersSkipped := buildPriceTierCopyRows(chainSlug, priceTiers, uniqueItems, itemIDMap, targetDate, now)
	if tiersSkipped > 0 {
		log.Warn().Int("tiersSkipped", tiersSkipped).Msg("Skipped price tiers missing item IDs")
	}

	// ========================================================================
	// Step 4: Prepare store price refs and swap snapshot atomically
	// ========================================================================
	log.Info().Int("refs", len(storePriceRefs)).Msg("Preparing store price refs snapshot...")

	refCopyRows, refStats := buildStorePriceRefCopyRows(storePriceRefs, storeIDMap, itemIDMap, tierIDMap, targetDate, now)
	if refStats.deduped > 0 {
		log.Info().Int("dedupedRefs", refStats.deduped).Msg("Deduplicated store price refs")
	}
	if refStats.skippedMissing > 0 {
		log.Warn().Int("refsSkipped", refStats.skippedMissing).Msg("Skipped store price refs missing IDs")
	}

	log.Info().
		Int("tiers", len(tierCopyRows)).
		Int("refs", len(refCopyRows)).
		Msg("Swapping price snapshot with COPY + atomic replace")

	swapStats, err := swapPriceSnapshot(ctx, pool, chainSlug, targetDate, tierCopyRows, refCopyRows)
	if err != nil {
		return nil, fmt.Errorf("failed to swap price snapshot: %w", err)
	}
	stats.tiersInserted = swapStats.tiersInserted
	stats.refsInserted = swapStats.refsInserted

	return stats, nil
}

// ============================================================================
// Batch Upsert Functions (stores/items)
// ============================================================================

// upsertStoresBatch upserts all stores using pgx.Batch
func upsertStoresBatch(ctx context.Context, pool *pgxpool.Pool, chainSlug string, storeIdentifiers []string) (map[string]string, error) {
	result := make(map[string]string)

	// First, try to find existing stores
	existingQuery := `
		SELECT si.value, s.id
		FROM stores s
		JOIN store_identifiers si ON s.id = si.store_id
		WHERE s.chain_slug = $1 AND si.value = ANY($2)
	`
	rows, err := pool.Query(ctx, existingQuery, chainSlug, storeIdentifiers)
	if err != nil {
		return nil, fmt.Errorf("failed to query existing stores: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var identifier, storeID string
		if err := rows.Scan(&identifier, &storeID); err != nil {
			return nil, fmt.Errorf("failed to scan store row: %w", err)
		}
		result[identifier] = storeID
	}

	// Find stores that need to be created
	var newStores []string
	for _, identifier := range storeIdentifiers {
		if _, exists := result[identifier]; !exists {
			newStores = append(newStores, identifier)
		}
	}

	if len(newStores) == 0 {
		return result, nil
	}

	// Create new stores in batches
	const batchSize = 1000
	for i := 0; i < len(newStores); i += batchSize {
		end := i + batchSize
		if end > len(newStores) {
			end = len(newStores)
		}
		batch := newStores[i:end]

		pgxBatch := &pgx.Batch{}
		newIDs := make(map[string]string)

		for _, identifier := range batch {
			storeID := cuid2.GeneratePrefixedId("str", cuid2.PrefixedIdOptions{})
			storeName := fmt.Sprintf("%s Store %s", chainSlug, identifier)
			newIDs[identifier] = storeID

			pgxBatch.Queue(`
				INSERT INTO stores (id, chain_slug, name, is_virtual, status)
				VALUES ($1, $2, $3, true, 'active')
				ON CONFLICT DO NOTHING
			`, storeID, chainSlug, storeName)

			// Also create store identifier
			identifierID := cuid2.GeneratePrefixedId("sid", cuid2.PrefixedIdOptions{})
			pgxBatch.Queue(`
				INSERT INTO store_identifiers (id, store_id, type, value)
				VALUES ($1, $2, 'filename_code', $3)
				ON CONFLICT DO NOTHING
			`, identifierID, storeID, identifier)
		}

		br := pool.SendBatch(ctx, pgxBatch)
		for j := 0; j < pgxBatch.Len(); j++ {
			_, err := br.Exec()
			if err != nil {
				br.Close()
				return nil, fmt.Errorf("failed to execute store batch: %w", err)
			}
		}
		br.Close()

		// Add new IDs to result
		for identifier, storeID := range newIDs {
			result[identifier] = storeID
		}
	}

	return result, nil
}

func loadStoreIDMap(ctx context.Context, pool *pgxpool.Pool, chainSlug string, storeIdentifiers []string) (map[string]string, error) {
	result := make(map[string]string)
	if len(storeIdentifiers) == 0 {
		return result, nil
	}

	existingQuery := `
		SELECT si.value, s.id
		FROM stores s
		JOIN store_identifiers si ON s.id = si.store_id
		WHERE s.chain_slug = $1 AND si.value = ANY($2)
	`
	rows, err := pool.Query(ctx, existingQuery, chainSlug, storeIdentifiers)
	if err != nil {
		return nil, fmt.Errorf("failed to query existing stores: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var identifier, storeID string
		if err := rows.Scan(&identifier, &storeID); err != nil {
			return nil, fmt.Errorf("failed to scan store row: %w", err)
		}
		result[identifier] = storeID
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate store rows: %w", err)
	}

	return result, nil
}

// upsertRetailerItemsBatch upserts all retailer items using pgx.Batch
func upsertRetailerItemsBatch(ctx context.Context, pool *pgxpool.Pool, chainSlug string, uniqueItems map[itemKey]itemData) (map[itemKey]string, error) {
	result := make(map[itemKey]string)

	if len(uniqueItems) == 0 {
		return result, nil
	}

	externalIDToKey := make(map[string]itemKey, len(uniqueItems))
	barcodeToKey := make(map[string]itemKey, len(uniqueItems))

	var externalIDs []string
	var barcodes []string
	for key := range uniqueItems {
		if key.ExternalID != "" {
			externalIDToKey[key.ExternalID] = key
			externalIDs = append(externalIDs, key.ExternalID)
		}
		if key.Barcode != "" {
			barcodeToKey[key.Barcode] = key
			barcodes = append(barcodes, key.Barcode)
		}
	}

	// Find existing items by barcode (for items without external_id)
	if len(barcodes) > 0 {
		barcodeQuery := `
			SELECT rib.barcode, ri.id FROM retailer_items ri
			JOIN retailer_item_barcodes rib ON ri.id = rib.retailer_item_id
			WHERE ri.chain_slug = $1 AND rib.barcode = ANY($2)
		`
		rows, err := pool.Query(ctx, barcodeQuery, chainSlug, barcodes)
		if err != nil {
			return nil, fmt.Errorf("failed to query existing items by barcode: %w", err)
		}

		for rows.Next() {
			var barcode, itemID string
			if err := rows.Scan(&barcode, &itemID); err != nil {
				rows.Close()
				return nil, fmt.Errorf("failed to scan barcode row: %w", err)
			}
			if key, ok := barcodeToKey[barcode]; ok && result[key] == "" {
				result[key] = itemID
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("failed to iterate barcode rows: %w", err)
		}
		rows.Close()
	}

	// Insert new items in batches (insert-only; no conflict updates)
	var newItems []itemKey
	newIDs := make(map[itemKey]string, len(uniqueItems))
	for key := range uniqueItems {
		if key.ExternalID != "" || result[key] == "" {
			newItems = append(newItems, key)
			newIDs[key] = cuid2.GeneratePrefixedId("itm", cuid2.PrefixedIdOptions{})
		}
	}

	const batchSize = 500
	for i := 0; i < len(newItems); i += batchSize {
		end := i + batchSize
		if end > len(newItems) {
			end = len(newItems)
		}
		batch := newItems[i:end]

		pgxBatch := &pgx.Batch{}
		for _, key := range batch {
			data := uniqueItems[key]
			itemID := newIDs[key]

			var externalID *string
			if data.ExternalID != "" {
				externalID = &data.ExternalID
			}

			var barcode *string
			if len(data.Barcodes) > 0 {
				barcode = &data.Barcodes[0]
			}

			pgxBatch.Queue(`
				INSERT INTO retailer_items (id, chain_slug, name, external_id, barcode)
				VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (chain_slug, external_id) DO NOTHING
			`, itemID, chainSlug, data.Name, externalID, barcode)
		}

		br := pool.SendBatch(ctx, pgxBatch)
		for j := 0; j < pgxBatch.Len(); j++ {
			if _, err := br.Exec(); err != nil {
				br.Close()
				return nil, fmt.Errorf("failed to insert retailer items batch: %w", err)
			}
		}
		br.Close()

		if (i+batchSize)/batchSize%10 == 0 {
			log.Info().Int("progress", i+len(batch)).Int("total", len(newItems)).Msg("Item insert progress")
		}
	}

	// Resolve IDs for items with external_id (covers existing + newly inserted)
	if len(externalIDs) > 0 {
		existingQuery := `
			SELECT external_id, id FROM retailer_items
			WHERE chain_slug = $1 AND external_id = ANY($2)
		`
		rows, err := pool.Query(ctx, existingQuery, chainSlug, externalIDs)
		if err != nil {
			return nil, fmt.Errorf("failed to query items by external_id: %w", err)
		}
		for rows.Next() {
			var extID, itemID string
			if err := rows.Scan(&extID, &itemID); err != nil {
				rows.Close()
				return nil, fmt.Errorf("failed to scan item row: %w", err)
			}
			if key, ok := externalIDToKey[extID]; ok {
				result[key] = itemID
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("failed to iterate item rows: %w", err)
		}
		rows.Close()
	}

	// Fill IDs for items without external_id from insert IDs
	for key, id := range newIDs {
		if _, ok := result[key]; !ok {
			result[key] = id
		}
	}

	// Insert barcodes (including existing items; ON CONFLICT DO NOTHING)
	var barcodeRows []struct {
		itemID    string
		barcode   string
		isPrimary bool
	}
	for key, data := range uniqueItems {
		itemID, ok := result[key]
		if !ok || itemID == "" {
			continue
		}
		for j, bc := range data.Barcodes {
			barcodeRows = append(barcodeRows, struct {
				itemID    string
				barcode   string
				isPrimary bool
			}{
				itemID:    itemID,
				barcode:   bc,
				isPrimary: j == 0,
			})
		}
	}

	if len(barcodeRows) > 0 {
		const barcodeBatchSize = 1000
		for i := 0; i < len(barcodeRows); i += barcodeBatchSize {
			end := i + barcodeBatchSize
			if end > len(barcodeRows) {
				end = len(barcodeRows)
			}
			batch := barcodeRows[i:end]

			pgxBatch := &pgx.Batch{}
			for _, row := range batch {
				barcodeID := cuid2.GeneratePrefixedId("rbc", cuid2.PrefixedIdOptions{})
				pgxBatch.Queue(`
					INSERT INTO retailer_item_barcodes (id, retailer_item_id, barcode, is_primary)
					VALUES ($1, $2, $3, $4)
					ON CONFLICT (retailer_item_id, barcode) DO NOTHING
				`, barcodeID, row.itemID, row.barcode, row.isPrimary)
			}

			br := pool.SendBatch(ctx, pgxBatch)
			for j := 0; j < pgxBatch.Len(); j++ {
				if _, err := br.Exec(); err != nil {
					br.Close()
					return nil, fmt.Errorf("failed to insert barcode batch: %w", err)
				}
			}
			br.Close()
		}
	}

	// Rare updates: name/primary barcode only when changed
	type itemUpdateRow struct {
		id      string
		name    string
		barcode *string
	}
	updateRows := make([]itemUpdateRow, 0, len(result))
	for key, itemID := range result {
		data := uniqueItems[key]
		var primaryBarcode *string
		if len(data.Barcodes) > 0 {
			primaryBarcode = &data.Barcodes[0]
		}
		updateRows = append(updateRows, itemUpdateRow{
			id:      itemID,
			name:    data.Name,
			barcode: primaryBarcode,
		})
	}

	if len(updateRows) > 0 {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to begin item update tx: %w", err)
		}
		defer tx.Rollback(ctx)

		_, err = tx.Exec(ctx, `
			CREATE TEMP TABLE temp_retailer_item_updates (
				id TEXT,
				name TEXT,
				barcode TEXT
			) ON COMMIT DROP
		`)
		if err != nil {
			return nil, fmt.Errorf("failed to create item update temp table: %w", err)
		}

		copyCount, err := tx.CopyFrom(
			ctx,
			pgx.Identifier{"temp_retailer_item_updates"},
			[]string{"id", "name", "barcode"},
			pgx.CopyFromSlice(len(updateRows), func(i int) ([]any, error) {
				r := updateRows[i]
				return []any{r.id, r.name, r.barcode}, nil
			}),
		)
		if err != nil {
			return nil, fmt.Errorf("failed to COPY item updates: %w", err)
		}

		tag, err := tx.Exec(ctx, `
			UPDATE retailer_items ri
			SET name = s.name,
				barcode = COALESCE(s.barcode, ri.barcode)
			FROM temp_retailer_item_updates s
			WHERE ri.id = s.id
			  AND (
				ri.name IS DISTINCT FROM s.name
				OR (s.barcode IS NOT NULL AND ri.barcode IS DISTINCT FROM s.barcode)
			  )
		`)
		if err != nil {
			return nil, fmt.Errorf("failed to update retailer items: %w", err)
		}

		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("failed to commit item updates: %w", err)
		}

		log.Info().
			Int64("updateRowsCopied", copyCount).
			Int("itemsUpdated", int(tag.RowsAffected())).
			Msg("Retailer item updates complete")
	}

	return result, nil
}

// ============================================================================
// Snapshot Build + Atomic Swap (price_tiers, store_price_refs)
// ============================================================================

// tierCopyRow represents a row for COPY into the staging table
type tierCopyRow struct {
	id             string
	chainSlug      string
	retailerItemID string
	price          int
	discountPrice  *int
	unitPrice      *int
	anchorPrice    *int
	targetDate     time.Time
	firstSeenAt    time.Time
	lastSeenAt     time.Time
}

type refCopyRow struct {
	storeID        string
	retailerItemID string
	priceTierID    string
	inStock        bool
	targetDate     time.Time
	lastSeenAt     time.Time
}

type refBuildStats struct {
	deduped        int
	skippedMissing int
}

type swapStats struct {
	tiersInserted int
	refsInserted  int
}

func buildPriceTierCopyRows(
	chainSlug string,
	priceTiers map[priceTierKey]struct{},
	uniqueItems map[itemKey]itemData,
	itemIDMap map[itemKey]string,
	targetDate time.Time,
	now time.Time,
) ([]tierCopyRow, map[priceTierKey]string, int) {
	tierIDMap := make(map[priceTierKey]string, len(priceTiers))
	copyRows := make([]tierCopyRow, 0, len(priceTiers))
	skipped := 0

	for ptKey := range priceTiers {
		itemID, ok := itemIDMap[ptKey.ItemKey]
		if !ok {
			skipped++
			continue
		}

		tierID := cuid2.GeneratePrefixedId("pt", cuid2.PrefixedIdOptions{})
		tierIDMap[ptKey] = tierID

		var discountPrice *int
		if ptKey.DiscountPrice != -1 {
			dp := ptKey.DiscountPrice
			discountPrice = &dp
		}

		data := uniqueItems[ptKey.ItemKey]

		copyRows = append(copyRows, tierCopyRow{
			id:             tierID,
			chainSlug:      chainSlug,
			retailerItemID: itemID,
			price:          ptKey.Price,
			discountPrice:  discountPrice,
			unitPrice:      data.UnitPrice,
			anchorPrice:    data.AnchorPrice,
			targetDate:     targetDate,
			firstSeenAt:    now,
			lastSeenAt:     now,
		})
	}

	return copyRows, tierIDMap, skipped
}

func buildStorePriceRefCopyRows(
	storePriceRefs []storePriceRef,
	storeIDMap map[string]string,
	itemIDMap map[itemKey]string,
	tierIDMap map[priceTierKey]string,
	targetDate time.Time,
	now time.Time,
) ([]refCopyRow, refBuildStats) {
	stats := refBuildStats{}
	refByKey := make(map[string]refCopyRow, len(storePriceRefs))

	for _, ref := range storePriceRefs {
		storeID, ok := storeIDMap[ref.StoreIdentifier]
		if !ok {
			stats.skippedMissing++
			continue
		}

		itemID, ok := itemIDMap[ref.ItemKey]
		if !ok {
			stats.skippedMissing++
			continue
		}

		tierID, ok := tierIDMap[ref.PriceTierKey]
		if !ok {
			stats.skippedMissing++
			continue
		}

		key := storeID + ":" + itemID
		if _, exists := refByKey[key]; exists {
			stats.deduped++
		}

		refByKey[key] = refCopyRow{
			storeID:        storeID,
			retailerItemID: itemID,
			priceTierID:    tierID,
			inStock:        ref.InStock,
			targetDate:     targetDate,
			lastSeenAt:     now,
		}
	}

	copyRows := make([]refCopyRow, 0, len(refByKey))
	for _, row := range refByKey {
		copyRows = append(copyRows, row)
	}

	return copyRows, stats
}

func swapPriceSnapshot(
	ctx context.Context,
	pool *pgxpool.Pool,
	chainSlug string,
	targetDate time.Time,
	tierRows []tierCopyRow,
	refRows []refCopyRow,
) (*swapStats, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SET LOCAL synchronous_commit = off`); err != nil {
		return nil, fmt.Errorf("failed to set synchronous_commit: %w", err)
	}
	if _, err := tx.Exec(ctx, `SET LOCAL lock_timeout = '30s'`); err != nil {
		return nil, fmt.Errorf("failed to set lock_timeout: %w", err)
	}
	if _, err := tx.Exec(ctx, `SET LOCAL statement_timeout = '30min'`); err != nil {
		return nil, fmt.Errorf("failed to set statement_timeout: %w", err)
	}

	lockKey := fmt.Sprintf("%s:%s", chainSlug, targetDate.Format("2006-01-02"))
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, lockKey); err != nil {
		return nil, fmt.Errorf("failed to acquire advisory lock: %w", err)
	}

	_, err = tx.Exec(ctx, `
		CREATE TEMP TABLE staging_price_tiers (
			id TEXT,
			chain_slug TEXT,
			retailer_item_id TEXT,
			price INTEGER,
			discount_price INTEGER,
			unit_price INTEGER,
			anchor_price INTEGER,
			target_date DATE,
			first_seen_at TIMESTAMPTZ,
			last_seen_at TIMESTAMPTZ
		) ON COMMIT DROP
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to create staging_price_tiers: %w", err)
	}

	_, err = tx.Exec(ctx, `
		CREATE TEMP TABLE staging_store_price_refs (
			store_id TEXT,
			retailer_item_id TEXT,
			price_tier_id TEXT,
			in_stock BOOLEAN,
			target_date DATE,
			last_seen_at TIMESTAMPTZ
		) ON COMMIT DROP
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to create staging_store_price_refs: %w", err)
	}

	if len(tierRows) > 0 {
		copyCount, err := tx.CopyFrom(
			ctx,
			pgx.Identifier{"staging_price_tiers"},
			[]string{
				"id",
				"chain_slug",
				"retailer_item_id",
				"price",
				"discount_price",
				"unit_price",
				"anchor_price",
				"target_date",
				"first_seen_at",
				"last_seen_at",
			},
			pgx.CopyFromSlice(len(tierRows), func(i int) ([]any, error) {
				r := tierRows[i]
				return []any{
					r.id,
					r.chainSlug,
					r.retailerItemID,
					r.price,
					r.discountPrice,
					r.unitPrice,
					r.anchorPrice,
					r.targetDate,
					r.firstSeenAt,
					r.lastSeenAt,
				}, nil
			}),
		)
		if err != nil {
			return nil, fmt.Errorf("failed to COPY staging_price_tiers: %w", err)
		}
		log.Info().Int64("copied", copyCount).Msg("COPY to staging_price_tiers complete")
	}

	if len(refRows) > 0 {
		copyCount, err := tx.CopyFrom(
			ctx,
			pgx.Identifier{"staging_store_price_refs"},
			[]string{"store_id", "retailer_item_id", "price_tier_id", "in_stock", "target_date", "last_seen_at"},
			pgx.CopyFromSlice(len(refRows), func(i int) ([]any, error) {
				r := refRows[i]
				return []any{r.storeID, r.retailerItemID, r.priceTierID, r.inStock, r.targetDate, r.lastSeenAt}, nil
			}),
		)
		if err != nil {
			return nil, fmt.Errorf("failed to COPY staging_store_price_refs: %w", err)
		}
		log.Info().Int64("copied", copyCount).Msg("COPY to staging_store_price_refs complete")
	}

	_, err = tx.Exec(ctx, `
		DELETE FROM store_price_refs spr
		USING stores s
		WHERE spr.store_id = s.id
		  AND s.chain_slug = $1
		  AND spr.target_date = $2
	`, chainSlug, targetDate)
	if err != nil {
		return nil, fmt.Errorf("failed to delete store_price_refs: %w", err)
	}

	_, err = tx.Exec(ctx, `
		DELETE FROM price_tiers
		WHERE chain_slug = $1 AND target_date = $2
	`, chainSlug, targetDate)
	if err != nil {
		return nil, fmt.Errorf("failed to delete price_tiers: %w", err)
	}

	tag, err := tx.Exec(ctx, `
		INSERT INTO price_tiers (
			id,
			chain_slug,
			retailer_item_id,
			price,
			discount_price,
			unit_price,
			anchor_price,
			target_date,
			first_seen_at,
			last_seen_at
		)
		SELECT
			id,
			chain_slug,
			retailer_item_id,
			price,
			discount_price,
			unit_price,
			anchor_price,
			target_date,
			first_seen_at,
			last_seen_at
		FROM staging_price_tiers
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to insert price_tiers: %w", err)
	}
	tiersInserted := int(tag.RowsAffected())

	tag, err = tx.Exec(ctx, `
		INSERT INTO store_price_refs (
			store_id,
			retailer_item_id,
			price_tier_id,
			in_stock,
			target_date,
			last_seen_at
		)
		SELECT
			store_id,
			retailer_item_id,
			price_tier_id,
			in_stock,
			target_date,
			last_seen_at
		FROM staging_store_price_refs
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to insert store_price_refs: %w", err)
	}
	refsInserted := int(tag.RowsAffected())

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit snapshot swap: %w", err)
	}

	log.Info().
		Int("tiersInserted", tiersInserted).
		Int("refsInserted", refsInserted).
		Msg("COPY + atomic swap complete")

	return &swapStats{tiersInserted: tiersInserted, refsInserted: refsInserted}, nil
}

// spawnFinalizeTask schedules a finalize task after clustering
func spawnFinalizeTask(ctx context.Context, tq *taskqueue.TaskQueue, parentTaskID, chainSlug, runID string) error {
	finalizePayload := jsonb.FinalizePayload{
		Type:      string(taskqueue.TaskTypeIngestionFinalize),
		ChainSlug: chainSlug,
		RunID:     runID,
	}

	result := tq.ScheduleChildTask(ctx, taskqueue.ScheduleChildTaskInput{
		ParentTaskID: parentTaskID,
		TaskType:     string(taskqueue.TaskTypeIngestionFinalize),
		Payload:      finalizePayload,
		Priority:     0,
	})

	if result.Err != nil {
		return fmt.Errorf("failed to schedule finalize task: %w", result.Err)
	}

	// Transition this task to waiting for finalize to complete
	if err := tq.TransitionToWaiting(ctx, parentTaskID, 1); err != nil {
		log.Warn().Err(err).Str("taskId", parentTaskID).Msg("Failed to transition to waiting")
	}

	log.Info().
		Str("runId", runID).
		Str("finalizeTaskId", result.ID).
		Msg("Scheduled finalize task")

	return nil
}
