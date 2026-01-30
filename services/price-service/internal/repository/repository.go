package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
)

// Repository provides a base for all repositories with connection and transaction management
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository creates a new repository with the given database pool
func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// NewRepositoryFromPool creates a repository using the global database pool
func NewRepositoryFromPool() *Repository {
	return &Repository{db: database.Pool()}
}

// WithTx executes the given function within a database transaction
// The transaction is automatically committed if the function returns nil, or rolled back if it returns an error
func (r *Repository) WithTx(ctx context.Context, fn func(*sqlcgen.Queries) error) error {
	if r.db == nil {
		return fmt.Errorf("database pool is nil")
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	// Ensure rollback on panic or error
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p) // Re-panic after rollback
		}
	}()

	queries := sqlcgen.New(tx)
	if err := fn(queries); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// WithTxRollbackOnError executes the given function within a transaction
// Similar to WithTx but returns both the error and a boolean indicating if rollback occurred
func (r *Repository) WithTxRollbackOnError(ctx context.Context, fn func(*sqlcgen.Queries) error) (err error, rolledBack bool) {
	if r.db == nil {
		return fmt.Errorf("database pool is nil"), false
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err), false
	}

	// Ensure rollback on panic
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			err = fmt.Errorf("panic in transaction: %v", p)
			rolledBack = true
			panic(p) // Re-panic
		}
	}()

	queries := sqlcgen.New(tx)
	if fnErr := fn(queries); fnErr != nil {
		_ = tx.Rollback(ctx)
		return fnErr, true
	}

	if commitErr := tx.Commit(ctx); commitErr != nil {
		return fmt.Errorf("failed to commit transaction: %w", commitErr), false
	}

	return nil, false
}

// Query executes a function with a standard query interface (no transaction)
func (r *Repository) Query(ctx context.Context, fn func(*sqlcgen.Queries) error) error {
	if r.db == nil {
		return fmt.Errorf("database pool is nil")
	}

	queries := sqlcgen.New(r.db)
	return fn(queries)
}

// QueryWithConn executes a function with a connection from the pool
// Useful when you need to ensure all queries use the same connection
func (r *Repository) QueryWithConn(ctx context.Context, fn func(*sqlcgen.Queries) error) error {
	if r.db == nil {
		return fmt.Errorf("database pool is nil")
	}

	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("failed to acquire connection: %w", err)
	}
	defer conn.Release()

	queries := sqlcgen.New(conn)
	return fn(queries)
}

// HealthCheck checks if the database connection is healthy
func (r *Repository) HealthCheck(ctx context.Context) error {
	if r.db == nil {
		return fmt.Errorf("database pool is nil")
	}

	return r.db.Ping(ctx)
}

// Close closes the repository's database pool (if owned by this repository)
// Note: If using the global pool, this won't actually close it
func (r *Repository) Close() {
	// Only close if we own the pool (not the global one)
	// This is a no-op for repositories created with NewRepositoryFromPool
}

// IsTxError checks if an error is a transaction-related error
func IsTxError(err error) bool {
	if err == nil {
		return false
	}
	// Check for common transaction error patterns
	return err == pgx.ErrTxClosed || err == pgx.ErrTxCommitRollback
}
