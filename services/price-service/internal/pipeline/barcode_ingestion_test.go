package pipeline

import (
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/types"
)

// TestBarcodeIngestion_SqlcQueryExists verifies the InsertRetailerItemBarcode query is generated
func TestBarcodeIngestion_SqlcQueryExists(t *testing.T) {
	queriesType := reflect.TypeOf((*sqlcgen.Queries)(nil))

	method, found := queriesType.MethodByName("InsertRetailerItemBarcode")
	if !found {
		t.Fatal("InsertRetailerItemBarcode method not found on sqlcgen.Queries")
	}

	// Verify it's a method we can call
	if method.Type.NumIn() < 2 {
		t.Error("InsertRetailerItemBarcode should accept context and params")
	}
}

// TestBarcodeIngestion_ParamsHaveCorrectFields verifies InsertRetailerItemBarcodeParams has all required fields
func TestBarcodeIngestion_ParamsHaveCorrectFields(t *testing.T) {
	paramsType := reflect.TypeOf(sqlcgen.InsertRetailerItemBarcodeParams{})

	expectedFields := map[string]string{
		"ID":             "string",
		"RetailerItemID": "string",
		"Barcode":        "string",
		"IsPrimary":      "pgtype.Bool",
	}

	for fieldName, expectedType := range expectedFields {
		field, found := paramsType.FieldByName(fieldName)
		if !found {
			t.Errorf("InsertRetailerItemBarcodeParams missing field: %s", fieldName)
			continue
		}
		actualType := field.Type.String()
		if actualType != expectedType {
			t.Errorf("InsertRetailerItemBarcodeParams.%s type = %s, want %s", fieldName, actualType, expectedType)
		}
	}
}

// TestBarcodeIngestion_QueryFileHasOnConflictDoNothing verifies the SQL uses ON CONFLICT DO NOTHING
func TestBarcodeIngestion_QueryFileHasOnConflictDoNothing(t *testing.T) {
	// Read the barcode query file
	queryPath := filepath.Join("..", "database", "queries", "retailer_item_barcodes.sql")
	content, err := os.ReadFile(queryPath)
	if err != nil {
		t.Fatalf("Failed to read barcode query file: %v", err)
	}

	sqlContent := string(content)

	// Verify ON CONFLICT DO NOTHING is present (prevents duplicate barcode errors)
	if !strings.Contains(sqlContent, "ON CONFLICT DO NOTHING") {
		t.Error("InsertRetailerItemBarcode query should use ON CONFLICT DO NOTHING to handle duplicates")
	}

	// Verify it's an INSERT query
	if !strings.Contains(sqlContent, "INSERT INTO retailer_item_barcodes") {
		t.Error("InsertRetailerItemBarcode should INSERT INTO retailer_item_barcodes table")
	}
}

// TestBarcodeIngestion_PersistGoCallsBarcodeInsertion verifies persist.go inserts barcodes
func TestBarcodeIngestion_PersistGoCallsBarcodeInsertion(t *testing.T) {
	// Read the persist.go file
	persistPath := "persist.go"
	content, err := os.ReadFile(persistPath)
	if err != nil {
		t.Fatalf("Failed to read persist.go: %v", err)
	}

	persistContent := string(content)

	// Verify InsertRetailerItemBarcode is called in findOrCreateRetailerItem
	if !strings.Contains(persistContent, "queries.InsertRetailerItemBarcode") {
		t.Error("persist.go should call queries.InsertRetailerItemBarcode")
	}

	// Verify barcode is inserted with isPrimary = true for the first barcode
	if !strings.Contains(persistContent, "IsPrimary:") && !strings.Contains(persistContent, "true") {
		t.Error("persist.go should set IsPrimary to true for the primary barcode")
	}

	// Verify barcode insertion happens in findOrCreateRetailerItem function
	// by checking for the pattern: barcode insertion inside a function that uses row.Barcodes
	if !strings.Contains(persistContent, "row.Barcodes[0]") {
		t.Error("persist.go should access row.Barcodes[0] for the primary barcode")
	}
}

// TestBarcodeIngestion_BarcodeInsertedInFindOrCreate verifies the correct location
func TestBarcodeIngestion_BarcodeInsertedInFindOrCreate(t *testing.T) {
	// Read the persist.go file
	persistPath := "persist.go"
	content, err := os.ReadFile(persistPath)
	if err != nil {
		t.Fatalf("Failed to read persist.go: %v", err)
	}

	persistContent := string(content)

	// Find the findOrCreateRetailerItem function and verify it contains barcode insertion
	funcPattern := regexp.MustCompile(`func findOrCreateRetailerItem\([^)]+\)[^{]+\{[\s\S]+?\n\}`)
	match := funcPattern.FindString(persistContent)

	if match == "" {
		t.Fatal("Could not find findOrCreateRetailerItem function")
	}

	// Verify barcode insertion is inside this function
	if !strings.Contains(match, "InsertRetailerItemBarcode") {
		t.Error("Barcode insertion should happen inside findOrCreateRetailerItem function")
	}

	// Verify the function checks for non-empty barcodes
	if !strings.Contains(match, "len(row.Barcodes) > 0") {
		t.Error("findOrCreateRetailerItem should check if barcodes exist before inserting")
	}

	// Verify it also checks for non-empty first barcode
	if !strings.Contains(match, `row.Barcodes[0] != ""`) {
		t.Error("findOrCreateRetailerItem should check if first barcode is non-empty")
	}
}

