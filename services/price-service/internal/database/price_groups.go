package database

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// FindOrCreatePriceGroup finds an existing price group by hash or creates a new one
// Uses INSERT ON CONFLICT DO NOTHING pattern for race condition safety
// Returns the price group, whether it was newly created, and any error
func FindOrCreatePriceGroup(ctx context.Context, chainSlug, priceHash string) (*PriceGroup, bool, error) {
	pool := Pool()

	// First, try to find existing group
	var existingGroup PriceGroup
	query := `
		SELECT id, chain_slug, price_hash, hash_version, store_count, item_count,
		       first_seen_at, last_seen_at, created_at, updated_at
		FROM price_groups
		WHERE chain_slug = $1 AND price_hash = $2 AND hash_version = 1
		LIMIT 1
	`
	err := pool.QueryRow(ctx, query, chainSlug, priceHash).Scan(
		&existingGroup.ID, &existingGroup.ChainSlug, &existingGroup.PriceHash,
		&existingGroup.HashVersion, &existingGroup.StoreCount, &existingGroup.ItemCount,
		&existingGroup.FirstSeenAt, &existingGroup.LastSeenAt,
		&existingGroup.CreatedAt, &existingGroup.UpdatedAt,
	)

	if err == nil {
		// Found existing group
		return &existingGroup, false, nil
	}

	if err != pgx.ErrNoRows {
		// Unexpected error
		return nil, false, fmt.Errorf("error querying price group: %w", err)
	}

	// Not found, create new group
	now := time.Now()
	newGroupID := uuid.New().String()

	insertQuery := `
		INSERT INTO price_groups (
			id, chain_slug, price_hash, hash_version, store_count, item_count,
			first_seen_at, last_seen_at, created_at, updated_at
		) VALUES (
			$1, $2, $3, 1, 0, 0, $4, $4, $4, $4
		)
		ON CONFLICT (chain_slug, price_hash, hash_version) DO NOTHING
		RETURNING id, chain_slug, price_hash, hash_version, store_count, item_count,
		          first_seen_at, last_seen_at, created_at, updated_at
	`

	var createdGroup PriceGroup
	err = pool.QueryRow(ctx, insertQuery, newGroupID, chainSlug, priceHash, now).Scan(
		&createdGroup.ID, &createdGroup.ChainSlug, &createdGroup.PriceHash,
		&createdGroup.HashVersion, &createdGroup.StoreCount, &createdGroup.ItemCount,
		&createdGroup.FirstSeenAt, &createdGroup.LastSeenAt,
		&createdGroup.CreatedAt, &createdGroup.UpdatedAt,
	)

	if err != nil {
		// Check if another goroutine created it first (race condition)
		if err == pgx.ErrNoRows {
			// Query again to get the group created by another goroutine
			err = pool.QueryRow(ctx, query, chainSlug, priceHash).Scan(
				&existingGroup.ID, &existingGroup.ChainSlug, &existingGroup.PriceHash,
				&existingGroup.HashVersion, &existingGroup.StoreCount, &existingGroup.ItemCount,
				&existingGroup.FirstSeenAt, &existingGroup.LastSeenAt,
				&existingGroup.CreatedAt, &existingGroup.UpdatedAt,
			)
			if err == nil {
				return &existingGroup, false, nil
			}
			return nil, false, fmt.Errorf("failed to find price group after race: %w", err)
		}
		return nil, false, fmt.Errorf("failed to insert price group: %w", err)
	}

	return &createdGroup, true, nil
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

	// Prepare batch insert statement
	batch := &pgx.Batch{}
	now := time.Now()

	for _, price := range prices {
		batch.Queue(`
			INSERT INTO group_prices (
				price_group_id, retailer_item_id, price, discount_price,
				unit_price, anchor_price, created_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (price_group_id, retailer_item_id) DO UPDATE SET
				price = EXCLUDED.price,
				discount_price = EXCLUDED.discount_price,
				unit_price = EXCLUDED.unit_price,
				anchor_price = EXCLUDED.anchor_price
		`, groupID, price.RetailerItemID, price.Price, price.DiscountPrice,
			price.UnitPrice, price.AnchorPrice, now)
	}

	// Execute batch
	br := tx.SendBatch(ctx, batch)
	defer br.Close()

	// Check for errors
	for i := 0; i < len(prices); i++ {
		_, err := br.Exec()
		if err != nil {
			return fmt.Errorf("failed to insert group price %d: %w", i, err)
		}
	}

	// Update item_count on price_groups table
	_, err = tx.Exec(ctx, `
		UPDATE price_groups
		SET item_count = (
			SELECT COUNT(*) FROM group_prices WHERE price_group_id = $1
		),
		updated_at = NOW()
		WHERE id = $1
	`, groupID)
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

	now := time.Now()

	// Get the old group ID BEFORE closing the membership (for store_count update)
	var oldGroupID *string
	err = tx.QueryRow(ctx, `
		SELECT price_group_id
		FROM store_group_history
		WHERE store_id = $1 AND valid_to IS NULL
		LIMIT 1
	`, storeID).Scan(&oldGroupID)

	// Close previous membership for this store
	_, err = tx.Exec(ctx, `
		UPDATE store_group_history
		SET valid_to = $1
		WHERE store_id = $2 AND valid_to IS NULL
	`, now, storeID)
	if err != nil {
		return fmt.Errorf("failed to close previous membership: %w", err)
	}

	// Create new membership entry
	historyID := uuid.New().String()
	_, err = tx.Exec(ctx, `
		INSERT INTO store_group_history (id, store_id, price_group_id, valid_from, valid_to, created_at)
		VALUES ($1, $2, $3, $4, NULL, NOW())
	`, historyID, storeID, groupID, now)
	if err != nil {
		return fmt.Errorf("failed to insert new membership: %w", err)
	}

	// Update store_count on price_groups table
	// If there was an old group and it's different from the new one, decrement its count
	if oldGroupID != nil && *oldGroupID != groupID {
		_, err = tx.Exec(ctx, `
			UPDATE price_groups
			SET store_count = store_count - 1,
			    updated_at = NOW()
			WHERE id = $1
		`, *oldGroupID)
		if err != nil {
			return fmt.Errorf("failed to decrement old group store_count: %w", err)
		}
	}

	// Increment new group
	_, err = tx.Exec(ctx, `
		UPDATE price_groups
		SET store_count = store_count + 1,
		    updated_at = NOW()
		WHERE id = $1
	`, groupID)
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
	pool := Pool()

	// First, check for exception (only if not expired)
	var price int
	var discountPrice *int
	err := pool.QueryRow(ctx, `
		SELECT price, discount_price
		FROM store_price_exceptions
		WHERE store_id = $1 AND retailer_item_id = $2 AND expires_at > NOW()
		LIMIT 1
	`, storeID, itemID).Scan(&price, &discountPrice)

	if err == nil {
		// Found active exception
		return price, discountPrice, true, nil
	}

	// No exception, check price group
	err = pool.QueryRow(ctx, `
		SELECT gp.price, gp.discount_price
		FROM group_prices gp
		JOIN store_group_history sgh ON sgh.price_group_id = gp.price_group_id
		WHERE sgh.store_id = $1
		  AND gp.retailer_item_id = $2
		  AND sgh.valid_to IS NULL
		LIMIT 1
	`, storeID, itemID).Scan(&price, &discountPrice)

	if err != nil {
		if err == pgx.ErrNoRows {
			return 0, nil, false, fmt.Errorf("price not found for store %s item %s", storeID, itemID)
		}
		return 0, nil, false, fmt.Errorf("error querying price: %w", err)
	}

	return price, discountPrice, false, nil
}

