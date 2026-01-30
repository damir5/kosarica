package pipeline

import (
	"context"
	"testing"

	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
)

// TestListPendingFilesForResume tests the query for getting pending files
func TestListPendingFilesForResume(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test")
	}

	// Skip if database pool is not initialized
	if database.Pool() == nil {
		t.Skip("Database pool not initialized")
	}

	ctx := context.Background()
	queries := sqlcgen.New(database.Pool())

	// Create a test run ID
	testRunID := "run_test_resume_001"

	// Query for pending files - should return empty for non-existent run
	files, err := queries.ListPendingFilesForResume(ctx, testRunID)
	if err != nil {
		t.Fatalf("ListPendingFilesForResume failed: %v", err)
	}

	if len(files) != 0 {
		t.Errorf("Expected 0 files for non-existent run, got %d", len(files))
	}
}

// TestResetProcessingFilesToPending tests the query for resetting processing files
func TestResetProcessingFilesToPending(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test")
	}

	// Skip if database pool is not initialized
	if database.Pool() == nil {
		t.Skip("Database pool not initialized")
	}

	ctx := context.Background()
	queries := sqlcgen.New(database.Pool())

	// Create a test run ID
	testRunID := "run_test_reset_001"

	// Reset processing files - should not error even if no files exist
	err := queries.ResetProcessingFilesToPending(ctx, testRunID)
	if err != nil {
		t.Fatalf("ResetProcessingFilesToPending failed: %v", err)
	}
}

// TestUpdateRunResumed tests the query for resuming a run
func TestUpdateRunResumed(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test")
	}

	// Skip if database pool is not initialized
	if database.Pool() == nil {
		t.Skip("Database pool not initialized")
	}

	ctx := context.Background()
	queries := sqlcgen.New(database.Pool())

	// Create a test run ID
	testRunID := "run_test_update_resume_001"

	// Try to update a non-existent run - should not error
	err := queries.UpdateRunResumed(ctx, sqlcgen.UpdateRunResumedParams{
		ID: testRunID,
	})
	if err != nil {
		t.Fatalf("UpdateRunResumed failed: %v", err)
	}
}