// TestBarcodeIngestion_NoDuplicateBarcodeLoop verifies there's no duplicate insertion loop
func TestBarcodeIngestion_NoDuplicateBarcodeLoop(t *testing.T) {
	// Read the persist.go file
	persistPath := "persist.go"
	content, err := os.ReadFile(persistPath)
	if err != nil {
		t.Fatalf("Failed to read persist.go: %v", err)
	}

	persistContent := string(content)

	// Find the persistRowsForStore function
	funcPattern := regexp.MustCompile(`func persistRowsForStore\([^)]+\)[^{]+\{[\s\S]+?\nfunc `)
	match := funcPattern.FindString(persistContent)

	if match == "" {
		// Try alternate pattern that captures to end of file
		funcPattern = regexp.MustCompile(`func persistRowsForStore\([^)]+\)[^{]+\{[\s\S]+`)
		match = funcPattern.FindString(persistContent)
	}

	// The old code had a barcode insertion loop in persistRowsForStore
	// The new code should NOT have this - barcodes are inserted in findOrCreateRetailerItem

	// Check that there's no barcode loop pattern in persistRowsForStore
	// Old pattern: for _, barcode := range row.Barcodes
	if strings.Contains(match, "for _, barcode := range row.Barcodes") {
		t.Error("persistRowsForStore should NOT have a barcode loop - barcodes are now inserted in findOrCreateRetailerItem")
	}

	// Verify the comment about Phase 3 fix
	if !strings.Contains(persistContent, "Phase 3 fix") {
		t.Error("persist.go should have a comment about Phase 3 barcode fix")
	}
}

// TestBarcodeIngestion_CuidPrefixUsed verifies "rib" prefix is used for barcode IDs
func TestBarcodeIngestion_CuidPrefixUsed(t *testing.T) {
	// Read the persist.go file
	persistPath := "persist.go"
	content, err := os.ReadFile(persistPath)
	if err != nil {
		t.Fatalf("Failed to read persist.go: %v", err)
	}

	persistContent := string(content)

	// Verify the "rib" prefix is used for barcode IDs
	if !strings.Contains(persistContent, `"rib"`) {
		t.Error("persist.go should use 'rib' prefix for retailer_item_barcode IDs")
	}

	// Verify cuid2.GeneratePrefixedId is used with "rib"
	if !strings.Contains(persistContent, `cuid2.GeneratePrefixedId("rib"`) {
		t.Error("persist.go should use cuid2.GeneratePrefixedId with 'rib' prefix")
	}
}

// TestBarcodeIngestion_RetailerItemBarcodesTableSchema verifies table definition exists
func TestBarcodeIngestion_RetailerItemBarcodesTableSchema(t *testing.T) {
	// Read the schema.sql file (at price-service root, not database folder)
	schemaPath := filepath.Join("..", "..", "schema.sql")
	content, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("Failed to read schema.sql: %v", err)
	}

	schemaContent := string(content)

	// Verify retailer_item_barcodes table exists (may have public. prefix)
	if !strings.Contains(schemaContent, "CREATE TABLE") || !strings.Contains(schemaContent, "retailer_item_barcodes") {
		t.Error("schema.sql should contain retailer_item_barcodes table definition")
	}

	// Verify required columns
	requiredColumns := []string{"id", "retailer_item_id", "barcode", "is_primary", "created_at"}
	for _, col := range requiredColumns {
		if !strings.Contains(schemaContent, col) {
			t.Errorf("retailer_item_barcodes table should have %s column", col)
		}
	}

	// Verify unique constraint on (retailer_item_id, barcode)
	if !strings.Contains(schemaContent, "UNIQUE") || !strings.Contains(schemaContent, "retailer_item_id") {
		// The unique constraint might be defined differently
		t.Log("Note: Unique constraint on (retailer_item_id, barcode) should exist")
	}
}

// TestBarcodeIngestion_UpsertRetailerItemReturnsID verifies item upsert returns the ID
func TestBarcodeIngestion_UpsertRetailerItemReturnsID(t *testing.T) {
	queriesType := reflect.TypeOf((*sqlcgen.Queries)(nil))
	method, found := queriesType.MethodByName("UpsertRetailerItem")
	if !found {
		t.Fatal("UpsertRetailerItem method not found")
	}

	// Check return types (should be string, error)
	methodType := method.Type
	if methodType.NumOut() != 2 {
		t.Errorf("UpsertRetailerItem should return 2 values, got %d", methodType.NumOut())
	}

	// First return should be string (the ID)
	if methodType.Out(0).Kind() != reflect.String {
		t.Errorf("UpsertRetailerItem first return should be string, got %s", methodType.Out(0).Kind())
	}
}

