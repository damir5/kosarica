package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/kosarica/price-service/config"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/jsonb"
	"github.com/kosarica/price-service/internal/pkg/cuid2"
	"github.com/kosarica/price-service/internal/storage"
	"github.com/kosarica/price-service/internal/taskqueue"
	"github.com/rs/zerolog/log"
)

// HandleClusterTask processes an ingestion_cluster task from the queue.
// It reads all parsed data from intermediate storage, creates price tiers,
// and creates store price references.
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
		Msg("Processing cluster task")

	// Initialize storage backend
	storageBackend, err := storage.NewStorageBackend(&config.Get().Storage)
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}

	intermediateStorage, ok := storageBackend.(storage.IntermediateStorage)
	if !ok {
		return fmt.Errorf("storage backend does not support intermediate storage")
	}

	// List all intermediate files for this run
	files, err := intermediateStorage.ListIntermediateFiles(ctx, runID)
	if err != nil {
		return fmt.Errorf("failed to list intermediate files: %w", err)
	}

	log.Info().
		Str("runId", runID).
		Int("filesFound", len(files)).
		Msg("Found intermediate files")

	// Filter for store data files only (exclude manifest, duplicates, empty markers)
	storeFiles := make([]string, 0)
	for _, f := range files {
		if strings.HasPrefix(f, "stores/") && strings.HasSuffix(f, ".json") {
			storeFiles = append(storeFiles, f)
		}
	}

	log.Info().
		Str("runId", runID).
		Int("storeFiles", len(storeFiles)).
		Msg("Found store data files")

	if len(storeFiles) == 0 {
		log.Warn().Str("runId", runID).Msg("No store data files found, nothing to cluster")
		// Still spawn finalize task to complete the run
		return spawnFinalizeTask(ctx, tq, taskID, chainSlug, runID)
	}

	// Process each store file and build item→price→stores map
	// For memory efficiency, process in batches and write to DB incrementally
	totalItemsProcessed := 0
	totalStoresProcessed := 0
	totalTiersCreated := 0
	totalRefsCreated := 0

	for _, storeFile := range storeFiles {
		var storeData jsonb.ParsedStoreData
		if err := intermediateStorage.ReadIntermediateJSON(ctx, runID, storeFile, &storeData); err != nil {
			log.Warn().Err(err).Str("file", storeFile).Msg("Failed to read store data, skipping")
			continue
		}

		// Resolve store ID from store identifier
		storeID, err := resolveOrCreateStore(ctx, chainSlug, storeData.StoreIdentifier)
		if err != nil {
			log.Warn().Err(err).
				Str("storeIdentifier", storeData.StoreIdentifier).
				Msg("Failed to resolve store, skipping")
			continue
		}

		// Process each row and create/find price tier
		itemCount := 0
		for _, row := range storeData.Rows {
			// Find or create retailer item
			retailerItemID, err := findOrCreateRetailerItem(ctx, chainSlug, row)
			if err != nil {
				log.Debug().Err(err).Str("name", row.Name).Msg("Failed to find/create retailer item")
				continue
			}

			// Find or create price tier
			tierID, created, err := findOrCreatePriceTier(ctx, chainSlug, retailerItemID, row)
			if err != nil {
				log.Debug().Err(err).Str("retailerItemId", retailerItemID).Msg("Failed to find/create price tier")
				continue
			}
			if created {
				totalTiersCreated++
			}

			// Create store price reference
			if err := upsertStorePriceRef(ctx, storeID, retailerItemID, tierID); err != nil {
				log.Debug().Err(err).
					Str("storeId", storeID).
					Str("retailerItemId", retailerItemID).
					Msg("Failed to upsert store price ref")
				continue
			}
			totalRefsCreated++
			itemCount++
		}

		totalItemsProcessed += itemCount
		totalStoresProcessed++

		if totalStoresProcessed%10 == 0 {
			log.Info().
				Str("runId", runID).
				Int("storesProcessed", totalStoresProcessed).
				Int("totalStores", len(storeFiles)).
				Int("itemsProcessed", totalItemsProcessed).
				Msg("Cluster progress")
		}
	}

	log.Info().
		Str("runId", runID).
		Int("storesProcessed", totalStoresProcessed).
		Int("itemsProcessed", totalItemsProcessed).
		Int("tiersCreated", totalTiersCreated).
		Int("refsCreated", totalRefsCreated).
		Msg("Cluster task complete")

	// Spawn finalize task
	return spawnFinalizeTask(ctx, tq, taskID, chainSlug, runID)
}

