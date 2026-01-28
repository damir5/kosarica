package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/pkg/cuid2"
)

// FindOrCreatePriceGroup finds an existing price group by hash or creates a new one
// Uses INSERT ON CONFLICT DO NOTHING pattern for race condition safety
// Returns the price group, whether it was newly created, and any error
func FindOrCreatePriceGroup(ctx context.Context, chainSlug, priceHash string) (*PriceGroup, bool, error) {
	queries := sqlcgen.New(Pool())

	// First, try to find existing group
	existingGroup, err := queries.FindPriceGroupByHash(ctx, sqlcgen.FindPriceGroupByHashParams{
		ChainSlug: chainSlug,
		PriceHash: priceHash,
	})

	if err == nil {
		// Found existing group - convert from sqlcgen type
		return convertSqlcPriceGroup(existingGroup), false, nil
	}

	if err != pgx.ErrNoRows {
		// Unexpected error
		return nil, false, fmt.Errorf("error querying price group: %w", err)
	}

	// Not found, create new group
	now := time.Now()
	newGroupID := cuid2.GeneratePrefixedId("grp", cuid2.PrefixedIdOptions{})

	createdGroup, err := queries.CreatePriceGroup(ctx, sqlcgen.CreatePriceGroupParams{
		ID:        newGroupID,
		ChainSlug: chainSlug,
		PriceHash: priceHash,
		FirstSeenAt: pgtype.Timestamp{
			Time:  now,
			Valid: true,
		},
	})

	if err != nil {
		// Check if another goroutine created it first (race condition)
		if err == pgx.ErrNoRows {
			// Query again to get the group created by another goroutine
			existingGroup, err = queries.FindPriceGroupByHash(ctx, sqlcgen.FindPriceGroupByHashParams{
				ChainSlug: chainSlug,
				PriceHash: priceHash,
			})
			if err == nil {
				return convertSqlcPriceGroup(existingGroup), false, nil
			}
			return nil, false, fmt.Errorf("failed to find price group after race: %w", err)
		}
		return nil, false, fmt.Errorf("failed to insert price group: %w", err)
	}

	return convertSqlcPriceGroup(createdGroup), true, nil
}