// GetHistoricalPriceForStore retrieves the historical price for an item at a store
// asOf specifies the point in time to query
func GetHistoricalPriceForStore(ctx context.Context, storeID, itemID string, asOf time.Time) (int, *int, error) {
	pool := Pool()

	var price int
	var discountPrice *int

	err := pool.QueryRow(ctx, `
		SELECT gp.price, gp.discount_price
		FROM group_prices gp
		JOIN store_group_history sgh ON sgh.price_group_id = gp.price_group_id
		WHERE sgh.store_id = $1
		  AND gp.retailer_item_id = $2
		  AND sgh.valid_from <= $3
		  AND (sgh.valid_to IS NULL OR sgh.valid_to > $3)
		ORDER BY sgh.valid_from DESC
		LIMIT 1
	`, storeID, itemID, asOf).Scan(&price, &discountPrice)

	if err != nil {
		if err == pgx.ErrNoRows {
			return 0, nil, fmt.Errorf("historical price not found for store %s item %s at %v", storeID, itemID, asOf)
		}
		return 0, nil, fmt.Errorf("error querying historical price: %w", err)
	}

	return price, discountPrice, nil
}

// UpdateGroupLastSeen updates the last_seen_at timestamp for a price group
func UpdateGroupLastSeen(ctx context.Context, groupID string) error {
	pool := Pool()

	_, err := pool.Exec(ctx, `
		UPDATE price_groups
		SET last_seen_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, groupID)

	if err != nil {
		return fmt.Errorf("failed to update group last_seen: %w", err)
	}

	return nil
}

// CleanupExpiredExceptions removes expired price exceptions
// Returns the number of exceptions deleted
func CleanupExpiredExceptions(ctx context.Context) (int, error) {
	pool := Pool()

	result, err := pool.Exec(ctx, `
		DELETE FROM store_price_exceptions
		WHERE expires_at <= NOW()
	`)

	if err != nil {
		return 0, fmt.Errorf("failed to cleanup expired exceptions: %w", err)
	}

	rowsAffected := result.RowsAffected()
	return int(rowsAffected), nil
}

// GetPriceGroupByID retrieves a price group by its ID
func GetPriceGroupByID(ctx context.Context, groupID string) (*PriceGroup, error) {
	pool := Pool()

	query := `
		SELECT id, chain_slug, price_hash, hash_version, store_count, item_count,
		       first_seen_at, last_seen_at, created_at, updated_at
		FROM price_groups
		WHERE id = $1
	`

	var group PriceGroup
	err := pool.QueryRow(ctx, query, groupID).Scan(
		&group.ID, &group.ChainSlug, &group.PriceHash,
		&group.HashVersion, &group.StoreCount, &group.ItemCount,
		&group.FirstSeenAt, &group.LastSeenAt,
		&group.CreatedAt, &group.UpdatedAt,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("price group not found: %s", groupID)
		}
		return nil, fmt.Errorf("error querying price group: %w", err)
	}

	return &group, nil
}

// GetGroupPrices retrieves all prices for a price group
func GetGroupPrices(ctx context.Context, groupID string) ([]GroupPrice, error) {
	pool := Pool()

	query := `
		SELECT price_group_id, retailer_item_id, price, discount_price,
		       unit_price, anchor_price, created_at
		FROM group_prices
		WHERE price_group_id = $1
		ORDER BY retailer_item_id
	`

	rows, err := pool.Query(ctx, query, groupID)
	if err != nil {
		return nil, fmt.Errorf("error querying group prices: %w", err)
	}
	defer rows.Close()

	prices := make([]GroupPrice, 0)
	for rows.Next() {
		var price GroupPrice
		err := rows.Scan(
			&price.PriceGroupID, &price.RetailerItemID, &price.Price,
			&price.DiscountPrice, &price.UnitPrice, &price.AnchorPrice,
			&price.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("error scanning group price: %w", err)
		}
		prices = append(prices, price)
	}

	return prices, nil
}

// GetStorePrices retrieves all prices for a store (via current price group)
func GetStorePrices(ctx context.Context, storeID string) ([]StorePriceResult, error) {
	pool := Pool()

	query := `
		SELECT
			gp.retailer_item_id,
			gp.price,
			gp.discount_price,
			gp.unit_price,
			gp.anchor_price,
			COALESCE(spe.store_id, '') != '' AS is_exception
		FROM group_prices gp
		JOIN store_group_history sgh ON sgh.price_group_id = gp.price_group_id
		LEFT JOIN store_price_exceptions spe ON spe.store_id = sgh.store_id
		    AND spe.retailer_item_id = gp.retailer_item_id
		    AND spe.expires_at > NOW()
		WHERE sgh.store_id = $1 AND sgh.valid_to IS NULL
		ORDER BY gp.retailer_item_id
	`

	rows, err := pool.Query(ctx, query, storeID)
	if err != nil {
		return nil, fmt.Errorf("error querying store prices: %w", err)
	}
	defer rows.Close()

	results := make([]StorePriceResult, 0)
	for rows.Next() {
		var result StorePriceResult
		err := rows.Scan(
			&result.RetailerItemID,
			&result.Price,
			&result.DiscountPrice,
			&result.UnitPrice,
			&result.AnchorPrice,
			&result.IsException,
		)
		if err != nil {
			return nil, fmt.Errorf("error scanning store price: %w", err)
		}
		results = append(results, result)
	}

	return results, nil
}

// ListPriceGroups lists price groups for a chain with pagination
func ListPriceGroups(ctx context.Context, chainSlug string, limit, offset int) ([]PriceGroup, error) {
	pool := Pool()

	query := `
		SELECT id, chain_slug, price_hash, hash_version, store_count, item_count,
		       first_seen_at, last_seen_at, created_at, updated_at
		FROM price_groups
		WHERE chain_slug = $1
		ORDER BY last_seen_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := pool.Query(ctx, query, chainSlug, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("error querying price groups: %w", err)
	}
	defer rows.Close()

	groups := make([]PriceGroup, 0)
	for rows.Next() {
		var group PriceGroup
		err := rows.Scan(
			&group.ID, &group.ChainSlug, &group.PriceHash,
			&group.HashVersion, &group.StoreCount, &group.ItemCount,
			&group.FirstSeenAt, &group.LastSeenAt,
			&group.CreatedAt, &group.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("error scanning price group: %w", err)
		}
		groups = append(groups, group)
	}

	return groups, nil
}
