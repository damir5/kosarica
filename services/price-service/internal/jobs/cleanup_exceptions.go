package jobs

import (
	"context"
	"time"

	"github.com/rs/zerolog"
)

// ExceptionCleanupConfig holds configuration for cleanup jobs
type ExceptionCleanupConfig struct {
	ExceptionCleanupInterval time.Duration // How often to run exception cleanup
	OrphanGroupCleanupAge    time.Duration // Age threshold for orphan group cleanup
	Enabled                  bool          // Whether cleanup jobs are enabled
}

// DefaultExceptionCleanupConfig returns the default cleanup configuration
func DefaultExceptionCleanupConfig() ExceptionCleanupConfig {
	return ExceptionCleanupConfig{
		ExceptionCleanupInterval: 1 * time.Hour,
		OrphanGroupCleanupAge:    30 * 24 * time.Hour, // 30 days
		Enabled:                  true,
	}
}

// CleanupManager manages background cleanup jobs
type CleanupManager struct {
	config ExceptionCleanupConfig
	logger *zerolog.Logger
	ctx    context.Context
	cancel context.CancelFunc

	exceptionCleanupDone chan struct{}
	orphanGroupDone       chan struct{}
}

// NewCleanupManager creates a new cleanup manager
func NewCleanupManager(config ExceptionCleanupConfig, logger *zerolog.Logger) *CleanupManager {
	ctx, cancel := context.WithCancel(context.Background())

	return &CleanupManager{
		config:                config,
		logger:                logger,
		ctx:                   ctx,
		cancel:                cancel,
		exceptionCleanupDone:  make(chan struct{}),
		orphanGroupDone:       make(chan struct{}),
	}
}

// Start begins all background cleanup jobs
func (cm *CleanupManager) Start() {
	if !cm.config.Enabled {
		cm.logger.Info().Msg("Cleanup jobs are disabled, not starting")
		return
	}

	cm.logger.Info().
		Dur("exception_interval", cm.config.ExceptionCleanupInterval).
		Dur("orphan_group_age", cm.config.OrphanGroupCleanupAge).
		Msg("Starting cleanup manager")

	// Start exception cleanup job
	go cm.runExceptionCleanup()

	// Start orphan group cleanup job
	go cm.runOrphanGroupCleanup()
}

// Stop gracefully stops all cleanup jobs
func (cm *CleanupManager) Stop() {
	cm.logger.Info().Msg("Stopping cleanup manager...")
	cm.cancel()

	// Wait for jobs to finish (with timeout)
	select {
	case <-cm.exceptionCleanupDone:
		cm.logger.Debug().Msg("Exception cleanup job stopped")
	case <-time.After(5 * time.Second):
		cm.logger.Warn().Msg("Exception cleanup job did not stop gracefully")
	}

	select {
	case <-cm.orphanGroupDone:
		cm.logger.Debug().Msg("Orphan group cleanup job stopped")
	case <-time.After(5 * time.Second):
		cm.logger.Warn().Msg("Orphan group cleanup job did not stop gracefully")
	}

	cm.logger.Info().Msg("Cleanup manager stopped")
}

// runExceptionCleanup runs the expired exception cleanup job periodically
func (cm *CleanupManager) runExceptionCleanup() {
	defer close(cm.exceptionCleanupDone)

	ticker := time.NewTicker(cm.config.ExceptionCleanupInterval)
	defer ticker.Stop()

	// Run once immediately on startup
	cm.cleanupExceptions()

	for {
		select {
		case <-cm.ctx.Done():
			cm.logger.Debug().Msg("Exception cleanup job stopped")
			return
		case <-ticker.C:
			cm.cleanupExceptions()
		}
	}
}

// cleanupExceptions removes expired price exceptions
func (cm *CleanupManager) cleanupExceptions() {
	start := time.Now()
	cm.logger.Debug().Msg("Running exception cleanup job")

	// Import database package to avoid circular dependency
	// The function is called via the cleanup import
	deleted, err := cleanupExpiredExceptions(cm.ctx)
	if err != nil {
		cm.logger.Error().Err(err).Msg("Failed to cleanup expired exceptions")
		return
	}

	duration := time.Since(start)
	if deleted > 0 {
		cm.logger.Info().
			Int("deleted", deleted).
			Dur("duration", duration).
			Msg("Cleaned up expired price exceptions")
	} else {
		cm.logger.Debug().
			Dur("duration", duration).
			Msg("No expired exceptions to clean up")
	}
}

// runOrphanGroupCleanup runs the orphan price group cleanup job periodically
func (cm *CleanupManager) runOrphanGroupCleanup() {
	defer close(cm.orphanGroupDone)

	ticker := time.NewTicker(24 * time.Hour) // Run daily
	defer ticker.Stop()

	// Run once on startup (after a short delay)
	time.Sleep(5 * time.Minute)
	cm.cleanupOrphanGroups()

	for {
		select {
		case <-cm.ctx.Done():
			cm.logger.Debug().Msg("Orphan group cleanup job stopped")
			return
		case <-ticker.C:
			cm.cleanupOrphanGroups()
		}
	}
}

// cleanupOrphanGroups removes price groups that have no active store memberships
func (cm *CleanupManager) cleanupOrphanGroups() {
	start := time.Now()
	cm.logger.Debug().Msg("Running orphan group cleanup job")

	deleted, err := cleanupOrphanPriceGroups(cm.ctx, cm.config.OrphanGroupCleanupAge)
	if err != nil {
		cm.logger.Error().Err(err).Msg("Failed to cleanup orphan groups")
		return
	}

	duration := time.Since(start)
	if deleted > 0 {
		cm.logger.Info().
			Int("deleted", deleted).
			Dur("duration", duration).
			Msg("Cleaned up orphan price groups")
	} else {
		cm.logger.Debug().
			Dur("duration", duration).
			Msg("No orphan groups to clean up")
	}
}

// cleanupExpiredExceptions is a bridge function that calls the database cleanup
// This is defined in cleanup_database.go to avoid circular dependencies
func cleanupExpiredExceptions(ctx context.Context) (int, error) {
	return cleanupExpiredExceptionsImpl(ctx)
}

// cleanupOrphanPriceGroups is a bridge function that calls the database cleanup
// This is defined in cleanup_database.go to avoid circular dependencies
func cleanupOrphanPriceGroups(ctx context.Context, age time.Duration) (int, error) {
	return cleanupOrphanPriceGroupsImpl(ctx, age)
}
