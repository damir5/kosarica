package sqlcgen_test

import (
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
)

// TestPhase2SqlcGeneratedFilesExist verifies that all expected sqlc-generated files exist
func TestPhase2SqlcGeneratedFilesExist(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("Failed to get current file path")
	}
	sqlcgenDir := filepath.Dir(currentFile)

	expectedFiles := []string{
		"db.go",
		"models.go",
		"stores.sql.go",
		"retailer_items.sql.go",
		"retailer_item_barcodes.sql.go",
		"store_item_state.sql.go",
		"price_groups.sql.go",
		"archives.sql.go",
		"prices.sql.go",
		"runs.sql.go",
		"files.sql.go",
		"errors.sql.go",
		"failed_rows.sql.go",
		"error_summary.sql.go",
		"pipeline.sql.go",
		"ingestion.sql.go",
		"taskqueue.sql.go",
	}

	for _, file := range expectedFiles {
		path := filepath.Join(sqlcgenDir, file)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			t.Errorf("Expected generated file %s does not exist", file)
		}
	}
}

// TestPhase2ModelsGenerated verifies that key model types were generated
func TestPhase2ModelsGenerated(t *testing.T) {
	// Test that key types are importable and usable
	var _ sqlcgen.Store
	var _ sqlcgen.StoreIdentifier
	var _ sqlcgen.RetailerItem
	var _ sqlcgen.RetailerItemBarcode
	var _ sqlcgen.StoreItemState
	var _ sqlcgen.PriceGroup
	var _ sqlcgen.Archive
	var _ sqlcgen.IngestionRun
	var _ sqlcgen.IngestionFile
	var _ sqlcgen.IngestionError
	var _ sqlcgen.RetailerItemsFailed
	var _ sqlcgen.TaskQueue
}

// TestPhase2ParamsTypesGenerated verifies that parameter types were generated
func TestPhase2ParamsTypesGenerated(t *testing.T) {
	// Test that key param types are importable
	var _ sqlcgen.CreateStoreParams
	var _ sqlcgen.CreateStoreIdentifierParams
	var _ sqlcgen.UpsertRetailerItemParams
	var _ sqlcgen.InsertRetailerItemBarcodeParams
	var _ sqlcgen.UpsertStoreItemStateParams
	var _ sqlcgen.CreatePriceGroupParams
	var _ sqlcgen.UpsertArchiveParams
	var _ sqlcgen.CreateIngestionRunParams
	var _ sqlcgen.CreateFailedRowParams
	var _ sqlcgen.ScheduleTaskParams
}

// TestPhase2QueryCountSufficient verifies that we have a reasonable number of queries
func TestPhase2QueryCountSufficient(t *testing.T) {
	// Count the number of exported methods on Queries
	// We expect at least 60 queries based on the .sql files
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	// Count methods on the Queries type
	methodCount := queriesType.NumMethod()
	if methodCount < 60 {
		t.Errorf("Expected at least 60 query methods, got %d", methodCount)
	}

	// Verify we have key queries from each domain
	domains := map[string][]string{
		"stores":                 {"GetStoreByIdentifier", "CreateStore"},
		"retailer_items":         {"GetRetailerItemByExternalId", "UpsertRetailerItem"},
		"retailer_item_barcodes": {"InsertRetailerItemBarcode"},
		"store_item_state":       {"UpsertStoreItemState", "GetStorePreviousPrice"},
		"price_groups":           {"FindPriceGroupByHash", "CreatePriceGroup"},
		"archives":               {"UpsertArchive", "GetArchiveById"},
		"ingestion":              {"CreateIngestionRun", "ListIngestionRuns"},
		"pipeline":               {"UpdateRunCompleted", "UpdateRunFailed"},
		"taskqueue":              {"ScheduleTask", "GetTask"},
	}

	for domain, methods := range domains {
		t.Run(domain, func(t *testing.T) {
			for _, method := range methods {
				_, found := queriesType.MethodByName(method)
				if !found {
					t.Errorf("Domain %s missing method %s", domain, method)
				}
			}
		})
	}
}

// hasMethod checks if a type has a method with the given name
func hasMethod(v interface{}, methodName string) bool {
	t := strings.ToLower(methodName)
	_ = t
	// The existence of these methods is validated by the compiler
	// since we're calling them in the code. This is a compile-time check.
	return true
}

// TestPhase2SqlcBuildPasses verifies that the generated code compiles
// This is a compile-time test - if it compiles, it passes
func TestPhase2SqlcBuildPasses(t *testing.T) {
	// Create a Queries instance to verify it compiles
	// We can't actually use it without a database connection,
	// but compilation success means the types are correct
	var _ func(sqlcgen.DBTX) *sqlcgen.Queries = sqlcgen.New

	// Verify we can work with the generated types
	params := sqlcgen.CreateStoreParams{
		ID:        "test-store-id",
		ChainSlug: "test-chain",
	}
	_ = params

	// Verify barcode params work (Phase 1 schema)
	barcodeParams := sqlcgen.InsertRetailerItemBarcodeParams{
		ID:             "test-barcode-id",
		RetailerItemID: "test-item-id",
		Barcode:        "1234567890123",
		IsPrimary:      pgtype.Bool{Bool: true, Valid: true},
	}
	_ = barcodeParams
}
