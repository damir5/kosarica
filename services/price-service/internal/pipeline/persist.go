package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/pkg/cuid2"
	"github.com/kosarica/price-service/internal/pricegroups"
	"github.com/kosarica/price-service/internal/types"
	"github.com/rs/zerolog/log"
)

// PersistResult represents the result of persisting parsed data
type PersistResult struct {
	Persisted    int
	PriceChanges int
}

// PersistPhase executes the persist phase of the ingestion pipeline
// It persists normalized rows to the database and links them to the archive
func PersistPhase(ctx context.Context, chainID string, parseResult *ParseResult, file types.DiscoveredFile, runID string, archiveID string) (*PersistResult, error) {
	log.Info().
		Str("filename", file.Filename).
		Int("valid_rows", parseResult.ValidRows).
		Msg("Persist phase start")

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
			log.Warn().Err(err).Str("store_identifier", storeIdentifier).Msg("Failed to resolve store")
			continue
		}

		// Persist rows for this store
		persisted, priceChanges, itemIDs, err := persistRowsForStore(ctx, chainID, storeID, storeIdentifier, rows, archiveID, runID, parseResult.FileID)
		if err != nil {
			log.Error().Err(err).Str("store_identifier", storeIdentifier).Msg("Failed to persist rows for store")
			continue
		}

		totalPersisted += persisted
		totalPriceChanges += priceChanges
		allItemIDs = append(allItemIDs, itemIDs...)
	}

	// Link retailer items to archive
	if archiveID != "" && len(allItemIDs) > 0 {
		if err := database.UpdateRetailerItemArchiveID(ctx, allItemIDs, archiveID); err != nil {
			log.Warn().Err(err).Str("archive_id", archiveID).Int("item_count", len(allItemIDs)).Msg("Failed to link items to archive")
		} else {
			log.Info().Str("archive_id", archiveID).Int("item_count", len(allItemIDs)).Msg("Linked items to archive")
		}
	}

	log.Info().Str("filename", file.Filename).Int("persisted", totalPersisted).Int("price_changes", totalPriceChanges).Msg("Persisted rows")

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
	queries := sqlcgen.New(database.Pool())

	storeID, err := queries.GetStoreByIdentifier(ctx, sqlcgen.GetStoreByIdentifierParams{
		ChainSlug: chainID,
		Value:     storeIdentifier,
	})

	if err == pgx.ErrNoRows {
		return "", nil
	}
	return storeID, err
}

// createStore creates a new store with auto-registration
func createStore(ctx context.Context, chainID string, storeIdentifier string, metadata *types.StoreMetadata) (string, error) {
	queries := sqlcgen.New(database.Pool())

	// Generate store ID
	storeID := cuid2.GeneratePrefixedId("sid", cuid2.PrefixedIdOptions{})

	// Determine store name and details
	name := fmt.Sprintf("%s Store %s", chainID, storeIdentifier)
	var address, city, postalCode pgtype.Text

	if metadata != nil {
		if metadata.Name != "" {
			name = metadata.Name
		}
		if metadata.Address != "" {
			address = pgtype.Text{String: metadata.Address, Valid: true}
		}
		if metadata.City != "" {
			city = pgtype.Text{String: metadata.City, Valid: true}
		}
		if metadata.PostalCode != "" {
			postalCode = pgtype.Text{String: metadata.PostalCode, Valid: true}
		}
	}

	// Insert store
	err := queries.CreateStore(ctx, sqlcgen.CreateStoreParams{
		ID:         storeID,
		ChainSlug:  chainID,
		Name:       name,
		Address:    address,
		City:       city,
		PostalCode: postalCode,
	})
	if err != nil {
		return "", fmt.Errorf("failed to insert store: %w", err)
	}

	// Insert store identifier
	identifierID := cuid2.GeneratePrefixedId("sid", cuid2.PrefixedIdOptions{})
	err = queries.CreateStoreIdentifier(ctx, sqlcgen.CreateStoreIdentifierParams{
		ID:      identifierID,
		StoreID: storeID,
		Value:   storeIdentifier,
	})
	if err != nil {
		return "", fmt.Errorf("failed to insert store identifier: %w", err)
	}

	log.Info().Str("store_name", name).Str("store_id", storeID).Msg("Auto-registered store")
	return storeID, nil
}

