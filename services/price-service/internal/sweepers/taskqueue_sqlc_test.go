package sweepers

import (
	"os"
	"strings"
	"testing"
)

// TestSweeperStillUsesRawSql verifies that taskqueue.go uses raw SQL for stored procedures
// This is expected because sqlc cannot properly type the recover_orphaned_tasks() function
// which returns TABLE(recovered_count integer, failed_count integer)
func TestSweeperStillUsesRawSql(t *testing.T) {
	content, err := os.ReadFile("taskqueue.go")
	if err != nil {
		t.Fatalf("Failed to read taskqueue.go: %v", err)
	}

	source := string(content)

	// Verify the stored procedure call is still present
	if !strings.Contains(source, "recover_orphaned_tasks()") {
		t.Error("taskqueue.go should still call recover_orphaned_tasks() stored procedure")
	}

	// Verify pool.QueryRow is used (raw SQL)
	if !strings.Contains(source, "s.pool.QueryRow") {
		t.Error("taskqueue.go should use pool.QueryRow for stored procedure call")
	}
}

// TestSweeperDocumentation verifies documentation explains why raw SQL is used
func TestSweeperDocumentation(t *testing.T) {
	content, err := os.ReadFile("taskqueue.go")
	if err != nil {
		t.Fatalf("Failed to read taskqueue.go: %v", err)
	}

	source := string(content)

	// Verify documentation explains why raw SQL is needed
	if !strings.Contains(source, "sqlc cannot") || !strings.Contains(source, "PL/pgSQL") {
		t.Error("taskqueue.go should have documentation explaining why raw SQL is used for stored procedures")
	}
}

// TestSweeperDoesNotImportSqlc verifies sqlcgen is not imported (not needed)
func TestSweeperDoesNotImportSqlc(t *testing.T) {
	content, err := os.ReadFile("taskqueue.go")
	if err != nil {
		t.Fatalf("Failed to read taskqueue.go: %v", err)
	}

	source := string(content)

	// sqlcgen should not be imported since we're using raw SQL
	if strings.Contains(source, `"github.com/kosarica/price-service/internal/database/sqlcgen"`) {
		t.Error("taskqueue.go should not import sqlcgen (not needed for stored procedure)")
	}
}

// TestSweeperRecoverOrphanedTasksSignature verifies the method signature is correct
func TestSweeperRecoverOrphanedTasksSignature(t *testing.T) {
	content, err := os.ReadFile("taskqueue.go")
	if err != nil {
		t.Fatalf("Failed to read taskqueue.go: %v", err)
	}

	source := string(content)

	// Verify method returns error
	if !strings.Contains(source, "func (s *TaskQueueSweeper) RecoverOrphanedTasks(ctx context.Context) error") {
		t.Error("RecoverOrphanedTasks should have correct method signature")
	}

	// Verify it scans into recoveredCount and failedCount
	if !strings.Contains(source, "&recoveredCount") && !strings.Contains(source, "&failedCount") {
		t.Error("RecoverOrphanedTasks should scan into recoveredCount and failedCount")
	}
}
