package pipeline

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/types"
)

// PersistResult represents the result of persisting parsed data
type PersistResult struct {
	Persisted     int
	PriceChanges  int
}

// PersistPhase executes the persist phase of the ingestion pipeline
// It persists normalized rows to the database
func PersistPhase(ctx context.Context, chainID string, parseResult *ParseResult, file types.DiscoveredFile, runID string) (*PersistResult, error) {
	// Get adapter from registry
	adapter, err := registry.GetAdapter(config.ChainID(chainID))
	if err != nil {
		return nil, fmt.Errorf("failed to get adapter for %s: %w", chainID, err)
	}

	// Extract store metadata for auto-registration
	storeMetadata := adapter.ExtractStoreMetadata(file)

	totalPersisted := 0
	totalPriceChanges := 0

	for storeIdentifier, rows := range parseResult.RowsByStore {
		// Resolve or register store
		storeID, err := resolveOrCreateStore(ctx, chainID, storeIdentifier, storeMetadata)
		if err != nil {
			fmt.Printf("[WARN] Failed to resolve store %s: %v\n", storeIdentifier, err)
			continue
		}

		// Persist rows for this store
		persisted, priceChanges, err := persistRowsForStore(ctx, chainID, storeID, storeIdentifier, rows)
		if err != nil {
			fmt.Printf("[ERROR] Failed to persist rows for store %s: %v\n", storeIdentifier, err)
			continue
		}

		totalPersisted += persisted
		totalPriceChanges += priceChanges
	}

	fmt.Printf("[INFO] Persisted %d rows (%d price changes) for %s\n", totalPersisted, totalPriceChanges, file.Filename)

	// Mark file as completed
	if err := markFileCompleted(ctx, parseResult.FileID, 1); err != nil {
		fmt.Printf("[WARN] Failed to mark file as completed: %v\n", err)
	}

	// Update run progress
	if err := incrementProcessedFiles(ctx, runID); err != nil {
		fmt.Printf("[WARN] Failed to increment processed files: %v\n", err)
	}
	if err := incrementProcessedEntries(ctx, runID, totalPersisted); err != nil {
		fmt.Printf("[WARN] Failed to increment processed entries: %v\n", err)
	}

	// Check if run is complete
	if _, err := checkAndUpdateRunCompletion(ctx, runID); err != nil {
		fmt.Printf("[WARN] Failed to check run completion: %v\n", err)
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
	storeID := uuid.New().String()

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
	identifierID := uuid.New().String()
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

// persistRowsForStore persists normalized rows for a specific store
func persistRowsForStore(ctx context.Context, chainID string, storeID string, storeIdentifier string, rows []types.NormalizedRow) (int, int, error) {
	pool := database.Pool()

	persisted := 0
	priceChanges := 0

	for _, row := range rows {
		// Validate row
		validation := validateNormalizedRow(row)
		if !validation.IsValid {
			fmt.Printf("[WARN] Skipping invalid row %d: %v\n", row.RowNumber, validation.Errors)
			continue
		}

		// Find or create retailer item
		retailerItemID, err := findOrCreateRetailerItem(ctx, chainID, row)
		if err != nil {
			fmt.Printf("[WARN] Failed to find/create retailer item for row %d: %v\n", row.RowNumber, err)
			continue
		}

		// Check for price change
		priceChanged := false
		var previousPrice *int

		if err := pool.QueryRow(ctx, `
			SELECT current_price
			FROM store_item_state
			WHERE store_id = $1 AND retailer_item_id = $2
		`, storeID, retailerItemID).Scan(&previousPrice); err == nil && previousPrice != nil {
			if *previousPrice != row.Price {
				priceChanged = true
			}
		}

		// Upsert store item state
		priceSignature := computePriceSignature(row)

		_, err = pool.Exec(ctx, `
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
		`, uuid.New().String(), storeID, retailerItemID, row.Price, previousPrice,
			row.DiscountPrice, row.DiscountStart, row.DiscountEnd,
			row.UnitPrice, row.UnitPriceBaseQuantity, row.UnitPriceBaseUnit,
			row.LowestPrice30d, row.AnchorPrice, row.AnchorPriceAsOf,
			priceSignature)

		if err != nil {
			fmt.Printf("[WARN] Failed to upsert store item state for row %d: %v\n", row.RowNumber, err)
			continue
		}

		// Insert barcodes
		for _, barcode := range row.Barcodes {
			if barcode == "" {
				continue
			}
			barcodeID := uuid.New().String()
			_, err = pool.Exec(ctx, `
				INSERT INTO retailer_item_barcodes (id, retailer_item_id, barcode, is_primary, created_at)
				VALUES ($1, $2, $3, true, NOW())
				ON CONFLICT DO NOTHING
			`, barcodeID, retailerItemID, barcode)
		}

		persisted++
		if priceChanged {
			priceChanges++
		}
	}

	return persisted, priceChanges, nil
}

// findOrCreateRetailerItem finds or creates a retailer item
func findOrCreateRetailerItem(ctx context.Context, chainID string, row types.NormalizedRow) (string, error) {
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
			// Update the item
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
	itemID := uuid.New().String()
	_, err := pool.Exec(ctx, `
		INSERT INTO retailer_items (
			id, chain_slug, external_id, name, description, category, subcategory,
			brand, unit, unit_quantity, image_url, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
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
			updated_at = NOW()
	`, itemID, chainID, row.ExternalID, row.Name, row.Description, row.Category,
		row.Subcategory, row.Brand, row.Unit, row.UnitQuantity, row.ImageURL)

	return itemID, err
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
