package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/pkg/cuid2"
	"github.com/kosarica/price-service/internal/pricegroups"
	"github.com/kosarica/price-service/internal/types"
)

// PersistResult represents the result of persisting parsed data
type PersistResult struct {
	Persisted    int
	PriceChanges int
}

// PersistPhase executes the persist phase of the ingestion pipeline
// It persists normalized rows to the database and links them to the archive
func PersistPhase(ctx context.Context, chainID string, parseResult *ParseResult, file types.DiscoveredFile, runID string, archiveID string) (*PersistResult, error) {
	// Get adapter from registry
	adapter, err := registry.GetAdapter(config.ChainID(chainID))
	if err != nil {
		return nil, fmt.Errorf("failed to get adapter for %s: %w", chainID, err)
	}

	// Extract store metadata for auto-registration
	storeMetadata := adapter.ExtractStoreMetadata(file)

	totalPersisted := 0
	totalPriceChanges := 0
	var allItemIDs []string

	for storeIdentifier, rows := range parseResult.RowsByStore {
		// Resolve or register store
		storeID, err := resolveOrCreateStore(ctx, chainID, storeIdentifier, storeMetadata)
		if err != nil {
			fmt.Printf("[WARN] Failed to resolve store %s: %v\n", storeIdentifier, err)
			continue
		}

		// Persist rows for this store
		persisted, priceChanges, itemIDs, err := persistRowsForStore(ctx, chainID, storeID, storeIdentifier, rows, archiveID, runID, parseResult.FileID)
		if err != nil {
			fmt.Printf("[ERROR] Failed to persist rows for store %s: %v\n", storeIdentifier, err)
			continue
		}

		totalPersisted += persisted
		totalPriceChanges += priceChanges
		allItemIDs = append(allItemIDs, itemIDs...)
	}

	// Link retailer items to archive
	if archiveID != "" && len(allItemIDs) > 0 {
		if err := database.UpdateRetailerItemArchiveID(ctx, allItemIDs, archiveID); err != nil {
			fmt.Printf("[WARN] Failed to link items to archive: %v\n", err)
		} else {
			fmt.Printf("[INFO] Linked %d items to archive %s\n", len(allItemIDs), archiveID)
		}
	}

	fmt.Printf("[INFO] Persisted %d rows (%d price changes) for %s\n", totalPersisted, totalPriceChanges, file.Filename)

	// Collect cleanup errors
	var persistErrors []error

	// Mark file as completed
	if err := markFileCompleted(ctx, parseResult.FileID, 1); err != nil {
		persistErrors = append(persistErrors, fmt.Errorf("failed to mark file as completed: %w", err))
	}

	// Update run progress
	if err := incrementProcessedFiles(ctx, runID); err != nil {
		persistErrors = append(persistErrors, fmt.Errorf("failed to increment processed files: %w", err))
	}
	if err := incrementProcessedEntries(ctx, runID, totalPersisted); err != nil {
		persistErrors = append(persistErrors, fmt.Errorf("failed to increment processed entries: %w", err))
	}

	// Check if run is complete
	if _, err := checkAndUpdateRunCompletion(ctx, runID); err != nil {
		persistErrors = append(persistErrors, fmt.Errorf("failed to check run completion: %w", err))
	}

	if len(persistErrors) > 0 {
		return &PersistResult{
			Persisted:    totalPersisted,
			PriceChanges: totalPriceChanges,
		}, fmt.Errorf("encountered %d error(s) during cleanup: %w", len(persistErrors), errors.Join(persistErrors...))
	}

	return &PersistResult{
		Persisted:    totalPersisted,
		PriceChanges: totalPriceChanges,
	}, nil
}

// resolveOrCreateStore resolves an existing store or creates a new one
func resolveOrCreateStore(ctx context.Context, chainID string, storeIdentifier string, metadata *types.StoreMetadata) (string, error) {
	// First, try to find existing store by identifier
	storeID, err := findStoreByIdentifier(ctx, chainID, storeIdentifier)
	if err == nil && storeID != "" {
		return storeID, nil
	}

	// Store not found, create new one
	return createStore(ctx, chainID, storeIdentifier, metadata)
}

