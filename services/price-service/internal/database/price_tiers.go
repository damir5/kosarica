package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/pkg/cuid2"
	"github.com/rs/zerolog/log"
)

// PriceTier represents an item-level price tier scoped by date
// Multiple stores can share the same tier for a given date+item+price combination
type PriceTier struct {
	ID             string    `json:"id"`
	ChainSlug      string    `json:"chain_slug"`
	RetailerItemID string    `json:"retailer_item_id"`
	Price          int       `json:"price"`
	DiscountPrice  *int      `json:"discount_price"`
	UnitPrice      *int      `json:"unit_price"`
	AnchorPrice    *int      `json:"anchor_price"`
	TargetDate     time.Time `json:"target_date"`
	FirstSeenAt    time.Time `json:"first_seen_at"`
	LastSeenAt     time.Time `json:"last_seen_at"`
	StoreCount     int       `json:"store_count"`
	CreatedAt      time.Time `json:"created_at"`
}

// StorePriceRef represents a store's reference to a price tier for an item scoped by date
type StorePriceRef struct {
	StoreID        string    `json:"store_id"`
	RetailerItemID string    `json:"retailer_item_id"`
	PriceTierID    string    `json:"price_tier_id"`
	InStock        bool      `json:"in_stock"`
	TargetDate     time.Time `json:"target_date"`
	LastSeenAt     time.Time `json:"last_seen_at"`
}

// StorePriceViaTier represents a price lookup result via tier join
type StorePriceViaTier struct {
	RetailerItemID string    `json:"retailer_item_id"`
	PriceTierID    string    `json:"price_tier_id"`
	Price          int       `json:"price"`
	DiscountPrice  *int      `json:"discount_price"`
	UnitPrice      *int      `json:"unit_price"`
	AnchorPrice    *int      `json:"anchor_price"`
	InStock        bool      `json:"in_stock"`
	TargetDate     time.Time `json:"target_date"`
}

// FindOrCreatePriceTier finds an existing price tier or creates a new one.
// Uses INSERT ON CONFLICT DO NOTHING pattern for race condition safety.
// Returns the price tier, whether it was newly created, and any error.
func FindOrCreatePriceTier(ctx context.Context, targetDate time.Time, chainSlug, retailerItemID string, price int, discountPrice, unitPrice, anchorPrice *int) (*PriceTier, bool, error) {
	queries := sqlcgen.New(Pool())

	// Convert target date to pgtype.Date
	pgTargetDate := pgtype.Date{Time: targetDate, Valid: true}

	// Convert discount price for query (-1 means NULL in the unique constraint)
	discountForQuery := int32(-1)
	if discountPrice != nil {
		discountForQuery = int32(*discountPrice)
	}

	// First, try to find existing tier
	existingTier, err := queries.FindPriceTier(ctx, sqlcgen.FindPriceTierParams{
		TargetDate:     pgTargetDate,
		ChainSlug:      chainSlug,
		RetailerItemID: retailerItemID,
		Price:          int32(price),
		Column5:        discountForQuery,
	})

	if err == nil {
		// Found existing tier
		return convertFindPriceTierRow(existingTier), false, nil
	}

	if err != pgx.ErrNoRows {
		// Unexpected error
		return nil, false, fmt.Errorf("error querying price tier: %w", err)
	}

	// Not found, create new tier
	newTierID := cuid2.GeneratePrefixedId("pt", cuid2.PrefixedIdOptions{})

	createdTier, err := queries.CreatePriceTier(ctx, sqlcgen.CreatePriceTierParams{
		ID:             newTierID,
		ChainSlug:      chainSlug,
		RetailerItemID: retailerItemID,
		Price:          int32(price),
		DiscountPrice:  intPtrToPgInt4(discountPrice),
		UnitPrice:      intPtrToPgInt4(unitPrice),
		AnchorPrice:    intPtrToPgInt4(anchorPrice),
		TargetDate:     pgTargetDate,
	})

	if err != nil {
		// Check if another goroutine created it first (race condition)
		if err == pgx.ErrNoRows {
			// Query again to get the tier created by another goroutine
			existingTier, err = queries.FindPriceTier(ctx, sqlcgen.FindPriceTierParams{
				TargetDate:     pgTargetDate,
				ChainSlug:      chainSlug,
				RetailerItemID: retailerItemID,
				Price:          int32(price),
				Column5:        discountForQuery,
			})
			if err == nil {
				return convertFindPriceTierRow(existingTier), false, nil
			}
			return nil, false, fmt.Errorf("failed to find price tier after race: %w", err)
		}
		return nil, false, fmt.Errorf("failed to insert price tier: %w", err)
	}

	return convertCreatePriceTierRow(createdTier), true, nil
}