// resolveOrCreateStore resolves a store identifier to a store ID, creating if needed
func resolveOrCreateStore(ctx context.Context, chainSlug, storeIdentifier string) (string, error) {
	pool := database.Pool()

	// First, try to find store by identifier
	var storeID string
	err := pool.QueryRow(ctx, `
		SELECT s.id FROM stores s
		JOIN store_identifiers si ON s.id = si.store_id
		WHERE si.value = $1 AND s.chain_slug = $2
		LIMIT 1
	`, storeIdentifier, chainSlug).Scan(&storeID)

	if err == nil {
		return storeID, nil
	}

	if err != pgx.ErrNoRows {
		return "", fmt.Errorf("failed to query store: %w", err)
	}

	// Create new store
	storeID = cuid2.GeneratePrefixedId("str", cuid2.PrefixedIdOptions{})
	storeName := fmt.Sprintf("%s Store %s", chainSlug, storeIdentifier)

	_, err = pool.Exec(ctx, `
		INSERT INTO stores (id, chain_slug, name, is_virtual, status)
		VALUES ($1, $2, $3, true, 'active')
		ON CONFLICT DO NOTHING
	`, storeID, chainSlug, storeName)
	if err != nil {
		return "", fmt.Errorf("failed to create store: %w", err)
	}

	// Create store identifier
	identifierID := cuid2.GeneratePrefixedId("sid", cuid2.PrefixedIdOptions{})
	_, err = pool.Exec(ctx, `
		INSERT INTO store_identifiers (id, store_id, type, value)
		VALUES ($1, $2, 'filename_code', $3)
		ON CONFLICT DO NOTHING
	`, identifierID, storeID, storeIdentifier)
	if err != nil {
		log.Warn().Err(err).Str("storeId", storeID).Msg("Failed to create store identifier")
	}

	return storeID, nil
}

// findOrCreateRetailerItem finds or creates a retailer item
func findOrCreateRetailerItem(ctx context.Context, chainSlug string, row jsonb.ParsedPriceRow) (string, error) {
	pool := database.Pool()

	// Try to find by external ID first
	if row.ExternalID != "" {
		var itemID string
		err := pool.QueryRow(ctx, `
			SELECT id FROM retailer_items
			WHERE chain_slug = $1 AND external_id = $2
		`, chainSlug, row.ExternalID).Scan(&itemID)

		if err == nil {
			return itemID, nil
		}
		if err != pgx.ErrNoRows {
			return "", fmt.Errorf("failed to query retailer item: %w", err)
		}
	}

	// Try to find by barcode
	if len(row.Barcodes) > 0 {
		var itemID string
		err := pool.QueryRow(ctx, `
			SELECT ri.id FROM retailer_items ri
			JOIN retailer_item_barcodes rib ON ri.id = rib.retailer_item_id
			WHERE ri.chain_slug = $1 AND rib.barcode = ANY($2)
			LIMIT 1
		`, chainSlug, row.Barcodes).Scan(&itemID)

		if err == nil {
			return itemID, nil
		}
		if err != pgx.ErrNoRows {
			return "", fmt.Errorf("failed to query retailer item by barcode: %w", err)
		}
	}

	// Create new retailer item
	itemID := cuid2.GeneratePrefixedId("itm", cuid2.PrefixedIdOptions{})

	var externalID *string
	if row.ExternalID != "" {
		externalID = &row.ExternalID
	}

	var barcode *string
	if len(row.Barcodes) > 0 {
		barcode = &row.Barcodes[0]
	}

	_, err := pool.Exec(ctx, `
		INSERT INTO retailer_items (id, chain_slug, name, external_id, barcode)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (chain_slug, external_id) DO UPDATE SET
			name = EXCLUDED.name,
			barcode = COALESCE(EXCLUDED.barcode, retailer_items.barcode)
		RETURNING id
	`, itemID, chainSlug, row.Name, externalID, barcode)
	if err != nil {
		// Try to get existing on conflict
		if row.ExternalID != "" {
			err2 := pool.QueryRow(ctx, `
				SELECT id FROM retailer_items
				WHERE chain_slug = $1 AND external_id = $2
			`, chainSlug, row.ExternalID).Scan(&itemID)
			if err2 == nil {
				return itemID, nil
			}
		}
		return "", fmt.Errorf("failed to create retailer item: %w", err)
	}

	// Create barcode records
	for i, bc := range row.Barcodes {
		barcodeID := cuid2.GeneratePrefixedId("rbc", cuid2.PrefixedIdOptions{})
		isPrimary := i == 0
		_, err := pool.Exec(ctx, `
			INSERT INTO retailer_item_barcodes (id, retailer_item_id, barcode, is_primary)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (retailer_item_id, barcode) DO NOTHING
		`, barcodeID, itemID, bc, isPrimary)
		if err != nil {
			log.Debug().Err(err).Str("barcode", bc).Msg("Failed to create barcode record")
		}
	}

	return itemID, nil
}

