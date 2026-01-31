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

	// Acquire semaphore slot for heap-based concurrency control
	if err := ingestion.AcquireClusterSlot(ctx); err != nil {
		return fmt.Errorf("failed to acquire cluster slot: %w", err)
	}
	defer ingestion.ReleaseClusterSlot()

	log.Info().
		Str("runId", runID).
		Msg("Acquired cluster slot")

	startTime := time.Now()

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
	stats, err := batchWriteToDatabase(ctx, chainSlug, storeIdentifiers, uniqueItems, priceTiers, storePriceRefs)
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
		Int("tiersUpserted", stats.tiersUpserted).
		Int("refsUpserted", stats.refsUpserted).
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
	tiersUpserted  int
	refsUpserted   int
}

func batchWriteToDatabase(
	ctx context.Context,
	chainSlug string,
	storeIdentifiers []string,
	uniqueItems map[itemKey]itemData,
	priceTiers map[priceTierKey]struct{},
	storePriceRefs []storePriceRef,
) (*writeStats, error) {
	pool := database.Pool()
	stats := &writeStats{}

	// ========================================================================
	// Step 1: Upsert all stores and build identifier→storeID map
	// ========================================================================
	log.Info().Int("stores", len(storeIdentifiers)).Msg("Upserting stores...")

	storeIDMap, err := upsertStoresBatch(ctx, pool, chainSlug, storeIdentifiers)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert stores: %w", err)
	}
	stats.storesUpserted = len(storeIDMap)

	// ========================================================================
	// Step 2: Upsert all retailer items and build key→itemID map
	// ========================================================================
	log.Info().Int("items", len(uniqueItems)).Msg("Upserting retailer items...")

	itemIDMap, err := upsertRetailerItemsBatch(ctx, pool, chainSlug, uniqueItems)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert retailer items: %w", err)
	}
	stats.itemsUpserted = len(itemIDMap)

	// ========================================================================
	// Step 3: Upsert all price tiers and build key→tierID map
	// ========================================================================
	log.Info().Int("tiers", len(priceTiers)).Msg("Upserting price tiers...")

	tierIDMap, err := upsertPriceTiersBatch(ctx, pool, chainSlug, priceTiers, uniqueItems, itemIDMap)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert price tiers: %w", err)
	}
	stats.tiersUpserted = len(tierIDMap)

	// ========================================================================
	// Step 4: Upsert all store price refs
	// ========================================================================
	log.Info().Int("refs", len(storePriceRefs)).Msg("Upserting store price refs...")

	refsUpserted, err := upsertStorePriceRefsBatch(ctx, pool, storeIDMap, itemIDMap, tierIDMap, storePriceRefs)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert store price refs: %w", err)
	}
	stats.refsUpserted = refsUpserted

	return stats, nil
}

// ============================================================================
// Batch Upsert Functions
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