// BulkUpsertStorePriceRefs inserts or updates multiple store->tier references in a single transaction.
func BulkUpsertStorePriceRefs(ctx context.Context, refs []StorePriceRef) error {
	if len(refs) == 0 {
		return nil
	}

	pool := Pool()

	// Begin transaction for bulk insert
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	// Track commit state to prevent rollback after commit
	txCommitted := false

	// Defer rollback with SEPARATE context
	defer func() {
		if txCommitted {
			return
		}

		rollbackCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := tx.Rollback(rollbackCtx); err != nil {
			log.Error().Err(err).Msg("Failed to rollback transaction (connection may be closed)")
		}
	}()

	log.Debug().Str("operation", "BulkUpsertStorePriceRefs").Int("count", len(refs)).Msg("Transaction began")

	txQueries := sqlcgen.New(tx)

	for i, ref := range refs {
		err := txQueries.UpsertStorePriceRef(ctx, sqlcgen.UpsertStorePriceRefParams{
			StoreID:        ref.StoreID,
			RetailerItemID: ref.RetailerItemID,
			PriceTierID:    ref.PriceTierID,
			InStock:        pgtype.Bool{Bool: ref.InStock, Valid: true},
			TargetDate:     pgtype.Date{Time: ref.TargetDate, Valid: true},
		})
		if err != nil {
			return fmt.Errorf("failed to upsert store price ref %d: %w", i, err)
		}
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}
	txCommitted = true

	log.Debug().Str("operation", "BulkUpsertStorePriceRefs").Int("count", len(refs)).Msg("Transaction committed")

	return nil
}

// GetStorePricesViaTiers retrieves all prices for a store via tier join at a specific date.
func GetStorePricesViaTiers(ctx context.Context, targetDate time.Time, storeID string) ([]StorePriceViaTier, error) {
	queries := sqlcgen.New(Pool())

	rows, err := queries.ListStorePricesViaTiers(ctx, sqlcgen.ListStorePricesViaTiersParams{
		TargetDate: pgtype.Date{Time: targetDate, Valid: true},
		StoreID:    storeID,
	})
	if err != nil {
		return nil, fmt.Errorf("error querying store prices via tiers: %w", err)
	}

	results := make([]StorePriceViaTier, len(rows))
	for i, row := range rows {
		results[i] = StorePriceViaTier{
			RetailerItemID: row.RetailerItemID,
			PriceTierID:    row.PriceTierID,
			Price:          int(row.Price),
			DiscountPrice:  pgInt4ToIntPtr(row.DiscountPrice),
			UnitPrice:      pgInt4ToIntPtr(row.UnitPrice),
			AnchorPrice:    pgInt4ToIntPtr(row.AnchorPrice),
			InStock:        row.InStock.Valid && row.InStock.Bool,
			TargetDate:     row.TargetDate.Time,
		}
	}

	return results, nil
}

