package taskqueue

import (
	"os"
	"strings"
	"testing"
)

// TestQueueUsesSqlc verifies that queue.go uses sqlc for appropriate database operations
func TestQueueUsesSqlc(t *testing.T) {
	content, err := os.ReadFile("queue.go")
	if err != nil {
		t.Fatalf("Failed to read queue.go: %v", err)
	}

	source := string(content)

	// Verify sqlcgen import exists
	if !strings.Contains(source, `"github.com/kosarica/price-service/internal/database/sqlcgen"`) {
		t.Error("queue.go should import sqlcgen package")
	}

	// Verify pgtype import for parameter conversion
	if !strings.Contains(source, `"github.com/jackc/pgx/v5/pgtype"`) {
		t.Error("queue.go should import pgtype package")
	}
}

// TestQueueScheduleTaskUsesSqlc verifies ScheduleTask uses sqlc
func TestQueueScheduleTaskUsesSqlc(t *testing.T) {
	content, err := os.ReadFile("queue.go")
	if err != nil {
		t.Fatalf("Failed to read queue.go: %v", err)
	}

	source := string(content)

	// Verify sqlcgen.ScheduleTaskParams is used
	if !strings.Contains(source, "sqlcgen.ScheduleTaskParams") {
		t.Error("ScheduleTask should use sqlcgen.ScheduleTaskParams")
	}

	// Verify queries.ScheduleTask is called
	if !strings.Contains(source, "queries.ScheduleTask(ctx") {
		t.Error("ScheduleTask should call queries.ScheduleTask")
	}
}

// TestQueueCancelTaskUsesSqlc verifies CancelTask uses sqlc
func TestQueueCancelTaskUsesSqlc(t *testing.T) {
	content, err := os.ReadFile("queue.go")
	if err != nil {
		t.Fatalf("Failed to read queue.go: %v", err)
	}

	source := string(content)

	// Verify queries.CancelTask is called
	if !strings.Contains(source, "queries.CancelTask(ctx") {
		t.Error("CancelTask should call queries.CancelTask")
	}

	// Verify raw SQL UPDATE for cancel is not used
	if strings.Contains(source, `SET status = 'cancelled'`) {
		t.Error("CancelTask should not contain raw SQL for setting cancelled status")
	}
}

// TestQueueGetTaskUsesSqlc verifies GetTask uses sqlc
func TestQueueGetTaskUsesSqlc(t *testing.T) {
	content, err := os.ReadFile("queue.go")
	if err != nil {
		t.Fatalf("Failed to read queue.go: %v", err)
	}

	source := string(content)

	// Verify queries.GetTask is called
	if !strings.Contains(source, "queries.GetTask(ctx") {
		t.Error("GetTask should call queries.GetTask")
	}

	// Verify raw SQL SELECT for task_queue is not used in GetTask
	// Note: ClaimTasks still uses raw SQL for stored procedure
	if strings.Contains(source, `SELECT id, task_type, payload, priority, status`) {
		t.Error("GetTask should not contain raw SQL SELECT")
	}
}

// TestQueueStoredProceduresStillRawSql verifies stored procedures still use raw SQL
// This is expected because sqlc cannot properly type stored procedure returns
func TestQueueStoredProceduresStillRawSql(t *testing.T) {
	content, err := os.ReadFile("queue.go")
	if err != nil {
		t.Fatalf("Failed to read queue.go: %v", err)
	}

	source := string(content)

	// These should still use raw SQL as sqlc can't type them
	storedProcedures := []string{
		"claim_tasks",      // Returns table
		"complete_task",    // Returns boolean from function
		"fail_task",        // Returns boolean from function
		"cleanup_old_tasks", // Returns integer from function
	}

	for _, proc := range storedProcedures {
		if !strings.Contains(source, proc) {
			t.Errorf("queue.go should still contain reference to stored procedure %s", proc)
		}
	}
}

// TestQueueDocumentationComment verifies the documentation about sqlc usage
func TestQueueDocumentationComment(t *testing.T) {
	content, err := os.ReadFile("queue.go")
	if err != nil {
		t.Fatalf("Failed to read queue.go: %v", err)
	}

	source := string(content)

	// Verify documentation about which methods use sqlc vs raw SQL
	if !strings.Contains(source, "Methods using sqlc") {
		t.Error("queue.go should have documentation about which methods use sqlc")
	}

	if !strings.Contains(source, "Methods using raw SQL") {
		t.Error("queue.go should have documentation about which methods use raw SQL")
	}
}

// TestSqlcTaskQueueMethodsExist verifies the sqlc methods exist in generated code
func TestSqlcTaskQueueMethodsExist(t *testing.T) {
	content, err := os.ReadFile("../database/sqlcgen/taskqueue.sql.go")
	if err != nil {
		t.Fatalf("Failed to read taskqueue.sql.go: %v", err)
	}

	source := string(content)

	methods := []string{
		"func (q *Queries) ScheduleTask",
		"func (q *Queries) CancelTask",
		"func (q *Queries) GetTask",
		"func (q *Queries) SetTaskProcessingAny",
	}

	for _, method := range methods {
		if !strings.Contains(source, method) {
			t.Errorf("%s method should exist in sqlcgen", method)
		}
	}
}

// TestQueueGetTaskConversion verifies GetTask properly converts sqlc types
func TestQueueGetTaskConversion(t *testing.T) {
	content, err := os.ReadFile("queue.go")
	if err != nil {
		t.Fatalf("Failed to read queue.go: %v", err)
	}

	source := string(content)

	// Verify type conversion from sqlcgen.TaskQueue to taskqueue.Task
	conversions := []string{
		"sqlcTask.ID",
		"sqlcTask.TaskType",
		"sqlcTask.Payload",
		"TaskStatus(sqlcTask.Status)",
	}

	for _, conv := range conversions {
		if !strings.Contains(source, conv) {
			t.Errorf("GetTask should contain conversion: %s", conv)
		}
	}

	// Verify nullable field handling
	if !strings.Contains(source, ".Valid") {
		t.Error("GetTask should check .Valid for nullable fields")
	}
}
