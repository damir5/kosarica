package jobs

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// cleanupExpiredExceptionsImpl removes expired price exceptions from the database
// Returns the number of exceptions deleted
func cleanupExpiredExceptionsImpl(ctx context.Context) (int, error) {
	pool := getPool()

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

// cleanupOrphanPriceGroupsImpl removes price groups that have no active store memberships
// and haven't been seen in a long time
// Returns the number of groups deleted
func cleanupOrphanPriceGroupsImpl(ctx context.Context, age time.Duration) (int, error) {
	pool := getPool()

	// Delete price groups that:
	// 1. Have no active store memberships (store_count = 0)
	// 2. Haven't been seen in the specified age period
	// 3. Are not referenced by any historical store_group_history entries
	cutoffTime := time.Now().Add(-age)

	// First, delete orphan group prices
	_, err := pool.Exec(ctx, `
		DELETE FROM group_prices
		WHERE price_group_id IN (
			SELECT pg.id
			FROM price_groups pg
			WHERE pg.store_count = 0
			  AND pg.last_seen_at < $1
			  AND NOT EXISTS (
				  SELECT 1
				  FROM store_group_history sgh
				  WHERE sgh.price_group_id = pg.id
				    AND sgh.valid_to IS NULL
			  )
		)
	`, cutoffTime)
	if err != nil {
		return 0, fmt.Errorf("failed to delete orphan group prices: %w", err)
	}

	// Then, delete the orphan price groups
	result, err := pool.Exec(ctx, `
		DELETE FROM price_groups
		WHERE store_count = 0
		  AND last_seen_at < $1
		  AND NOT EXISTS (
			  SELECT 1
			  FROM store_group_history sgh
			  WHERE sgh.price_group_id = price_groups.id
			    AND sgh.valid_to IS NULL
		  )
	`, cutoffTime)

	if err != nil {
		return 0, fmt.Errorf("failed to delete orphan price groups: %w", err)
	}

	rowsAffected := result.RowsAffected()
	return int(rowsAffected), nil
}

// getPool returns the database connection pool
// This is a bridge to the database package to avoid circular dependencies
func getPool() *pgxpool.Pool {
	return dbPoolGetter()
}

// dbPoolGetter is a function that returns the database pool
// This will be set by the database package initialization
var dbPoolGetter func() *pgxpool.Pool

// RegisterDBPoolGetter registers the database pool getter function
// This should be called from the database package initialization
func RegisterDBPoolGetter(getter func() *pgxpool.Pool) {
	dbPoolGetter = getter
}
