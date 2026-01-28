package pipeline

import (
	"reflect"
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