// GetStorePriceViaTier retrieves the price for a specific store+item via tier join at a specific date.
func GetStorePriceViaTier(ctx context.Context, targetDate time.Time, storeID, retailerItemID string) (*StorePriceViaTier, error) {
	queries := sqlcgen.New(Pool())

	row, err := queries.GetStorePriceViaTier(ctx, sqlcgen.GetStorePriceViaTierParams{
		TargetDate:     pgtype.Date{Time: targetDate, Valid: true},
		StoreID:        storeID,
		RetailerItemID: retailerItemID,
	})

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("error querying store price via tier: %w", err)
	}

	return &StorePriceViaTier{
		RetailerItemID: retailerItemID,
		Price:          int(row.Price),
		DiscountPrice:  pgInt4ToIntPtr(row.DiscountPrice),
		UnitPrice:      pgInt4ToIntPtr(row.UnitPrice),
		AnchorPrice:    pgInt4ToIntPtr(row.AnchorPrice),
		TargetDate:     row.TargetDate.Time,
	}, nil
}

// ListPriceTiersForCache retrieves all price tiers for a chain at a specific date (for cache loading).
func ListPriceTiersForCache(ctx context.Context, chainSlug string, targetDate time.Time) (map[string]*PriceTier, error) {
	queries := sqlcgen.New(Pool())

	rows, err := queries.ListPriceTiersForCache(ctx, sqlcgen.ListPriceTiersForCacheParams{
		ChainSlug:  chainSlug,
		TargetDate: pgtype.Date{Time: targetDate, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("error querying price tiers for cache: %w", err)
	}

	tiers := make(map[string]*PriceTier, len(rows))
	for _, row := range rows {
		tiers[row.ID] = &PriceTier{
			ID:             row.ID,
			ChainSlug:      row.ChainSlug,
			RetailerItemID: row.RetailerItemID,
			Price:          int(row.Price),
			DiscountPrice:  pgInt4ToIntPtr(row.DiscountPrice),
			UnitPrice:      pgInt4ToIntPtr(row.UnitPrice),
			AnchorPrice:    pgInt4ToIntPtr(row.AnchorPrice),
			TargetDate:     row.TargetDate.Time,
		}
	}

	return tiers, nil
}

// ListStoreRefsByChain retrieves all store->tier references for a chain at a specific date (for cache loading).
func ListStoreRefsByChain(ctx context.Context, chainSlug string, targetDate time.Time) ([]StorePriceRef, error) {
	queries := sqlcgen.New(Pool())

	rows, err := queries.ListStoreRefsByChain(ctx, sqlcgen.ListStoreRefsByChainParams{
		ChainSlug:  chainSlug,
		TargetDate: pgtype.Date{Time: targetDate, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("error querying store refs by chain: %w", err)
	}

	refs := make([]StorePriceRef, len(rows))
	for i, row := range rows {
		refs[i] = StorePriceRef{
			StoreID:        row.StoreID,
			RetailerItemID: row.RetailerItemID,
			PriceTierID:    row.PriceTierID,
			InStock:        row.InStock.Valid && row.InStock.Bool,
			TargetDate:     row.TargetDate.Time,
		}
	}

	return refs, nil
}

// UpdatePriceTierLastSeen updates the last_seen_at timestamp for a price tier.
func UpdatePriceTierLastSeen(ctx context.Context, tierID string) error {
	queries := sqlcgen.New(Pool())
	return queries.UpdatePriceTierLastSeen(ctx, tierID)
}

// IncrementPriceTierStoreCount increments the store_count for a price tier.
func IncrementPriceTierStoreCount(ctx context.Context, tierID string) error {
	queries := sqlcgen.New(Pool())
	return queries.IncrementPriceTierStoreCount(ctx, tierID)
}

// DecrementPriceTierStoreCount decrements the store_count for a price tier.
func DecrementPriceTierStoreCount(ctx context.Context, tierID string) error {
	queries := sqlcgen.New(Pool())
	return queries.DecrementPriceTierStoreCount(ctx, tierID)
}

// GetPriceTierByID retrieves a price tier by its ID.
func GetPriceTierByID(ctx context.Context, tierID string) (*PriceTier, error) {
	queries := sqlcgen.New(Pool())

	tier, err := queries.GetPriceTierById(ctx, tierID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("error querying price tier: %w", err)
	}

	return convertGetPriceTierByIdRow(tier), nil
}

// convertFindPriceTierRow converts a sqlcgen.FindPriceTierRow to a database.PriceTier
func convertFindPriceTierRow(pt sqlcgen.FindPriceTierRow) *PriceTier {
	return &PriceTier{
		ID:             pt.ID,
		ChainSlug:      pt.ChainSlug,
		RetailerItemID: pt.RetailerItemID,
		Price:          int(pt.Price),
		DiscountPrice:  pgInt4ToIntPtr(pt.DiscountPrice),
		UnitPrice:      pgInt4ToIntPtr(pt.UnitPrice),
		AnchorPrice:    pgInt4ToIntPtr(pt.AnchorPrice),
		TargetDate:     pt.TargetDate.Time,
		FirstSeenAt:    pt.FirstSeenAt.Time,
		LastSeenAt:     pt.LastSeenAt.Time,
		StoreCount:     int(pt.StoreCount),
		CreatedAt:      pt.CreatedAt.Time,
	}
}

// convertCreatePriceTierRow converts a sqlcgen.CreatePriceTierRow to a database.PriceTier
func convertCreatePriceTierRow(pt sqlcgen.CreatePriceTierRow) *PriceTier {
	return &PriceTier{
		ID:             pt.ID,
		ChainSlug:      pt.ChainSlug,
		RetailerItemID: pt.RetailerItemID,
		Price:          int(pt.Price),
		DiscountPrice:  pgInt4ToIntPtr(pt.DiscountPrice),
		UnitPrice:      pgInt4ToIntPtr(pt.UnitPrice),
		AnchorPrice:    pgInt4ToIntPtr(pt.AnchorPrice),
		TargetDate:     pt.TargetDate.Time,
		FirstSeenAt:    pt.FirstSeenAt.Time,
		LastSeenAt:     pt.LastSeenAt.Time,
		StoreCount:     int(pt.StoreCount),
		CreatedAt:      pt.CreatedAt.Time,
	}
}

// convertGetPriceTierByIdRow converts a sqlcgen.GetPriceTierByIdRow to a database.PriceTier
func convertGetPriceTierByIdRow(pt sqlcgen.GetPriceTierByIdRow) *PriceTier {
	return &PriceTier{
		ID:             pt.ID,
		ChainSlug:      pt.ChainSlug,
		RetailerItemID: pt.RetailerItemID,
		Price:          int(pt.Price),
		DiscountPrice:  pgInt4ToIntPtr(pt.DiscountPrice),
		UnitPrice:      pgInt4ToIntPtr(pt.UnitPrice),
		AnchorPrice:    pgInt4ToIntPtr(pt.AnchorPrice),
		TargetDate:     pt.TargetDate.Time,
		FirstSeenAt:    pt.FirstSeenAt.Time,
		LastSeenAt:     pt.LastSeenAt.Time,
		StoreCount:     int(pt.StoreCount),
		CreatedAt:      pt.CreatedAt.Time,
	}
}

// ============================================================================
// Date-Scoped Operations for Ingestion
// ============================================================================

// GetMaxTargetDateForChain returns the latest target_date for a chain.
// Returns nil if no data exists for the chain.
func GetMaxTargetDateForChain(ctx context.Context, chainSlug string) (*time.Time, error) {
	queries := sqlcgen.New(Pool())

	result, err := queries.GetMaxTargetDateForChain(ctx, chainSlug)
	if err != nil {
		return nil, fmt.Errorf("error querying max target date: %w", err)
	}

	if !result.Valid {
		return nil, nil
	}

	return &result.Time, nil
}

// DeleteStorePriceRefsByChainAndDate deletes all store_price_refs for a chain at a specific date.
// Used for same-day overwrite during ingestion.
// Returns the number of rows deleted.
func DeleteStorePriceRefsByChainAndDate(ctx context.Context, chainSlug string, targetDate time.Time) (int64, error) {
	queries := sqlcgen.New(Pool())

	count, err := queries.DeleteStorePriceRefsByChainAndDate(ctx, sqlcgen.DeleteStorePriceRefsByChainAndDateParams{
		TargetDate: pgtype.Date{Time: targetDate, Valid: true},
		ChainSlug:  chainSlug,
	})
	if err != nil {
		return 0, fmt.Errorf("error deleting store price refs: %w", err)
	}

	return count, nil
}

// DeletePriceTiersByChainAndDate deletes all price_tiers for a chain at a specific date.
// Used for same-day overwrite during ingestion.
// Returns the number of rows deleted.
func DeletePriceTiersByChainAndDate(ctx context.Context, chainSlug string, targetDate time.Time) (int64, error) {
	queries := sqlcgen.New(Pool())

	count, err := queries.DeletePriceTiersByChainAndDate(ctx, sqlcgen.DeletePriceTiersByChainAndDateParams{
		ChainSlug:  chainSlug,
		TargetDate: pgtype.Date{Time: targetDate, Valid: true},
	})
	if err != nil {
		return 0, fmt.Errorf("error deleting price tiers: %w", err)
	}

	return count, nil
}

// GetLatestStorePriceViaTier retrieves the latest price for a store+item (using MAX(target_date)).
func GetLatestStorePriceViaTier(ctx context.Context, storeID, retailerItemID string) (*StorePriceViaTier, error) {
	queries := sqlcgen.New(Pool())

	row, err := queries.GetLatestStorePriceViaTier(ctx, sqlcgen.GetLatestStorePriceViaTierParams{
		StoreID:        storeID,
		RetailerItemID: retailerItemID,
	})

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("error querying latest store price via tier: %w", err)
	}

	return &StorePriceViaTier{
		RetailerItemID: retailerItemID,
		Price:          int(row.Price),
		DiscountPrice:  pgInt4ToIntPtr(row.DiscountPrice),
		UnitPrice:      pgInt4ToIntPtr(row.UnitPrice),
		AnchorPrice:    pgInt4ToIntPtr(row.AnchorPrice),
		TargetDate:     row.TargetDate.Time,
	}, nil
}

// GetLatestStorePricesViaTiers retrieves all latest prices for a store (using MAX(target_date) per chain).
func GetLatestStorePricesViaTiers(ctx context.Context, storeID string) ([]StorePriceViaTier, error) {
	queries := sqlcgen.New(Pool())

	rows, err := queries.ListLatestStorePricesViaTiers(ctx, storeID)
	if err != nil {
		return nil, fmt.Errorf("error querying latest store prices via tiers: %w", err)
	}

	results := make([]StorePriceViaTier, len(rows))
	for i, row := range rows {
		results[i] = StorePriceViaTier{
			RetailerItemID: row.RetailerItemID,
			PriceTierID:    row.PriceTierID,
			Price:          int(row.Price),
			DiscountPrice:  pgInt4ToIntPtr(row.DiscountPrice),
			UnitPrice:      pgInt4ToIntPtr(row.UnitPrice),
			AnchorPrice:    pgInt4ToIntPtr(row.AnchorPrice),
			InStock:        row.InStock.Valid && row.InStock.Bool,
			TargetDate:     row.TargetDate.Time,
		}
	}

	return results, nil
}

// ============================================================================
// Helper functions for pgtype conversions
// ============================================================================

// intPtrToPgInt4 converts *int to pgtype.Int4
func intPtrToPgInt4(p *int) pgtype.Int4 {
	if p == nil {
		return pgtype.Int4{Valid: false}
	}
	return pgtype.Int4{Int32: int32(*p), Valid: true}
}

// pgInt4ToIntPtr converts pgtype.Int4 to *int
func pgInt4ToIntPtr(p pgtype.Int4) *int {
	if !p.Valid {
		return nil
	}
	v := int(p.Int32)
	return &v
}
