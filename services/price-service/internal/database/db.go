package database

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kosarica/price-service/internal/jobs"
)

var (
	pool     *pgxpool.Pool
	poolMu   sync.RWMutex
	poolOnce sync.Once
)

// Connect creates a new database connection pool (safe for concurrent use)
func Connect(ctx context.Context, connString string, maxConns, minConns int, maxLifetime, maxIdleTime time.Duration) error {
	var initErr error
	poolOnce.Do(func() {
		config, err := pgxpool.ParseConfig(connString)
		if err != nil {
			initErr = fmt.Errorf("error parsing database config: %w", err)
			return
		}

		config.MaxConns = int32(maxConns)
		config.MinConns = int32(minConns)
		config.MaxConnLifetime = maxLifetime
		config.MaxConnIdleTime = maxIdleTime
		config.HealthCheckPeriod = 1 * time.Minute

		newPool, err := pgxpool.NewWithConfig(ctx, config)
		if err != nil {
			initErr = fmt.Errorf("error creating connection pool: %w", err)
			return
		}

		if err := newPool.Ping(ctx); err != nil {
			newPool.Close()
			initErr = fmt.Errorf("error connecting to database: %w", err)
			return
		}

		poolMu.Lock()
		pool = newPool
		poolMu.Unlock()
	})

	if initErr != nil {
		poolOnce = sync.Once{} // reset on failure
		return initErr
	}
	return nil
}

// Close closes the database connection pool
func Close() {
	poolMu.Lock()
	defer poolMu.Unlock()
	if pool != nil {
		pool.Close()
		pool = nil
	}
	poolOnce = sync.Once{} // reset to allow reconnection
}

// Pool returns the connection pool
func Pool() *pgxpool.Pool {
	poolMu.RLock()
	defer poolMu.RUnlock()
	return pool
}

// Status returns the current status of the database connection
func Status(ctx context.Context) error {
	poolMu.RLock()
	p := pool
	poolMu.RUnlock()

	if p == nil {
		return fmt.Errorf("database not initialized")
	}
	return p.Ping(ctx)
}

// Stats returns connection pool statistics
func Stats() *pgxpool.Stat {
	poolMu.RLock()
	defer poolMu.RUnlock()
	if pool == nil {
		return nil
	}
	return pool.Stat()
}

func init() {
	// Register the pool getter with the jobs package
	jobs.RegisterDBPoolGetter(Pool)
}