// findStoreByIdentifier finds a store by its identifier
func findStoreByIdentifier(ctx context.Context, chainID string, storeIdentifier string) (string, error) {
	pool := database.Pool()

	var storeID string
	err := pool.QueryRow(ctx, `
		SELECT si.id
		FROM stores si
		JOIN store_identifiers sident ON sident.store_id = si.id
		WHERE si.chain_slug = $1
		  AND sident.type = 'filename_code'
		  AND sident.value = $2
		LIMIT 1
	`, chainID, storeIdentifier).Scan(&storeID)

	if err == pgx.ErrNoRows {
		return "", nil
	}
	return storeID, err
}

// createStore creates a new store with auto-registration
func createStore(ctx context.Context, chainID string, storeIdentifier string, metadata *types.StoreMetadata) (string, error) {
	pool := database.Pool()

	// Generate store ID
	storeID := cuid2.GeneratePrefixedId("sid", cuid2.PrefixedIdOptions{})

	// Determine store name and details
	name := fmt.Sprintf("%s Store %s", chainID, storeIdentifier)
	address := (*string)(nil)
	city := (*string)(nil)
	postalCode := (*string)(nil)

	if metadata != nil {
		if metadata.Name != "" {
			name = metadata.Name
		}
		if metadata.Address != "" {
			address = &metadata.Address
		}
		if metadata.City != "" {
			city = &metadata.City
		}
		if metadata.PostalCode != "" {
			postalCode = &metadata.PostalCode
		}
	}

	// Insert store
	_, err := pool.Exec(ctx, `
		INSERT INTO stores (id, chain_slug, name, address, city, postal_code, is_virtual, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, false, 'pending', NOW(), NOW())
		ON CONFLICT (id) DO NOTHING
	`, storeID, chainID, name, address, city, postalCode)
	if err != nil {
		return "", fmt.Errorf("failed to insert store: %w", err)
	}

	// Insert store identifier
	identifierID := cuid2.GeneratePrefixedId("sid", cuid2.PrefixedIdOptions{})
	_, err = pool.Exec(ctx, `
		INSERT INTO store_identifiers (id, store_id, type, value, created_at)
		VALUES ($1, $2, 'filename_code', $3, NOW())
		ON CONFLICT (id) DO NOTHING
	`, identifierID, storeID, storeIdentifier)
	if err != nil {
		return "", fmt.Errorf("failed to insert store identifier: %w", err)
	}

	fmt.Printf("[INFO] Auto-registered store: %s (id: %s)\n", name, storeID)
	return storeID, nil
}

