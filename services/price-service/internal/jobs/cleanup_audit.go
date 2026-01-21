package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CleanupConfig configures retention policies for cleanup jobs
type CleanupConfig struct {
	CandidateRetentionDays int
	AuditRetentionDays     int
}

// DefaultCleanupConfig returns sensible retention defaults
func DefaultCleanupConfig() CleanupConfig {
	return CleanupConfig{
		CandidateRetentionDays: 7,  // Keep candidates for 7 days
		AuditRetentionDays:     90, // Keep audit logs for 90 days
	}
}

// CleanupOldCandidates removes stale candidate matches
// Candidates are only useful temporarily for review; after rejection/approval they can be cleaned up
func CleanupOldCandidates(ctx context.Context, db *pgxpool.Pool, cfg CleanupConfig) error {
	cutoffDate := time.Now().AddDate(0, 0, -cfg.CandidateRetentionDays)

	result, err := db.Exec(ctx, `
		DELETE FROM product_match_candidates
		WHERE created_at < $1
	`, cutoffDate)

	if err != nil {
		return fmt.Errorf("cleanup old candidates: %w", err)
	}

	rowsAffected := result.RowsAffected()
	slog.Info("cleaned up old product match candidates", "rows_deleted", rowsAffected, "cutoff", cutoffDate)

	return nil
}

// CleanupAuditLogs removes old audit log entries
// Audit logs are kept longer for compliance and debugging
func CleanupAuditLogs(ctx context.Context, db *pgxpool.Pool, cfg CleanupConfig) error {
	cutoffDate := time.Now().AddDate(0, 0, -cfg.AuditRetentionDays)

	result, err := db.Exec(ctx, `
		DELETE FROM product_match_audit
		WHERE created_at < $1
	`, cutoffDate)

	if err != nil {
		return fmt.Errorf("cleanup audit logs: %w", err)
	}

	rowsAffected := result.RowsAffected()
	slog.Info("cleaned up old audit logs", "rows_deleted", rowsAffected, "cutoff", cutoffDate)

	return nil
}

// CleanupStaleQueueItems removes queue items that have been pending too long
// These may need to be reprocessed if they got stuck
func CleanupStaleQueueItems(ctx context.Context, db *pgxpool.Pool, staleDays int) error {
	cutoffDate := time.Now().AddDate(0, 0, -staleDays)

	// Mark stale items as skipped so they can be reprocessed
	result, err := db.Exec(ctx, `
		UPDATE product_match_queue
		SET status = 'skipped',
		    reviewed_at = now()
		WHERE status = 'pending'
		AND created_at < $1
	`, cutoffDate)

	if err != nil {
		return fmt.Errorf("cleanup stale queue items: %w", err)
	}

	rowsAffected := result.RowsAffected()
	slog.Info("marked stale queue items as skipped", "rows_updated", rowsAffected, "cutoff", cutoffDate)

	return nil
}

// RunAllCleanupJobs runs all cleanup jobs in sequence
func RunAllCleanupJobs(ctx context.Context, db *pgxpool.Pool) error {
	cfg := DefaultCleanupConfig()

	slog.Info("starting cleanup jobs")

	if err := CleanupOldCandidates(ctx, db, cfg); err != nil {
		slog.Error("failed to cleanup old candidates", "error", err)
		// Continue with other jobs
	}

	if err := CleanupAuditLogs(ctx, db, cfg); err != nil {
		slog.Error("failed to cleanup audit logs", "error", err)
		// Continue with other jobs
	}

	// Clean up queue items pending for more than 30 days
	if err := CleanupStaleQueueItems(ctx, db, 30); err != nil {
		slog.Error("failed to cleanup stale queue items", "error", err)
	}

	slog.Info("cleanup jobs completed")

	return nil
}

// CleanupScheduler schedules cleanup jobs to run periodically
// This would be integrated with your job scheduler (cron, etc.)
type CleanupScheduler struct {
	db     *pgxpool.Pool
	config CleanupConfig
}

// NewCleanupScheduler creates a new cleanup scheduler
func NewCleanupScheduler(db *pgxpool.Pool, config CleanupConfig) *CleanupScheduler {
	if config.CandidateRetentionDays == 0 {
		config.CandidateRetentionDays = 7
	}
	if config.AuditRetentionDays == 0 {
		config.AuditRetentionDays = 90
	}

	return &CleanupScheduler{
		db:     db,
		config: config,
	}
}

// RunDailyCleanup runs all cleanup jobs
// This should be called by your scheduler (e.g., cron at 3 AM daily)
func (s *CleanupScheduler) RunDailyCleanup(ctx context.Context) error {
	slog.Info("running daily cleanup")

	if err := CleanupOldCandidates(ctx, s.db, s.config); err != nil {
		return fmt.Errorf("cleanup candidates: %w", err)
	}

	if err := CleanupAuditLogs(ctx, s.db, s.config); err != nil {
		return fmt.Errorf("cleanup audit: %w", err)
	}

	if err := CleanupStaleQueueItems(ctx, s.db, 30); err != nil {
		return fmt.Errorf("cleanup queue: %w", err)
	}

	slog.Info("daily cleanup completed")
	return nil
}

// GetCleanupStats returns statistics about what would be cleaned up
func GetCleanupStats(ctx context.Context, db *pgxpool.Pool, cfg CleanupConfig) (map[string]int64, error) {
	stats := make(map[string]int64)

	// Count old candidates
	candidateCutoff := time.Now().AddDate(0, 0, -cfg.CandidateRetentionDays)
	var candidateCount int64
	err := db.QueryRow(ctx, `
		SELECT COUNT(*) FROM product_match_candidates WHERE created_at < $1
	`, candidateCutoff).Scan(&candidateCount)
	if err != nil {
		return nil, fmt.Errorf("count candidates: %w", err)
	}
	stats["old_candidates"] = candidateCount

	// Count old audit logs
	auditCutoff := time.Now().AddDate(0, 0, -cfg.AuditRetentionDays)
	var auditCount int64
	err = db.QueryRow(ctx, `
		SELECT COUNT(*) FROM product_match_audit WHERE created_at < $1
	`, auditCutoff).Scan(&auditCount)
	if err != nil {
		return nil, fmt.Errorf("count audit logs: %w", err)
	}
	stats["old_audit_logs"] = auditCount

	// Count stale queue items
	staleCutoff := time.Now().AddDate(0, 0, -30)
	var staleCount int64
	err = db.QueryRow(ctx, `
		SELECT COUNT(*) FROM product_match_queue WHERE status = 'pending' AND created_at < $1
	`, staleCutoff).Scan(&staleCount)
	if err != nil {
		return nil, fmt.Errorf("count stale items: %w", err)
	}
	stats["stale_queue_items"] = staleCount

	return stats, nil
}