// upsertRetailerItemsBatch upserts all retailer items using pgx.Batch
func upsertRetailerItemsBatch(ctx context.Context, pool *pgxpool.Pool, chainSlug string, uniqueItems map[itemKey]itemData) (map[itemKey]string, error) {
	result := make(map[itemKey]string)

	// Collect external IDs and barcodes for lookup
	var externalIDs []string
	var barcodes []string
	for key := range uniqueItems {
		if key.ExternalID != "" {
			externalIDs = append(externalIDs, key.ExternalID)
		}
		if key.Barcode != "" {
			barcodes = append(barcodes, key.Barcode)
		}
	}

	// Find existing items by external_id
	if len(externalIDs) > 0 {
		existingQuery := `
			SELECT external_id, id FROM retailer_items
			WHERE chain_slug = $1 AND external_id = ANY($2)
		`
		rows, err := pool.Query(ctx, existingQuery, chainSlug, externalIDs)
		if err != nil {
			return nil, fmt.Errorf("failed to query existing items by external_id: %w", err)
		}

		for rows.Next() {
			var extID, itemID string
			if err := rows.Scan(&extID, &itemID); err != nil {
				rows.Close()
				return nil, fmt.Errorf("failed to scan item row: %w", err)
			}
			// Find the itemKey with this external ID
			for key := range uniqueItems {
				if key.ExternalID == extID {
					result[key] = itemID
					break
				}
			}
		}
		rows.Close()
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
			// Find the itemKey with this barcode (if not already found)
			for key := range uniqueItems {
				if key.Barcode == barcode && result[key] == "" {
					result[key] = itemID
					break
				}
			}
		}
		rows.Close()
	}

	// Insert new items in batches
	var newItems []itemKey
	for key := range uniqueItems {
		if _, exists := result[key]; !exists {
			newItems = append(newItems, key)
		}
	}

	if len(newItems) == 0 {
		return result, nil
	}

	const batchSize = 500
	for i := 0; i < len(newItems); i += batchSize {
		end := i + batchSize
		if end > len(newItems) {
			end = len(newItems)
		}
		batch := newItems[i:end]

		pgxBatch := &pgx.Batch{}
		newIDs := make(map[itemKey]string)

		for _, key := range batch {
			data := uniqueItems[key]
			itemID := cuid2.GeneratePrefixedId("itm", cuid2.PrefixedIdOptions{})
			newIDs[key] = itemID

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
				ON CONFLICT (chain_slug, external_id) DO UPDATE SET
					name = EXCLUDED.name,
					barcode = COALESCE(EXCLUDED.barcode, retailer_items.barcode)
			`, itemID, chainSlug, data.Name, externalID, barcode)

			// Insert barcodes
			for j, bc := range data.Barcodes {
				barcodeID := cuid2.GeneratePrefixedId("rbc", cuid2.PrefixedIdOptions{})
				isPrimary := j == 0
				pgxBatch.Queue(`
					INSERT INTO retailer_item_barcodes (id, retailer_item_id, barcode, is_primary)
					VALUES ($1, $2, $3, $4)
					ON CONFLICT (retailer_item_id, barcode) DO NOTHING
				`, barcodeID, itemID, bc, isPrimary)
			}
		}

		br := pool.SendBatch(ctx, pgxBatch)
		// We must read all results from the batch, even if errors occur
		for j := 0; j < pgxBatch.Len(); j++ {
			_, err := br.Exec()
			if err != nil {
				// ON CONFLICT errors are expected - just log at debug level
				log.Debug().Err(err).Msg("Batch exec error (may be expected for conflicts)")
			}
		}
		br.Close()

		// For items with ON CONFLICT, query back the actual IDs
		for key := range newIDs {
			data := uniqueItems[key]
			if data.ExternalID != "" {
				var actualID string
				err := pool.QueryRow(ctx, `
					SELECT id FROM retailer_items WHERE chain_slug = $1 AND external_id = $2
				`, chainSlug, data.ExternalID).Scan(&actualID)
				if err == nil {
					result[key] = actualID
				} else {
					result[key] = newIDs[key]
				}
			} else {
				result[key] = newIDs[key]
			}
		}

		if (i+batchSize)/batchSize%10 == 0 {
			log.Info().Int("progress", i+len(batch)).Int("total", len(newItems)).Msg("Item upsert progress")
		}
	}

	return result, nil
}

// upsertPriceTiersBatch upserts all price tiers using pgx.Batch
func upsertPriceTiersBatch(
	ctx context.Context,
	pool *pgxpool.Pool,
	chainSlug string,
	priceTiers map[priceTierKey]struct{},
	uniqueItems map[itemKey]itemData,
	itemIDMap map[itemKey]string,
) (map[priceTierKey]string, error) {
	result := make(map[priceTierKey]string)
	now := time.Now()

	// Build list of tiers with resolved item IDs for lookup
	type tierWithDBID struct {
		ptKey          priceTierKey
		retailerItemID string
	}
	var tiersToProcess []tierWithDBID

	for ptKey := range priceTiers {
		itemID, ok := itemIDMap[ptKey.ItemKey]
		if !ok {
			log.Debug().
				Str("externalId", ptKey.ItemKey.ExternalID).
				Str("barcode", ptKey.ItemKey.Barcode).
				Msg("Item not found in itemIDMap, skipping tier")
			continue
		}
		tiersToProcess = append(tiersToProcess, tierWithDBID{
			ptKey:          ptKey,
			retailerItemID: itemID,
		})
	}

	if len(tiersToProcess) == 0 {
		return result, nil
	}

	// Query existing tiers in batches
	const lookupBatchSize = 1000
	existingTiers := make(map[string]string) // "itemID:price:discountPrice" -> tierID

	for i := 0; i < len(tiersToProcess); i += lookupBatchSize {
		end := i + lookupBatchSize
		if end > len(tiersToProcess) {
			end = len(tiersToProcess)
		}
		batch := tiersToProcess[i:end]

		// Collect item IDs for query
		itemIDSet := make(map[string]struct{})
		for _, t := range batch {
			itemIDSet[t.retailerItemID] = struct{}{}
		}
		var itemIDs []string
		for id := range itemIDSet {
			itemIDs = append(itemIDs, id)
		}

		rows, err := pool.Query(ctx, `
			SELECT id, retailer_item_id, price, COALESCE(discount_price, -1) as dp
			FROM price_tiers
			WHERE chain_slug = $1 AND retailer_item_id = ANY($2)
		`, chainSlug, itemIDs)
		if err != nil {
			return nil, fmt.Errorf("failed to query existing tiers: %w", err)
		}

		for rows.Next() {
			var tierID, itemID string
			var price, dp int
			if err := rows.Scan(&tierID, &itemID, &price, &dp); err != nil {
				rows.Close()
				return nil, fmt.Errorf("failed to scan tier row: %w", err)
			}
			key := fmt.Sprintf("%s:%d:%d", itemID, price, dp)
			existingTiers[key] = tierID
		}
		rows.Close()
	}

	// Map existing tiers to result
	var newTiers []tierWithDBID
	for _, t := range tiersToProcess {
		key := fmt.Sprintf("%s:%d:%d", t.retailerItemID, t.ptKey.Price, t.ptKey.DiscountPrice)
		if tierID, exists := existingTiers[key]; exists {
			result[t.ptKey] = tierID
		} else {
			newTiers = append(newTiers, t)
		}
	}

	// Update last_seen_at for existing tiers
	if len(result) > 0 {
		var tierIDs []string
		for _, id := range result {
			tierIDs = append(tierIDs, id)
		}
		_, err := pool.Exec(ctx, `
			UPDATE price_tiers SET last_seen_at = $1 WHERE id = ANY($2)
		`, now, tierIDs)
		if err != nil {
			log.Warn().Err(err).Msg("Failed to update last_seen_at for existing tiers")
		}
	}

	if len(newTiers) == 0 {
		return result, nil
	}

	// Insert new tiers in batches
	const batchSize = 500
	for i := 0; i < len(newTiers); i += batchSize {
		end := i + batchSize
		if end > len(newTiers) {
			end = len(newTiers)
		}
		batch := newTiers[i:end]

		pgxBatch := &pgx.Batch{}
		newIDs := make(map[priceTierKey]string)

		for _, t := range batch {
			tierID := cuid2.GeneratePrefixedId("pt", cuid2.PrefixedIdOptions{})
			newIDs[t.ptKey] = tierID

			var discountPrice *int
			if t.ptKey.DiscountPrice != -1 {
				dp := t.ptKey.DiscountPrice
				discountPrice = &dp
			}

			// Find unit_price and anchor_price from item data
			data := uniqueItems[t.ptKey.ItemKey]
			unitPrice := data.UnitPrice
			anchorPrice := data.AnchorPrice

			pgxBatch.Queue(`
				INSERT INTO price_tiers (id, chain_slug, retailer_item_id, price, discount_price, unit_price, anchor_price, first_seen_at, last_seen_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
				ON CONFLICT (chain_slug, retailer_item_id, price, COALESCE(discount_price, -1)) DO UPDATE SET
					last_seen_at = $8
			`, tierID, chainSlug, t.retailerItemID, t.ptKey.Price, discountPrice, unitPrice, anchorPrice, now)
		}

		br := pool.SendBatch(ctx, pgxBatch)
		// We must read all results from the batch, even if errors occur
		for j := 0; j < pgxBatch.Len(); j++ {
			_, err := br.Exec()
			if err != nil {
				// ON CONFLICT errors are expected - just log at debug level
				log.Debug().Err(err).Msg("Tier batch exec error (may be expected for conflicts)")
			}
		}
		br.Close()

		// For tiers with ON CONFLICT, query back the actual IDs
		for _, t := range batch {
			var actualID string
			err := pool.QueryRow(ctx, `
				SELECT id FROM price_tiers
				WHERE chain_slug = $1 AND retailer_item_id = $2 AND price = $3
				AND COALESCE(discount_price, -1) = $4
			`, chainSlug, t.retailerItemID, t.ptKey.Price, t.ptKey.DiscountPrice).Scan(&actualID)
			if err == nil {
				result[t.ptKey] = actualID
			} else {
				result[t.ptKey] = newIDs[t.ptKey]
			}
		}

		if (i+batchSize)/batchSize%10 == 0 {
			log.Info().Int("progress", i+len(batch)).Int("total", len(newTiers)).Msg("Tier upsert progress")
		}
	}

	return result, nil
}

// upsertStorePriceRefsBatch upserts all store price refs using pgx.Batch
func upsertStorePriceRefsBatch(
	ctx context.Context,
	pool *pgxpool.Pool,
	storeIDMap map[string]string,
	itemIDMap map[itemKey]string,
	tierIDMap map[priceTierKey]string,
	storePriceRefs []storePriceRef,
) (int, error) {
	now := time.Now()
	upserted := 0

	const batchSize = 2000
	for i := 0; i < len(storePriceRefs); i += batchSize {
		end := i + batchSize
		if end > len(storePriceRefs) {
			end = len(storePriceRefs)
		}
		batch := storePriceRefs[i:end]

		pgxBatch := &pgx.Batch{}

		for _, ref := range batch {
			storeID, ok := storeIDMap[ref.StoreIdentifier]
			if !ok {
				continue
			}

			itemID, ok := itemIDMap[ref.ItemKey]
			if !ok {
				continue
			}

			tierID, ok := tierIDMap[ref.PriceTierKey]
			if !ok {
				continue
			}

			pgxBatch.Queue(`
				INSERT INTO store_price_refs (store_id, retailer_item_id, price_tier_id, in_stock, last_seen_at)
				VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (store_id, retailer_item_id) DO UPDATE SET
					price_tier_id = EXCLUDED.price_tier_id,
					in_stock = EXCLUDED.in_stock,
					last_seen_at = EXCLUDED.last_seen_at
			`, storeID, itemID, tierID, ref.InStock, now)
		}

		if pgxBatch.Len() == 0 {
			continue
		}

		br := pool.SendBatch(ctx, pgxBatch)
		for j := 0; j < pgxBatch.Len(); j++ {
			_, err := br.Exec()
			if err != nil {
				br.Close()
				return upserted, fmt.Errorf("failed to execute store price ref batch: %w", err)
			}
			upserted++
		}
		br.Close()

		if (i+batchSize)/batchSize%50 == 0 {
			log.Info().Int("progress", i+len(batch)).Int("total", len(storePriceRefs)).Msg("Store price ref upsert progress")
		}
	}

	return upserted, nil
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
