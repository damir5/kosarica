package database

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestNoRawSQLInHandlers verifies that handler files use sqlc instead of raw SQL
func TestNoRawSQLInHandlers(t *testing.T) {
	handlersDir := "../handlers"
	files := []string{
		"prices.go",
		"runs.go",
		"ingest.go",
		"failed_rows.go",
		"error_summary.go",
	}

	rawSQLPattern := regexp.MustCompile(`pool\.(Exec|Query|QueryRow)\(`)

	for _, file := range files {
		filePath := filepath.Join(handlersDir, file)
		content, err := os.ReadFile(filePath)
		if err != nil {
			t.Errorf("Failed to read %s: %v", file, err)
			continue
		}

		if rawSQLPattern.Match(content) {
			t.Errorf("%s contains raw SQL (pool.Exec/Query/QueryRow). Must use sqlc instead.", file)
		}
	}
}

// TestNoRawSQLInPipeline verifies that pipeline files use sqlc instead of raw SQL
func TestNoRawSQLInPipeline(t *testing.T) {
	pipelineDir := "../pipeline"
	files := []string{
		"persist.go",
		"parse.go",
		"discover.go",
		"pipeline.go",
	}

	rawSQLPattern := regexp.MustCompile(`pool\.(Exec|Query|QueryRow)\(`)

	for _, file := range files {
		filePath := filepath.Join(pipelineDir, file)
		content, err := os.ReadFile(filePath)
		if err != nil {
			t.Errorf("Failed to read %s: %v", file, err)
			continue
		}

		if rawSQLPattern.Match(content) {
			t.Errorf("%s contains raw SQL (pool.Exec/Query/QueryRow). Must use sqlc instead.", file)
		}
	}
}

// TestNoRawSQLInDatabase verifies that database files use sqlc instead of raw SQL
func TestNoRawSQLInDatabase(t *testing.T) {
	databaseDir := "."
	files := []string{
		"archive.go",
	}

	rawSQLPattern := regexp.MustCompile(`pool\.(Exec|Query|QueryRow)\(`)

	for _, file := range files {
		filePath := filepath.Join(databaseDir, file)
		content, err := os.ReadFile(filePath)
		if err != nil {
			t.Errorf("Failed to read %s: %v", file, err)
			continue
		}

		if rawSQLPattern.Match(content) {
			t.Errorf("%s contains raw SQL (pool.Exec/Query/QueryRow). Must use sqlc instead.", file)
		}
	}
}

// TestNoRawSQLInWorkers verifies that worker files use sqlc instead of raw SQL
func TestNoRawSQLInWorkers(t *testing.T) {
	workersDir := "../workers"
	files := []string{
		"worker.go",
	}

	rawSQLPattern := regexp.MustCompile(`pool\.(Exec|Query|QueryRow)\(`)

	for _, file := range files {
		filePath := filepath.Join(workersDir, file)
		content, err := os.ReadFile(filePath)
		if err != nil {
			t.Errorf("Failed to read %s: %v", file, err)
			continue
		}

		if rawSQLPattern.Match(content) {
			t.Errorf("%s contains raw SQL (pool.Exec/Query/QueryRow). Must use sqlc instead.", file)
		}
	}
}

// TestRawSQLExceptionsDocumented verifies that files with raw SQL are documented exceptions
func TestRawSQLExceptionsDocumented(t *testing.T) {
	// These files are documented exceptions that require raw SQL for stored procedures
	exceptions := map[string][]string{
		"../sweepers/taskqueue.go": {"recover_orphaned_tasks"},
		"../taskqueue/queue.go":    {"claim_tasks", "complete_task", "fail_task", "cleanup_old_tasks"},
	}

	for filePath, procedures := range exceptions {
		content, err := os.ReadFile(filePath)
		if err != nil {
			t.Errorf("Failed to read %s: %v", filePath, err)
			continue
		}

		contentStr := string(content)

		// Verify file contains raw SQL (expected for stored procedures)
		if !strings.Contains(contentStr, "pool.") {
			t.Errorf("%s should contain raw SQL for stored procedures, but doesn't", filePath)
		}

		// Verify each stored procedure is called
		for _, proc := range procedures {
			if !strings.Contains(contentStr, proc) {
				t.Errorf("%s should call stored procedure %s", filePath, proc)
			}
		}
	}
}