// findOrCreatePriceTier finds or creates a price tier for an item
func findOrCreatePriceTier(ctx context.Context, chainSlug, retailerItemID string, row jsonb.ParsedPriceRow) (string, bool, error) {
	pool := database.Pool()

	// Build discount price for lookup (use -1 as sentinel for NULL)
	discountPrice := -1
	if row.DiscountPrice != nil {
		discountPrice = *row.DiscountPrice
	}

	// Try to find existing tier
	var tierID string
	err := pool.QueryRow(ctx, `
		SELECT id FROM price_tiers
		WHERE chain_slug = $1
		  AND retailer_item_id = $2
		  AND price = $3
		  AND COALESCE(discount_price, -1) = $4
	`, chainSlug, retailerItemID, row.Price, discountPrice).Scan(&tierID)

	if err == nil {
		// Update last_seen_at
		_, _ = pool.Exec(ctx, `
			UPDATE price_tiers SET last_seen_at = NOW() WHERE id = $1
		`, tierID)
		return tierID, false, nil
	}

	if err != pgx.ErrNoRows {
		return "", false, fmt.Errorf("failed to query price tier: %w", err)
	}

	// Create new tier
	tierID = cuid2.GeneratePrefixedId("pt", cuid2.PrefixedIdOptions{})
	now := time.Now()

	_, err = pool.Exec(ctx, `
		INSERT INTO price_tiers (id, chain_slug, retailer_item_id, price, discount_price, unit_price, anchor_price, first_seen_at, last_seen_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
		ON CONFLICT (chain_slug, retailer_item_id, price, COALESCE(discount_price, -1)) DO UPDATE SET
			last_seen_at = NOW()
		RETURNING id
	`, tierID, chainSlug, retailerItemID, row.Price, row.DiscountPrice, row.UnitPrice, row.AnchorPrice, now)

	if err != nil {
		// Try to get existing on conflict
		err2 := pool.QueryRow(ctx, `
			SELECT id FROM price_tiers
			WHERE chain_slug = $1
			  AND retailer_item_id = $2
			  AND price = $3
			  AND COALESCE(discount_price, -1) = $4
		`, chainSlug, retailerItemID, row.Price, discountPrice).Scan(&tierID)
		if err2 == nil {
			return tierID, false, nil
		}
		return "", false, fmt.Errorf("failed to create price tier: %w", err)
	}

	return tierID, true, nil
}

// upsertStorePriceRef creates or updates a store price reference
func upsertStorePriceRef(ctx context.Context, storeID, retailerItemID, priceTierID string) error {
	pool := database.Pool()

	_, err := pool.Exec(ctx, `
		INSERT INTO store_price_refs (store_id, retailer_item_id, price_tier_id, in_stock, last_seen_at)
		VALUES ($1, $2, $3, true, NOW())
		ON CONFLICT (store_id, retailer_item_id) DO UPDATE SET
			price_tier_id = EXCLUDED.price_tier_id,
			last_seen_at = NOW()
	`, storeID, retailerItemID, priceTierID)

	if err != nil {
		return fmt.Errorf("failed to upsert store price ref: %w", err)
	}

	return nil
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
