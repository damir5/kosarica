package sweepers

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

// TaskQueueSweeper periodically recovers orphaned tasks
type TaskQueueSweeper struct {
	pool     *pgxpool.Pool
	logger   *zerolog.Logger
	interval time.Duration
	stopChan chan struct{}
}

// NewTaskQueueSweeper creates a new sweeper for task queue maintenance
func NewTaskQueueSweeper(pool *pgxpool.Pool, logger *zerolog.Logger, interval time.Duration) *TaskQueueSweeper {
	return &TaskQueueSweeper{
		pool:     pool,
		logger:   logger,
		interval: interval,
		stopChan: make(chan struct{}),
	}
}

// Start begins the periodic recovery sweep
func (s *TaskQueueSweeper) Start(ctx context.Context) {
	s.logger.Info().
		Dur("interval", s.interval).
		Msg("Starting task queue sweeper")

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			s.logger.Info().Msg("Task queue sweeper stopping (context cancelled)")
			return
		case <-s.stopChan:
			s.logger.Info().Msg("Task queue sweeper stopping (stop signal)")
			return
		case <-ticker.C:
			if err := s.RecoverOrphanedTasks(ctx); err != nil {
				s.logger.Error().Err(err).Msg("Failed to recover orphaned tasks")
			}
		}
	}
}

// Stop signals the sweeper to stop
func (s *TaskQueueSweeper) Stop() {
	close(s.stopChan)
}

// RecoverOrphanedTasks executes the SQL function to recover orphaned tasks
func (s *TaskQueueSweeper) RecoverOrphanedTasks(ctx context.Context) error {
	s.logger.Debug().Msg("Running orphaned task recovery")

	var recoveredCount, failedCount int32
	err := s.pool.QueryRow(ctx, `
		SELECT * FROM recover_orphaned_tasks()
	`).Scan(&recoveredCount, &failedCount)

	if err != nil {
		return fmt.Errorf("failed to execute recover_orphaned_tasks: %w", err)
	}

	if recoveredCount > 0 || failedCount > 0 {
		s.logger.Info().
			Int32("recovered", recoveredCount).
			Int32("failed", failedCount).
			Msg("Recovered orphaned tasks")
	}

	return nil
}
