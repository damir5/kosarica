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
		"price_groups.go",
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

// TestNoRawSQLInJobs verifies that job files use sqlc instead of raw SQL
func TestNoRawSQLInJobs(t *testing.T) {
	jobsDir := "../jobs"
	files := []string{
		"cleanup_database.go",
	}

	rawSQLPattern := regexp.MustCompile(`pool\.(Exec|Query|QueryRow)\(`)

	for _, file := range files {
		filePath := filepath.Join(jobsDir, file)
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

// TestAllHandlersUseSqlc verifies that all handler functions import and use sqlcgen
func TestAllHandlersUseSqlc(t *testing.T) {
	handlersDir := "../handlers"
	files := []string{
		"prices.go",
		"runs.go",
		"ingest.go",
		"failed_rows.go",
		"error_summary.go",
	}

	for _, file := range files {
		filePath := filepath.Join(handlersDir, file)
		content, err := os.ReadFile(filePath)
		if err != nil {
			t.Errorf("Failed to read %s: %v", file, err)
			continue
		}

		contentStr := string(content)

		// Verify sqlcgen import
		if !strings.Contains(contentStr, `"github.com/kosarica/price-service/internal/database/sqlcgen"`) {
			t.Errorf("%s should import sqlcgen package", file)
		}

		// Verify sqlcgen usage
		if !strings.Contains(contentStr, "sqlcgen.New(") {
			t.Errorf("%s should use sqlcgen.New() to create queries", file)
		}
	}
}

// TestSearchItemsUsesSqlc verifies that SearchItems handler uses sqlc
func TestSearchItemsUsesSqlc(t *testing.T) {
	filePath := "../handlers/prices.go"
	content, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("Failed to read prices.go: %v", err)
	}

	contentStr := string(content)

	// Verify SearchItems uses sqlc queries
	if !strings.Contains(contentStr, "queries.CountSearchItems(") {
		t.Error("SearchItems should use queries.CountSearchItems()")
	}
	if !strings.Contains(contentStr, "queries.SearchItemsWithStats(") {
		t.Error("SearchItems should use queries.SearchItemsWithStats()")
	}
}

// TestListRunsUsesSqlc verifies that ListRuns handler uses sqlc
func TestListRunsUsesSqlc(t *testing.T) {
	filePath := "../handlers/runs.go"
	content, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("Failed to read runs.go: %v", err)
	}

	contentStr := string(content)

	// Verify ListRuns uses sqlc queries
	if !strings.Contains(contentStr, "queries.CountIngestionRunsFiltered(") {
		t.Error("ListRuns should use queries.CountIngestionRunsFiltered()")
	}
	if !strings.Contains(contentStr, "queries.ListIngestionRunsFiltered(") {
		t.Error("ListRuns should use queries.ListIngestionRunsFiltered()")
	}
}

// TestSqlcQueriesForSearchExist verifies that search-related sqlc queries exist
func TestSqlcQueriesForSearchExist(t *testing.T) {
	filePath := "queries/prices.sql"
	content, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("Failed to read prices.sql: %v", err)
	}

	contentStr := string(content)

	queries := []string{
		"-- name: CountSearchItems :one",
		"-- name: SearchItemsWithStats :many",
	}

	for _, query := range queries {
		if !strings.Contains(contentStr, query) {
			t.Errorf("prices.sql should contain query: %s", query)
		}
	}
}

// TestSqlcQueriesForListRunsExist verifies that list runs sqlc queries exist
func TestSqlcQueriesForListRunsExist(t *testing.T) {
	filePath := "queries/runs.sql"
	content, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("Failed to read runs.sql: %v", err)
	}

	contentStr := string(content)

	queries := []string{
		"-- name: CountIngestionRunsFiltered :one",
		"-- name: ListIngestionRunsFiltered :many",
	}

	for _, query := range queries {
		if !strings.Contains(contentStr, query) {
			t.Errorf("runs.sql should contain query: %s", query)
		}
	}
}
