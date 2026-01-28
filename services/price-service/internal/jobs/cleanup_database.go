package jobs

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
)

// cleanupExpiredExceptionsImpl removes expired price exceptions from the database
// Returns the number of exceptions deleted
func cleanupExpiredExceptionsImpl(ctx context.Context) (int, error) {
	pool := getPool()
	queries := sqlcgen.New(pool)

	rowsAffected, err := queries.DeleteExpiredPriceExceptions(ctx)
	if err != nil {
		return 0, err
	}

	return int(rowsAffected), nil
}

// cleanupOrphanPriceGroupsImpl removes price groups that have no active store memberships
// and haven't been seen in a long time
// Returns the number of groups deleted
func cleanupOrphanPriceGroupsImpl(ctx context.Context, age time.Duration) (int, error) {
	pool := getPool()
	queries := sqlcgen.New(pool)

	// Delete price groups that:
	// 1. Have no active store memberships (store_count = 0)
	// 2. Haven't been seen in the specified age period
	// 3. Are not referenced by any historical store_group_history entries
	cutoffTime := time.Now().Add(-age)
	pgCutoffTime := pgtype.Timestamp{Time: cutoffTime, Valid: true}

	// First, delete orphan group prices
	err := queries.DeleteOrphanGroupPrices(ctx, pgCutoffTime)
	if err != nil {
		return 0, err
	}

	// Then, delete the orphan price groups
	rowsAffected, err := queries.DeleteOrphanPriceGroups(ctx, pgCutoffTime)
	if err != nil {
		return 0, err
	}

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