// persistRowsForStore persists normalized rows for a specific store using price groups
func persistRowsForStore(ctx context.Context, chainID string, storeID string, storeIdentifier string, rows []types.NormalizedRow, archiveID string, runID string, fileID string) (int, int, []string, error) {
	// Step 1: Collect all validated items with prices
	itemPrices := make([]pricegroups.ItemPrice, 0, len(rows))
	itemData := make(map[string]types.NormalizedRow) // Map itemID -> row data
	persisted := 0
	priceChanges := 0
	itemIDs := make([]string, 0, len(rows))

	// First pass: validate and find/create retailer items, build price hash input
	for _, row := range rows {
		// Validate row
		validation := validateNormalizedRow(row)
		if !validation.IsValid {
			fmt.Printf("[DEBUG] VALIDATION FAILED - Row %d\n", row.RowNumber)
			fmt.Printf("  Name: %q\n", row.Name)
			fmt.Printf("  Price: %d\n", row.Price)
			fmt.Printf("  Store: %s, Chain: %s\n", row.StoreIdentifier, chainID)
			fmt.Printf("  Errors: %v\n", validation.Errors)
			fmt.Printf("  Raw Data: %s\n", row.RawData)

			// Save failed row for later analysis and re-processing
			if err := saveFailedRow(ctx, database.Pool(), chainID, runID, fileID, row, validation); err != nil {
				fmt.Printf("[ERROR] Failed to save failed row %d: %v\n", row.RowNumber, err)
			}

			continue
		}

		// Find or create retailer item
		retailerItemID, err := findOrCreateRetailerItem(ctx, chainID, row, archiveID)
		if err != nil {
			fmt.Printf("[WARN] Failed to find/create retailer item for row %d: %v\n", row.RowNumber, err)
			continue
		}

		itemIDs = append(itemIDs, retailerItemID)
		itemData[retailerItemID] = row

		// Add to price hash input
		itemPrices = append(itemPrices, pricegroups.ItemPrice{
			ItemID:        retailerItemID,
			Price:         row.Price,
			DiscountPrice: row.DiscountPrice,
		})
	}

	if len(itemPrices) == 0 {
		return 0, 0, nil, nil // No valid items
	}

	// Step 2: Compute price hash
	priceHash := pricegroups.ComputePriceHash(itemPrices)

	// Step 3: Find or create price group by hash
	group, isNewGroup, err := database.FindOrCreatePriceGroup(ctx, chainID, priceHash)
	if err != nil {
		return 0, 0, nil, fmt.Errorf("failed to find/create price group: %w", err)
	}

	// Detect "Zombie Group" scenario:
	// If a previous run created the group but failed to insert prices, we have an existing group with 0 items.
	// We must treat this as a new group to retry the price insertion.
	if !isNewGroup && len(itemPrices) > 0 && group.ItemCount == 0 {
		fmt.Printf("[WARN] Detected zombie price group %s (0 items). Attempting repair.\n", group.ID)
		isNewGroup = true
	}

	// Step 4: If new group (or zombie), bulk insert group prices
	if isNewGroup {
		groupPrices := make([]database.GroupPrice, 0, len(itemPrices))
		for _, itemPrice := range itemPrices {
			row := itemData[itemPrice.ItemID]
			groupPrices = append(groupPrices, database.GroupPrice{
				PriceGroupID:   group.ID,
				RetailerItemID: itemPrice.ItemID,
				Price:          itemPrice.Price,
				DiscountPrice:  itemPrice.DiscountPrice,
				UnitPrice:      row.UnitPrice,
				AnchorPrice:    row.AnchorPrice,
			})
		}

		if err := database.BulkInsertGroupPrices(ctx, group.ID, groupPrices); err != nil {
			return 0, 0, nil, fmt.Errorf("failed to bulk insert group prices: %w", err)
		}
		fmt.Printf("[INFO] Created new price group %s with %d items\n", group.ID, len(groupPrices))
	} else {
		// Existing group: update last_seen_at
		if err := database.UpdateGroupLastSeen(ctx, group.ID); err != nil {
			fmt.Printf("[WARN] Failed to update group last_seen: %v\n", err)
		}
	}

	// Step 5: Assign store to group (closes previous membership)
	if err := database.AssignStoreToGroup(ctx, storeID, group.ID); err != nil {
		return 0, 0, nil, fmt.Errorf("failed to assign store to group: %w", err)
	}

	// Step 6: Update store_item_state for price change tracking
	// We still maintain store_item_state for historical price tracking
	pool := database.Pool()

	// Begin transaction for store item state updates
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, 0, nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, itemID := range itemIDs {
		row := itemData[itemID]

		// Check for price change (from previous state)
		priceChanged := false
		var previousPrice *int

		if err := tx.QueryRow(ctx, `
			SELECT current_price
			FROM store_item_state
			WHERE store_id = $1 AND retailer_item_id = $2
		`, storeID, itemID).Scan(&previousPrice); err == nil && previousPrice != nil {
			if *previousPrice != row.Price {
				priceChanged = true
			}
		}

		// Upsert store item state (for tracking price history)
		priceSignature := computePriceSignature(row)

		_, err = tx.Exec(ctx, `
			INSERT INTO store_item_state (
				id, store_id, retailer_item_id, current_price, previous_price,
				discount_price, discount_start, discount_end, in_stock,
				unit_price, unit_price_base_quantity, unit_price_base_unit,
				lowest_price_30d, anchor_price, anchor_price_as_of,
				price_signature, last_seen_at, updated_at
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, true,
				$9, $10, $11, $12, $13, $14, $15, NOW(), NOW()
			)
			ON CONFLICT (store_id, retailer_item_id) DO UPDATE SET
				previous_price = store_item_state.current_price,
				current_price = EXCLUDED.current_price,
				discount_price = EXCLUDED.discount_price,
				discount_start = EXCLUDED.discount_start,
				discount_end = EXCLUDED.discount_end,
				unit_price = EXCLUDED.unit_price,
				unit_price_base_quantity = EXCLUDED.unit_price_base_quantity,
				unit_price_base_unit = EXCLUDED.unit_price_base_unit,
				lowest_price_30d = EXCLUDED.lowest_price_30d,
				anchor_price = EXCLUDED.anchor_price,
				anchor_price_as_of = EXCLUDED.anchor_price_as_of,
				price_signature = EXCLUDED.price_signature,
				last_seen_at = NOW(),
				updated_at = NOW()
		`, cuid2.GeneratePrefixedId("sid", cuid2.PrefixedIdOptions{}), storeID, itemID, row.Price, previousPrice,
			row.DiscountPrice, row.DiscountStart, row.DiscountEnd,
			row.UnitPrice, row.UnitPriceBaseQuantity, row.UnitPriceBaseUnit,
			row.LowestPrice30d, row.AnchorPrice, row.AnchorPriceAsOf,
			priceSignature)

		if err != nil {
			fmt.Printf("[WARN] Failed to upsert store item state for item %s: %v\n", itemID, err)
			continue
		}

		// Insert barcodes
		for _, barcode := range row.Barcodes {
			if barcode == "" {
				continue
			}
			barcodeID := cuid2.GeneratePrefixedId("bid", cuid2.PrefixedIdOptions{})
			_, err = tx.Exec(ctx, `
				INSERT INTO retailer_item_barcodes (id, retailer_item_id, barcode, is_primary, created_at)
				VALUES ($1, $2, $3, true, NOW())
				ON CONFLICT DO NOTHING
			`, barcodeID, itemID, barcode)
		}

		persisted++
		if priceChanged {
			priceChanges++
		}
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	fmt.Printf("[INFO] Assigned store %s to price group %s (%d items)\n", storeID, group.ID, len(itemPrices))

	return persisted, priceChanges, itemIDs, nil
}

// findOrCreateRetailerItem finds or creates a retailer item
func findOrCreateRetailerItem(ctx context.Context, chainID string, row types.NormalizedRow, archiveID string) (string, error) {
	pool := database.Pool()

	// Try to find by external ID first
	if row.ExternalID != nil && *row.ExternalID != "" {
		var itemID string
		err := pool.QueryRow(ctx, `
			SELECT id FROM retailer_items
			WHERE chain_slug = $1 AND external_id = $2
			LIMIT 1
		`, chainID, *row.ExternalID).Scan(&itemID)
		if err == nil {
			// Update the item (also update archive_id if provided)
			_, err = pool.Exec(ctx, `
				UPDATE retailer_items
				SET name = $1, description = $2, category = $3, subcategory = $4,
				    brand = $5, unit = $6, unit_quantity = $7, image_url = $8, updated_at = NOW()
				WHERE id = $9
			`, row.Name, row.Description, row.Category, row.Subcategory, row.Brand,
				row.Unit, row.UnitQuantity, row.ImageURL, itemID)
			return itemID, err
		}
	}

	// Create new item
	itemID := cuid2.GeneratePrefixedId("itm", cuid2.PrefixedIdOptions{})
	_, err := pool.Exec(ctx, `
		INSERT INTO retailer_items (
			id, chain_slug, external_id, name, description, category, subcategory,
			brand, unit, unit_quantity, image_url, archive_id, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
		)
		ON CONFLICT (chain_slug, external_id) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			category = EXCLUDED.category,
			subcategory = EXCLUDED.subcategory,
			brand = EXCLUDED.brand,
			unit = EXCLUDED.unit,
			unit_quantity = EXCLUDED.unit_quantity,
			image_url = EXCLUDED.image_url,
			archive_id = EXCLUDED.archive_id,
			updated_at = NOW()
	`, itemID, chainID, row.ExternalID, row.Name, row.Description, row.Category,
		row.Subcategory, row.Brand, row.Unit, row.UnitQuantity, row.ImageURL, archiveID)

	return itemID, err
}

// findOrCreateRetailerItemTx finds or creates a retailer item within a transaction
func findOrCreateRetailerItemTx(ctx context.Context, tx pgx.Tx, chainID string, row types.NormalizedRow, archiveID string) (string, error) {
	// Try to find by external ID first
	if row.ExternalID != nil && *row.ExternalID != "" {
		var itemID string
		err := tx.QueryRow(ctx, `
			SELECT id FROM retailer_items
			WHERE chain_slug = $1 AND external_id = $2
			LIMIT 1
		`, chainID, *row.ExternalID).Scan(&itemID)
		if err == nil {
			// Update the item (also update archive_id if provided)
			_, err = tx.Exec(ctx, `
				UPDATE retailer_items
				SET name = $1, description = $2, category = $3, subcategory = $4,
				    brand = $5, unit = $6, unit_quantity = $7, image_url = $8, updated_at = NOW()
				WHERE id = $9
			`, row.Name, row.Description, row.Category, row.Subcategory, row.Brand,
				row.Unit, row.UnitQuantity, row.ImageURL, itemID)
			return itemID, err
		}
	}

	// Create new item
	itemID := cuid2.GeneratePrefixedId("itm", cuid2.PrefixedIdOptions{})
	_, err := tx.Exec(ctx, `
		INSERT INTO retailer_items (
			id, chain_slug, external_id, name, description, category, subcategory,
			brand, unit, unit_quantity, image_url, archive_id, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
		)
		ON CONFLICT (chain_slug, external_id) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			category = EXCLUDED.category,
			subcategory = EXCLUDED.subcategory,
			brand = EXCLUDED.brand,
			unit = EXCLUDED.unit,
			unit_quantity = EXCLUDED.unit_quantity,
			image_url = EXCLUDED.image_url,
			archive_id = EXCLUDED.archive_id,
			updated_at = NOW()
	`, itemID, chainID, row.ExternalID, row.Name, row.Description, row.Category,
		row.Subcategory, row.Brand, row.Unit, row.UnitQuantity, row.ImageURL, archiveID)

	return itemID, err
}

// saveFailedRow saves a failed row for later analysis and re-processing
func saveFailedRow(ctx context.Context, pool *pgxpool.Pool, chainID string, runID string, fileID string, row types.NormalizedRow, validation types.NormalizedRowValidation) error {
	// Marshal validation errors to JSON
	errorsJSON, _ := json.Marshal(validation.Errors)

	// Generate unique ID using cuid2
	itemID := cuid2.GeneratePrefixedId("failed", cuid2.PrefixedIdOptions{})

	// Insert into retailer_items_failed table using pool.Exec
	_, err := pool.Exec(ctx, `
		INSERT INTO retailer_items_failed (
			id, chain_slug, run_id, file_id, store_identifier, row_number,
			raw_data, validation_errors, failed_at, reprocessable
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), true)
	`, itemID, chainID, runID, fileID, row.StoreIdentifier, row.RowNumber, row.RawData, errorsJSON)

	if err != nil {
		return fmt.Errorf("failed to save failed row %d: %w", row.RowNumber, err)
	}

	fmt.Printf("[INFO] Saved failed row %d to retailer_items_failed\n", row.RowNumber)
	return nil
}

// validateNormalizedRow validates a normalized row
func validateNormalizedRow(row types.NormalizedRow) types.NormalizedRowValidation {
	var errors, warnings []string

	if strings.TrimSpace(row.Name) == "" {
		errors = append(errors, "Missing product name")
	}

	if row.Price <= 0 {
		errors = append(errors, "Price must be positive")
	}

	if row.Price > 100000000 {
		warnings = append(warnings, "Price seems unusually high")
	}

	if row.DiscountPrice != nil && *row.DiscountPrice >= row.Price {
		warnings = append(warnings, "Discount price is not less than regular price")
	}

	return types.NormalizedRowValidation{
		IsValid:  len(errors) == 0,
		Errors:   errors,
		Warnings: warnings,
	}
}

// computePriceSignature computes a signature for price deduplication
func computePriceSignature(row types.NormalizedRow) string {
	sig := fmt.Sprintf("%d:%v:%v:%v:%v:%v:%v:%v:%v:%v",
		row.Price,
		row.DiscountPrice,
		row.DiscountStart,
		row.DiscountEnd,
		row.UnitPrice,
		row.LowestPrice30d,
		row.AnchorPrice,
		row.AnchorPriceAsOf,
		row.UnitPriceBaseQuantity,
		row.UnitPriceBaseUnit,
	)
	return sig
}