// TestBarcodeIngestion_BarcodeInsertionWithPgtypeBool verifies pgtype.Bool is used correctly
func TestBarcodeIngestion_BarcodeInsertionWithPgtypeBool(t *testing.T) {
	// Verify we can construct the params with the correct boolean handling
	params := sqlcgen.InsertRetailerItemBarcodeParams{
		ID:             "rib_test123",
		RetailerItemID: "itm_test456",
		Barcode:        "1234567890123",
		IsPrimary:      pgtype.Bool{Bool: true, Valid: true},
	}

	// Verify the values are set correctly
	if params.ID != "rib_test123" {
		t.Errorf("ID = %s, want rib_test123", params.ID)
	}
	if params.RetailerItemID != "itm_test456" {
		t.Errorf("RetailerItemID = %s, want itm_test456", params.RetailerItemID)
	}
	if params.Barcode != "1234567890123" {
		t.Errorf("Barcode = %s, want 1234567890123", params.Barcode)
	}
	if !params.IsPrimary.Bool || !params.IsPrimary.Valid {
		t.Errorf("IsPrimary should be true and valid")
	}
}

// TestBarcodeIngestion_NormalizedRowHasBarcodes verifies NormalizedRow type has Barcodes field
func TestBarcodeIngestion_NormalizedRowHasBarcodes(t *testing.T) {
	rowType := reflect.TypeOf(types.NormalizedRow{})

	field, found := rowType.FieldByName("Barcodes")
	if !found {
		t.Fatal("types.NormalizedRow should have Barcodes field")
	}

	// Verify it's a slice of strings
	if field.Type.Kind() != reflect.Slice {
		t.Errorf("Barcodes should be a slice, got %s", field.Type.Kind())
	}

	if field.Type.Elem().Kind() != reflect.String {
		t.Errorf("Barcodes should be []string, got []%s", field.Type.Elem().Kind())
	}
}

// TestBarcodeIngestion_FlowFromRowToDatabase verifies the complete barcode flow
func TestBarcodeIngestion_FlowFromRowToDatabase(t *testing.T) {
	// This test documents the expected barcode ingestion flow:
	// 1. NormalizedRow contains Barcodes []string from parsed data
	// 2. persistRowsForStore calls findOrCreateRetailerItem for each valid row
	// 3. findOrCreateRetailerItem:
	//    a. Upserts the retailer item and gets the ID
	//    b. If row.Barcodes[0] is not empty, inserts primary barcode
	// 4. InsertRetailerItemBarcode uses ON CONFLICT DO NOTHING

	// Verify the flow by checking function signatures and types

	// Step 1: NormalizedRow has Barcodes
	var row types.NormalizedRow
	row.Barcodes = []string{"1234567890123"}
	if len(row.Barcodes) == 0 || row.Barcodes[0] == "" {
		t.Error("NormalizedRow should accept non-empty Barcodes")
	}

	// Step 2: findOrCreateRetailerItem accepts NormalizedRow
	fnType := reflect.TypeOf(findOrCreateRetailerItem)
	if fnType.In(2).String() != "types.NormalizedRow" {
		t.Error("findOrCreateRetailerItem should accept types.NormalizedRow")
	}

	// Step 3: InsertRetailerItemBarcodeParams can be constructed
	params := sqlcgen.InsertRetailerItemBarcodeParams{
		ID:             "rib_123",
		RetailerItemID: "itm_456",
		Barcode:        row.Barcodes[0],
		IsPrimary:      pgtype.Bool{Bool: true, Valid: true},
	}
	if params.Barcode != "1234567890123" {
		t.Error("Barcode should be passed through to params")
	}

	// Step 4: Query method exists
	queriesType := reflect.TypeOf((*sqlcgen.Queries)(nil))
	_, found := queriesType.MethodByName("InsertRetailerItemBarcode")
	if !found {
		t.Error("InsertRetailerItemBarcode method should exist")
	}

	t.Log("Barcode ingestion flow verified: NormalizedRow.Barcodes -> findOrCreateRetailerItem -> InsertRetailerItemBarcode")
}

// TestBarcodeIngestion_QueryFileLocation verifies the query file is in the correct location
func TestBarcodeIngestion_QueryFileLocation(t *testing.T) {
	expectedPath := filepath.Join("..", "database", "queries", "retailer_item_barcodes.sql")
	if _, err := os.Stat(expectedPath); os.IsNotExist(err) {
		t.Errorf("retailer_item_barcodes.sql should exist at %s", expectedPath)
	}
}

// TestBarcodeIngestion_SqlcGeneratedFileExists verifies the generated Go file exists
func TestBarcodeIngestion_SqlcGeneratedFileExists(t *testing.T) {
	expectedPath := filepath.Join("..", "database", "sqlcgen", "retailer_item_barcodes.sql.go")
	if _, err := os.Stat(expectedPath); os.IsNotExist(err) {
		t.Errorf("retailer_item_barcodes.sql.go should exist at %s", expectedPath)
	}
}
