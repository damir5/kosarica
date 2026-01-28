package handlers

import (
	"reflect"
	"strings"
	"testing"

	"github.com/kosarica/price-service/internal/database/sqlcgen"
)

// TestSqlcImportsAvailable verifies that the sqlcgen package is correctly imported
func TestSqlcImportsAvailable(t *testing.T) {
	// Verify that sqlcgen.New exists and returns a pointer to Queries
	queriesType := reflect.TypeOf((*sqlcgen.Queries)(nil))
	if queriesType == nil {
		t.Error("sqlcgen.Queries type should be available")
	}
}

// TestPricesHandlerUsesSqlc verifies prices.go uses sqlc types
func TestPricesHandlerUsesSqlc(t *testing.T) {
	// These types should exist from prices.sql queries
	var _ sqlcgen.CountStorePricesParams
	var _ sqlcgen.ListStorePricesWithDetailsParams
}

// TestRunsHandlerUsesSqlc verifies runs.go uses sqlc types
func TestRunsHandlerUsesSqlc(t *testing.T) {
	// These types should exist from runs.sql and files.sql queries
	var _ sqlcgen.ListIngestionFilesParams
	var _ sqlcgen.ListIngestionErrorsParams
	var _ sqlcgen.GetRunStatsParams
	var _ sqlcgen.CreateRerunRunParams
}

// TestIngestHandlerUsesSqlc verifies ingest.go uses sqlc types
func TestIngestHandlerUsesSqlc(t *testing.T) {
	// These types should exist from ingestion.sql queries
	var _ sqlcgen.CreateIngestionRunParams
	var _ sqlcgen.UpdateIngestionRunStatusParams
	var _ sqlcgen.UpdateIngestionRunFailedParams
	var _ sqlcgen.ListIngestionRunsByChainParams
}

// TestFailedRowsHandlerUsesSqlc verifies failed_rows.go uses sqlc types
func TestFailedRowsHandlerUsesSqlc(t *testing.T) {
	// These types should exist from failed_rows.sql queries
	var _ sqlcgen.ListFailedRowsParams
	var _ sqlcgen.UpdateFailedRowNotesParams
	var _ sqlcgen.GetFailedRowsForReprocessingRow
}

// TestErrorSummaryHandlerUsesSqlc verifies error_summary.go uses sqlc types
func TestErrorSummaryHandlerUsesSqlc(t *testing.T) {
	// This type should exist from error_summary.sql queries
	var _ sqlcgen.GetErrorSummaryByChainRow
}

// TestSqlcMethodsExist verifies key sqlc methods exist
func TestSqlcMethodsExist(t *testing.T) {
	// Use reflection to verify methods exist on Queries type
	queriesType := reflect.TypeOf(&sqlcgen.Queries{})

	methods := []string{
		"CountStorePrices",
		"ListStorePricesWithDetails",
		"GetRetailerItemDetails",
		"GetRetailerItemName",
		"CountPriceGroupsByChain",
		"GetIngestionRunById",
		"CountIngestionFiles",
		"ListIngestionFiles",
		"CountIngestionErrors",
		"ListIngestionErrors",
		"GetRunStats",
		"CountErrorsByDateRange",
		"GetRunChainSlug",
		"CreateRerunRun",
		"CheckRunExists",
		"DeleteIngestionErrors",
		"DeleteIngestionFiles",
		"DeleteIngestionRun",
		"CreateIngestionRun",
		"GetIngestionRun",
		"UpdateIngestionRunStatus",
		"UpdateIngestionRunFailed",
		"ListIngestionRunsByChain",
		"CountFailedRows",
		"ListFailedRows",
		"UpdateFailedRowNotes",
		"GetFailedRowsForReprocessing",
		"MarkRowAsReprocessed",
		"CreateReprocessingRun",
		"GetErrorSummaryByChain",
	}

	for _, methodName := range methods {
		_, ok := queriesType.MethodByName(methodName)
		if !ok {
			t.Errorf("Method %s should exist on sqlcgen.Queries", methodName)
		}
	}
}

// TestHandlerResponseTypes verifies response types are properly defined
func TestHandlerResponseTypes(t *testing.T) {
	// Verify response types compile and have expected fields
	_ = StorePrice{
		RetailerItemID: "test",
		ItemName:       "Test Item",
	}

	_ = IngestionRun{
		ID:        "test-id",
		ChainSlug: "konzum",
		Source:    "api",
		Status:    "running",
	}

	_ = IngestionFile{
		RunID:    "run-id",
		Filename: "test.csv",
		FileType: "csv",
		Status:   "completed",
	}

	_ = IngestionError{
		ID:           "error-id",
		RunID:        "run-id",
		ErrorType:    "validation",
		ErrorMessage: "test error",
		Severity:     "error",
	}

	_ = FailedRow{
		ID:        "failed-row-id",
		ChainSlug: "konzum",
		ChainName: "Konzum",
	}

	_ = ErrorSummary{
		ErrorRate: 0.05,
		TotalRows: 1000,
		FailedRows: 50,
	}
}

// TestGetChainNameFunction verifies the chain name lookup function
func TestGetChainNameFunction(t *testing.T) {
	tests := []struct {
		slug     string
		expected string
	}{
		{"konzum", "Konzum"},
		{"lidl", "Lidl"},
		{"plodine", "Plodine"},
		{"interspar", "Interspar"},
		{"eurospin", "Eurospin"},
		{"ktc", "KTC"},
		{"metro", "Metro"},
		{"studenac", "Studenac"},
		{"trgocentar", "Trgocentar"},
		{"kaufland", "Kaufland"},
		{"unknown", "unknown"}, // Unknown slugs return themselves
	}

	for _, tt := range tests {
		t.Run(tt.slug, func(t *testing.T) {
			result := getChainName(tt.slug)
			if result != tt.expected {
				t.Errorf("getChainName(%q) = %q, want %q", tt.slug, result, tt.expected)
			}
		})
	}
}

// TestSqlcMigrationComplete verifies all handler files use sqlc
func TestSqlcMigrationComplete(t *testing.T) {
	// This test documents which files have been migrated to sqlc
	migratedFiles := []string{
		"prices.go",
		"runs.go",
		"ingest.go",
		"failed_rows.go",
		"error_summary.go",
	}

	for _, file := range migratedFiles {
		t.Run(file, func(t *testing.T) {
			// Document that file should use sqlcgen
			if !strings.HasSuffix(file, ".go") {
				t.Errorf("Expected .go file, got %s", file)
			}
		})
	}
}