// BulkInsertGroupPrices inserts multiple group prices in a single transaction
// Returns an error if the insertion fails
func BulkInsertGroupPrices(ctx context.Context, groupID string, prices []GroupPrice) error {
	if len(prices) == 0 {
		return nil
	}

	pool := Pool()

	// Begin transaction for bulk insert
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	txQueries := sqlcgen.New(tx)
	now := time.Now()

	for i, price := range prices {
		err := txQueries.UpsertGroupPrice(ctx, sqlcgen.UpsertGroupPriceParams{
			PriceGroupID:   groupID,
			RetailerItemID: price.RetailerItemID,
			Price:          int32(price.Price),
			DiscountPrice:  intPtrToPgInt4(price.DiscountPrice),
			UnitPrice:      intPtrToPgInt4(price.UnitPrice),
			AnchorPrice:    intPtrToPgInt4(price.AnchorPrice),
			CreatedAt: pgtype.Timestamp{
				Time:  now,
				Valid: true,
			},
		})
		if err != nil {
			return fmt.Errorf("failed to insert group price %d: %w", i, err)
		}
	}

	// Update item_count on price_groups table
	err = txQueries.UpdatePriceGroupItemCount(ctx, groupID)
	if err != nil {
		return fmt.Errorf("failed to update item_count: %w", err)
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// AssignStoreToGroup assigns a store to a price group
// Closes previous membership (sets valid_to = NOW()) and opens new membership
func AssignStoreToGroup(ctx context.Context, storeID, groupID string) error {
	pool := Pool()

	// Begin transaction
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	txQueries := sqlcgen.New(tx)
	now := time.Now()
	nowTs := pgtype.Timestamp{Time: now, Valid: true}

	// Get the old group ID BEFORE closing the membership (for store_count update)
	oldGroupID, err := txQueries.GetCurrentStoreGroupId(ctx, storeID)
	hasOldGroup := err == nil

	// Close previous membership for this store
	err = txQueries.CloseStoreGroupMembership(ctx, sqlcgen.CloseStoreGroupMembershipParams{
		ValidTo: nowTs,
		StoreID: storeID,
	})
	if err != nil {
		return fmt.Errorf("failed to close previous membership: %w", err)
	}

	// Create new membership entry
	historyID := cuid2.GeneratePrefixedId("sid", cuid2.PrefixedIdOptions{})
	err = txQueries.CreateStoreGroupHistory(ctx, sqlcgen.CreateStoreGroupHistoryParams{
		ID:           historyID,
		StoreID:      storeID,
		PriceGroupID: groupID,
		ValidFrom:    nowTs,
	})
	if err != nil {
		return fmt.Errorf("failed to insert new membership: %w", err)
	}

	// Update store_count on price_groups table
	// If there was an old group and it's different from the new one, decrement its count
	if hasOldGroup && oldGroupID != groupID {
		err = txQueries.DecrementPriceGroupStoreCount(ctx, oldGroupID)
		if err != nil {
			return fmt.Errorf("failed to decrement old group store_count: %w", err)
		}
	}

	// Increment new group
	err = txQueries.IncrementPriceGroupStoreCount(ctx, groupID)
	if err != nil {
		return fmt.Errorf("failed to increment new group store_count: %w", err)
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// GetCurrentPriceForStore retrieves the current price for an item at a store
// Checks store_price_exceptions first, then falls back to price group
// Returns: price, discountPrice, isException, error
func GetCurrentPriceForStore(ctx context.Context, storeID, itemID string) (int, *int, bool, error) {
	queries := sqlcgen.New(Pool())

	// First, check for exception (only if not expired)
	exceptionRow, err := queries.GetStorePriceException(ctx, sqlcgen.GetStorePriceExceptionParams{
		StoreID:        storeID,
		RetailerItemID: itemID,
	})

	if err == nil {
		// Found active exception
		discountPrice := pgInt4ToIntPtr(exceptionRow.DiscountPrice)
		return int(exceptionRow.Price), discountPrice, true, nil
	}

	// No exception, check price group
	groupRow, err := queries.GetStorePriceFromGroup(ctx, sqlcgen.GetStorePriceFromGroupParams{
		StoreID:        storeID,
		RetailerItemID: itemID,
	})

	if err != nil {
		if err == pgx.ErrNoRows {
			return 0, nil, false, fmt.Errorf("price not found for store %s item %s", storeID, itemID)
		}
		return 0, nil, false, fmt.Errorf("error querying price: %w", err)
	}

	discountPrice := pgInt4ToIntPtr(groupRow.DiscountPrice)
	return int(groupRow.Price), discountPrice, false, nil
}

// GetHistoricalPriceForStore retrieves the historical price for an item at a store
// asOf specifies the point in time to query
func GetHistoricalPriceForStore(ctx context.Context, storeID, itemID string, asOf time.Time) (int, *int, error) {
	queries := sqlcgen.New(Pool())

	row, err := queries.GetHistoricalStorePrice(ctx, sqlcgen.GetHistoricalStorePriceParams{
		StoreID:        storeID,
		RetailerItemID: itemID,
		ValidFrom: pgtype.Timestamp{
			Time:  asOf,
			Valid: true,
		},
	})

	if err != nil {
		if err == pgx.ErrNoRows {
			return 0, nil, fmt.Errorf("historical price not found for store %s item %s at %v", storeID, itemID, asOf)
		}
		return 0, nil, fmt.Errorf("error querying historical price: %w", err)
	}

	discountPrice := pgInt4ToIntPtr(row.DiscountPrice)
	return int(row.Price), discountPrice, nil
}

// UpdateGroupLastSeen updates the last_seen_at timestamp for a price group
func UpdateGroupLastSeen(ctx context.Context, groupID string) error {
	queries := sqlcgen.New(Pool())

	err := queries.UpdatePriceGroupLastSeen(ctx, groupID)
	if err != nil {
		return fmt.Errorf("failed to update group last_seen: %w", err)
	}

	return nil
}

// CleanupExpiredExceptions removes expired price exceptions
// Returns the number of exceptions deleted
func CleanupExpiredExceptions(ctx context.Context) (int, error) {
	queries := sqlcgen.New(Pool())

	rowsAffected, err := queries.DeleteExpiredPriceExceptions(ctx)
	if err != nil {
		return 0, fmt.Errorf("failed to cleanup expired exceptions: %w", err)
	}

	return int(rowsAffected), nil
}

// GetPriceGroupByID retrieves a price group by its ID
func GetPriceGroupByID(ctx context.Context, groupID string) (*PriceGroup, error) {
	queries := sqlcgen.New(Pool())

	group, err := queries.GetPriceGroupById(ctx, groupID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("price group not found: %s", groupID)
		}
		return nil, fmt.Errorf("error querying price group: %w", err)
	}

	return convertSqlcPriceGroup(group), nil
}

// GetGroupPrices retrieves all prices for a price group
func GetGroupPrices(ctx context.Context, groupID string) ([]GroupPrice, error) {
	queries := sqlcgen.New(Pool())

	rows, err := queries.ListGroupPrices(ctx, groupID)
	if err != nil {
		return nil, fmt.Errorf("error querying group prices: %w", err)
	}

	prices := make([]GroupPrice, len(rows))
	for i, row := range rows {
		prices[i] = convertSqlcGroupPrice(row)
	}

	return prices, nil
}

// GetStorePrices retrieves all prices for a store (via current price group)
func GetStorePrices(ctx context.Context, storeID string) ([]StorePriceResult, error) {
	queries := sqlcgen.New(Pool())

	rows, err := queries.ListStorePricesViaGroup(ctx, storeID)
	if err != nil {
		return nil, fmt.Errorf("error querying store prices: %w", err)
	}

	results := make([]StorePriceResult, len(rows))
	for i, row := range rows {
		results[i] = StorePriceResult{
			RetailerItemID: row.RetailerItemID,
			Price:          int(row.Price),
			DiscountPrice:  pgInt4ToIntPtr(row.DiscountPrice),
			UnitPrice:      pgInt4ToIntPtr(row.UnitPrice),
			AnchorPrice:    pgInt4ToIntPtr(row.AnchorPrice),
			IsException:    row.IsException,
		}
	}

	return results, nil
}

// ListPriceGroups lists price groups for a chain with pagination
func ListPriceGroups(ctx context.Context, chainSlug string, limit, offset int) ([]PriceGroup, error) {
	queries := sqlcgen.New(Pool())

	rows, err := queries.ListPriceGroupsByChain(ctx, sqlcgen.ListPriceGroupsByChainParams{
		ChainSlug: chainSlug,
		Limit:     int32(limit),
		Offset:    int32(offset),
	})
	if err != nil {
		return nil, fmt.Errorf("error querying price groups: %w", err)
	}

	groups := make([]PriceGroup, len(rows))
	for i, row := range rows {
		groups[i] = *convertSqlcPriceGroup(row)
	}

	return groups, nil
}

// CountPriceGroups returns the count of price groups for a chain
func CountPriceGroups(ctx context.Context, chainSlug string) (int64, error) {
	queries := sqlcgen.New(Pool())

	count, err := queries.CountPriceGroupsByChain(ctx, chainSlug)
	if err != nil {
		return 0, fmt.Errorf("error counting price groups: %w", err)
	}

	return count, nil
}

// Helper functions for type conversion

func convertSqlcPriceGroup(pg sqlcgen.PriceGroup) *PriceGroup {
	return &PriceGroup{
		ID:          pg.ID,
		ChainSlug:   pg.ChainSlug,
		PriceHash:   pg.PriceHash,
		HashVersion: int(pg.HashVersion),
		StoreCount:  int(pg.StoreCount),
		ItemCount:   int(pg.ItemCount),
		FirstSeenAt: pg.FirstSeenAt.Time,
		LastSeenAt:  pg.LastSeenAt.Time,
		CreatedAt:   pg.CreatedAt.Time,
		UpdatedAt:   pg.UpdatedAt.Time,
	}
}

func convertSqlcGroupPrice(gp sqlcgen.GroupPrice) GroupPrice {
	return GroupPrice{
		PriceGroupID:   gp.PriceGroupID,
		RetailerItemID: gp.RetailerItemID,
		Price:          int(gp.Price),
		DiscountPrice:  pgInt4ToIntPtr(gp.DiscountPrice),
		UnitPrice:      pgInt4ToIntPtr(gp.UnitPrice),
		AnchorPrice:    pgInt4ToIntPtr(gp.AnchorPrice),
		CreatedAt:      gp.CreatedAt.Time,
	}
}

func intPtrToPgInt4(p *int) pgtype.Int4 {
	if p == nil {
		return pgtype.Int4{Valid: false}
	}
	return pgtype.Int4{Int32: int32(*p), Valid: true}
}

func pgInt4ToIntPtr(p pgtype.Int4) *int {
	if !p.Valid {
		return nil
	}
	v := int(p.Int32)
	return &v
}