// persistRowsForStore persists normalized rows for a specific store using price groups
func persistRowsForStore(ctx context.Context, chainID string, storeID string, storeIdentifier string, rows []types.NormalizedRow, archiveID string, runID string, fileID string) (int, int, []string, error) {
	log.Info().
		Str("store_identifier", storeIdentifier).
		Int("rows", len(rows)).
		Msg("Persisting store rows")

	// Step 1: Collect all validated items with prices
	itemPrices := make([]pricegroups.ItemPrice, 0, len(rows))
	itemData := make(map[string]types.NormalizedRow) // Map itemID -> row data
	persisted := 0
	priceChanges := 0
	failedRows := 0
	warningRows := 0
	itemIDs := make([]string, 0, len(rows))

	conn, err := database.Pool().Acquire(ctx)
	if err != nil {
		return 0, 0, nil, fmt.Errorf("failed to acquire database connection: %w", err)
	}
	defer conn.Release()
	queries := sqlcgen.New(conn)

	// First pass: validate and find/create retailer items, build price hash input
	for i, row := range rows {
		if i > 0 && i%1000 == 0 {
			log.Info().
				Str("store_identifier", storeIdentifier).
				Int("processed_rows", i).
				Int("total_rows", len(rows)).
				Msg("Persist progress")
		}

		// Validate row
		validation := validateNormalizedRow(row)
		if !validation.IsValid {
			failedRows++
			fmt.Printf("[DEBUG] VALIDATION FAILED - Row %d\n", row.RowNumber)
			fmt.Printf("  Name: %q\n", row.Name)
			fmt.Printf("  Price: %d\n", row.Price)
			fmt.Printf("  Store: %s, Chain: %s\n", row.StoreIdentifier, chainID)
			fmt.Printf("  Errors: %v\n", validation.Errors)
			fmt.Printf("  Raw Data: %s\n", row.RawData)

			// Save failed row for later analysis and re-processing
			if err := saveFailedRowWithQueries(ctx, queries, chainID, runID, fileID, row, validation); err != nil {
				log.Error().Err(err).Int("row_number", row.RowNumber).Msg("Failed to save failed row")
			}

			continue
		}
		if len(validation.Warnings) > 0 {
			warningRows++
		}

		// Find or create retailer item
		retailerItemID, err := findOrCreateRetailerItemWithQueries(ctx, queries, chainID, row, archiveID)
		if err != nil {
			log.Warn().Err(err).Int("row_number", row.RowNumber).Msg("Failed to find/create retailer item")
			failedRows++
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
		recordIngestionStoreStats(ctx, IngestionStoreStatsParams{
			RunID:           runID,
			FileID:          fileID,
			StoreID:         storeID,
			StoreIdentifier: storeIdentifier,
			RowCount:        len(rows),
			PersistedCount:  0,
			PriceChanges:    0,
			FailedRows:      failedRows,
			WarningRows:     warningRows,
		})
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
		log.Warn().Str("price_group_id", group.ID).Msg("Detected zombie price group (0 items). Attempting repair")
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
		log.Info().Str("price_group_id", group.ID).Int("item_count", len(groupPrices)).Msg("Created new price group")
	} else {
		// Existing group: update last_seen_at
		if err := database.UpdateGroupLastSeen(ctx, group.ID); err != nil {
			log.Warn().Err(err).Str("price_group_id", group.ID).Msg("Failed to update group last_seen")
		}
	}

	// Step 5: Assign store to group (closes previous membership)
	if err := database.AssignStoreToGroup(ctx, storeID, group.ID); err != nil {
		return 0, 0, nil, fmt.Errorf("failed to assign store to group: %w", err)
	}

	// Step 6: Update store_item_state for price change tracking
	// Use a single acquired connection to avoid pool contention in tight loops.

	for _, itemID := range itemIDs {
		row := itemData[itemID]

		previousPrice, err := queries.GetStorePreviousPrice(ctx, sqlcgen.GetStorePreviousPriceParams{
			StoreID:        storeID,
			RetailerItemID: itemID,
		})
		if err != nil && err != pgx.ErrNoRows {
			log.Warn().Err(err).Str("retailer_item_id", itemID).Msg("Failed to fetch previous price")
		}
		if err == nil && previousPrice.Valid && priceChangeRequiresReview(previousPrice.Int32, int32(row.Price)) {
			validation := types.NormalizedRowValidation{
				IsValid: false,
				Errors: []string{
					fmt.Sprintf("Price change exceeds %d%% threshold", priceChangeReviewThresholdPercent),
				},
			}
			if err := saveFailedRowWithQueries(ctx, queries, chainID, runID, fileID, row, validation); err != nil {
				log.Error().Err(err).Int("row_number", row.RowNumber).Msg("Failed to save review-required row")
			}
			failedRows++
			continue
		}

		// Upsert store item state (for tracking price history)
		priceSignature := computePriceSignature(row)

		// Build params for UpsertStoreItemState
		upsertParams := sqlcgen.UpsertStoreItemStateParams{
			StoreID:        storeID,
			RetailerItemID: itemID,
			CurrentPrice:   pgtype.Int4{Int32: int32(row.Price), Valid: true},
			PreviousPrice:  pgtype.Int4{Valid: false},
			PriceSignature: pgtype.Text{String: priceSignature, Valid: true},
		}

		// Set optional fields
		if row.DiscountPrice != nil {
			upsertParams.DiscountPrice = pgtype.Int4{Int32: int32(*row.DiscountPrice), Valid: true}
		}
		if row.DiscountStart != nil {
			upsertParams.DiscountStart = pgtype.Timestamp{Time: *row.DiscountStart, Valid: true}
		}
		if row.DiscountEnd != nil {
			upsertParams.DiscountEnd = pgtype.Timestamp{Time: *row.DiscountEnd, Valid: true}
		}
		if row.UnitPrice != nil {
			upsertParams.UnitPrice = pgtype.Int4{Int32: int32(*row.UnitPrice), Valid: true}
		}
		if row.UnitPriceBaseQuantity != nil {
			upsertParams.UnitPriceBaseQuantity = pgtype.Text{String: *row.UnitPriceBaseQuantity, Valid: true}
		}
		if row.UnitPriceBaseUnit != nil {
			upsertParams.UnitPriceBaseUnit = pgtype.Text{String: *row.UnitPriceBaseUnit, Valid: true}
		}
		if row.LowestPrice30d != nil {
			upsertParams.LowestPrice30d = pgtype.Int4{Int32: int32(*row.LowestPrice30d), Valid: true}
		}
		if row.AnchorPrice != nil {
			upsertParams.AnchorPrice = pgtype.Int4{Int32: int32(*row.AnchorPrice), Valid: true}
		}
		if row.AnchorPriceAsOf != nil {
			upsertParams.AnchorPriceAsOf = pgtype.Timestamp{Time: *row.AnchorPriceAsOf, Valid: true}
		}

		upsertResult, err := queries.UpsertStoreItemState(ctx, upsertParams)
		if err != nil {
			log.Warn().Err(err).Str("retailer_item_id", itemID).Msg("Failed to upsert store item state for item")
			failedRows++
			continue
		}

		priceChanged := upsertResult.PreviousPrice.Valid &&
			upsertResult.CurrentPrice.Valid &&
			upsertResult.PreviousPrice.Int32 != upsertResult.CurrentPrice.Int32

		// Note: Barcodes are now inserted in findOrCreateRetailerItem (Phase 3 fix)
		// No duplicate barcode insertion loop needed here

		persisted++
		if priceChanged {
			priceChanges++
		}
	}

	log.Info().Str("store_id", storeID).Str("price_group_id", group.ID).Int("item_count", len(itemPrices)).Msg("Assigned store to price group")

	recordIngestionStoreStats(ctx, IngestionStoreStatsParams{
		RunID:           runID,
		FileID:          fileID,
		StoreID:         storeID,
		StoreIdentifier: storeIdentifier,
		RowCount:        len(rows),
		PersistedCount:  persisted,
		PriceChanges:    priceChanges,
		FailedRows:      failedRows,
		WarningRows:     warningRows,
	})

	return persisted, priceChanges, itemIDs, nil
}

// findOrCreateRetailerItem finds or creates a retailer item and inserts the first barcode
func findOrCreateRetailerItem(ctx context.Context, chainID string, row types.NormalizedRow, archiveID string) (string, error) {
	return findOrCreateRetailerItemWithQueries(ctx, sqlcgen.New(database.Pool()), chainID, row, archiveID)
}

func findOrCreateRetailerItemWithQueries(ctx context.Context, queries *sqlcgen.Queries, chainID string, row types.NormalizedRow, archiveID string) (string, error) {

	// Build parameters for upsert
	var externalID, chainSlug, description, category, subcategory, brand, unit, unitQuantity, imageURL, archiveIDVal pgtype.Text

	chainSlug = pgtype.Text{String: chainID, Valid: true}

	if row.ExternalID != nil && *row.ExternalID != "" {
		externalID = pgtype.Text{String: *row.ExternalID, Valid: true}
	}
	if row.Description != nil && *row.Description != "" {
		description = pgtype.Text{String: *row.Description, Valid: true}
	}
	if row.Category != nil && *row.Category != "" {
		category = pgtype.Text{String: *row.Category, Valid: true}
	}
	if row.Subcategory != nil && *row.Subcategory != "" {
		subcategory = pgtype.Text{String: *row.Subcategory, Valid: true}
	}
	if row.Brand != nil && *row.Brand != "" {
		brand = pgtype.Text{String: *row.Brand, Valid: true}
	}
	if row.Unit != nil && *row.Unit != "" {
		unit = pgtype.Text{String: *row.Unit, Valid: true}
	}
	if row.UnitQuantity != nil && *row.UnitQuantity != "" {
		unitQuantity = pgtype.Text{String: *row.UnitQuantity, Valid: true}
	}
	if row.ImageURL != nil && *row.ImageURL != "" {
		imageURL = pgtype.Text{String: *row.ImageURL, Valid: true}
	}
	if archiveID != "" {
		archiveIDVal = pgtype.Text{String: archiveID, Valid: true}
	}

	// Generate new item ID (may be replaced by existing on conflict)
	newItemID := cuid2.GeneratePrefixedId("itm", cuid2.PrefixedIdOptions{})

	// Upsert the retailer item and get the actual ID (new or existing)
	upsertStart := time.Now()
	itemID, err := queries.UpsertRetailerItem(ctx, sqlcgen.UpsertRetailerItemParams{
		ID:           newItemID,
		ChainSlug:    chainSlug,
		ExternalID:   externalID,
		Name:         row.Name,
		Description:  description,
		Category:     category,
		Subcategory:  subcategory,
		Brand:        brand,
		Unit:         unit,
		UnitQuantity: unitQuantity,
		ImageUrl:     imageURL,
		ArchiveID:    archiveIDVal,
	})
	if time.Since(upsertStart) > 2*time.Second {
		log.Warn().
			Dur("duration", time.Since(upsertStart)).
			Str("external_id", externalID.String).
			Str("item_name", row.Name).
			Msg("UpsertRetailerItem slow")
	}
	if err != nil {
		return "", fmt.Errorf("failed to upsert retailer item: %w", err)
	}

	// Insert first barcode if available (Phase 3 fix: ensure barcodes are saved)
	if len(row.Barcodes) > 0 && row.Barcodes[0] != "" {
		barcodeID := cuid2.GeneratePrefixedId("rib", cuid2.PrefixedIdOptions{})
		err = queries.InsertRetailerItemBarcode(ctx, sqlcgen.InsertRetailerItemBarcodeParams{
			ID:             barcodeID,
			RetailerItemID: itemID,
			Barcode:        row.Barcodes[0],
			IsPrimary:      pgtype.Bool{Bool: true, Valid: true},
		})
		if err != nil {
			// Log but don't fail - barcode might already exist due to ON CONFLICT DO NOTHING
			log.Debug().Err(err).Str("barcode", row.Barcodes[0]).Str("item_id", itemID).Msg("Failed to insert barcode (may already exist)")
		}
	}

	return itemID, nil
}

// saveFailedRow saves a failed row for later analysis and re-processing
func saveFailedRow(ctx context.Context, chainID string, runID string, fileID string, row types.NormalizedRow, validation types.NormalizedRowValidation) error {
	return saveFailedRowWithQueries(ctx, sqlcgen.New(database.Pool()), chainID, runID, fileID, row, validation)
}

func saveFailedRowWithQueries(ctx context.Context, queries *sqlcgen.Queries, chainID string, runID string, fileID string, row types.NormalizedRow, validation types.NormalizedRowValidation) error {

	// Marshal validation errors to JSON
	errorsJSON, _ := json.Marshal(validation.Errors)

	// Generate unique ID using cuid2
	itemID := cuid2.GeneratePrefixedId("failed", cuid2.PrefixedIdOptions{})

	// Build params for CreateFailedRow
	var fileIDInt pgtype.Int8
	// fileID is a string but the column expects int8, we need to handle this
	// For now, we skip setting it if we can't parse it
	// The fileID is typically a numeric string from ingestion_files table

	err := queries.CreateFailedRow(ctx, sqlcgen.CreateFailedRowParams{
		ID:               itemID,
		ChainSlug:        chainID,
		RunID:            pgtype.Text{String: runID, Valid: runID != ""},
		FileID:           fileIDInt, // Left as zero value if not parseable
		StoreIdentifier:  pgtype.Text{String: row.StoreIdentifier, Valid: row.StoreIdentifier != ""},
		RowNumber:        pgtype.Int4{Int32: int32(row.RowNumber), Valid: true},
		RawData:          row.RawData,
		ValidationErrors: errorsJSON,
	})

	if err != nil {
		return fmt.Errorf("failed to save failed row %d: %w", row.RowNumber, err)
	}

	log.Info().Int("row_number", row.RowNumber).Msg("Saved failed row to retailer_items_failed")
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

const priceChangeReviewThresholdPercent = 50

func priceChangeRequiresReview(previousPrice int32, currentPrice int32) bool {
	if previousPrice <= 0 {
		return false
	}
	diff := previousPrice - currentPrice
	if diff < 0 {
		diff = -diff
	}
	return int64(diff)*100 > int64(previousPrice)*priceChangeReviewThresholdPercent
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
