package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var pool *pgxpool.Pool

// Connect creates a new database connection pool
func Connect(ctx context.Context, connString string, maxConns, minConns int, maxLifetime, maxIdleTime time.Duration) error {
	config, err := pgxpool.ParseConfig(connString)
	if err != nil {
		return fmt.Errorf("error parsing database config: %w", err)
	}

	// Configure pool
	config.MaxConns = int32(maxConns)
	config.MinConns = int32(minConns)
	config.MaxConnLifetime = maxLifetime
	config.MaxConnIdleTime = maxIdleTime
	config.HealthCheckPeriod = 1 * time.Minute

	// Create pool
	pool, err = pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return fmt.Errorf("error creating connection pool: %w", err)
	}

	// Verify connection
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return fmt.Errorf("error connecting to database: %w", err)
	}

	return nil
}

// Close closes the database connection pool
func Close() {
	if pool != nil {
		pool.Close()
		pool = nil
	}
}

// Pool returns the connection pool
func Pool() *pgxpool.Pool {
	return pool
}

// Status returns the current status of the database connection
func Status(ctx context.Context) error {
	if pool == nil {
		return fmt.Errorf("database not initialized")
	}
	return pool.Ping(ctx)
}

// Stats returns connection pool statistics
func Stats() *pgxpool.Stat {
	if pool == nil {
		return nil
	}
	return pool.Stat()
}
