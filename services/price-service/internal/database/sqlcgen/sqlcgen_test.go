package sqlcgen_test

import (
	"reflect"
	"testing"

	"github.com/kosarica/price-service/internal/database/sqlcgen"
)

// TestQueriesInterfaceExists verifies that the Queries struct exists
func TestQueriesInterfaceExists(t *testing.T) {
	queriesType := reflect.TypeOf((*sqlcgen.Queries)(nil))
	if queriesType == nil {
		t.Error("Queries type does not exist")
	}
}

// TestStoresQueriesExist verifies that store-related query methods exist
func TestStoresQueriesExist(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	requiredMethods := []string{
		"GetStoreByIdentifier",
		"CreateStore",
		"CreateStoreIdentifier",
	}

	for _, method := range requiredMethods {
		_, found := queriesType.MethodByName(method)
		if !found {
			t.Errorf("Method %s not found on Queries type", method)
		}
	}
}

// TestRetailerItemsQueriesExist verifies that retailer item query methods exist
func TestRetailerItemsQueriesExist(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	requiredMethods := []string{
		"GetRetailerItemByExternalId",
		"UpdateRetailerItem",
		"UpsertRetailerItem",
		"UpdateRetailerItemsArchiveId",
		"GetRetailerItemDetails",
		"GetRetailerItemName",
	}

	for _, method := range requiredMethods {
		_, found := queriesType.MethodByName(method)
		if !found {
			t.Errorf("Method %s not found on Queries type", method)
		}
	}
}

// TestRetailerItemBarcodesQueriesExist verifies that barcode query methods exist
func TestRetailerItemBarcodesQueriesExist(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	requiredMethods := []string{
		"InsertRetailerItemBarcode",
	}

	for _, method := range requiredMethods {
		_, found := queriesType.MethodByName(method)
		if !found {
			t.Errorf("Method %s not found on Queries type", method)
		}
	}
}

// TestStoreItemStateQueriesExist verifies that store item state query methods exist
func TestStoreItemStateQueriesExist(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	requiredMethods := []string{
		"GetStorePreviousPrice",
		"UpsertStoreItemState",
	}

	for _, method := range requiredMethods {
		_, found := queriesType.MethodByName(method)
		if !found {
			t.Errorf("Method %s not found on Queries type", method)
		}
	}
}

// TestPriceGroupsQueriesExist verifies that price group query methods exist
func TestPriceGroupsQueriesExist(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	requiredMethods := []string{
		"FindPriceGroupByHash",
		"CreatePriceGroup",
		"UpsertGroupPrice",
		"UpdatePriceGroupItemCount",
		"GetCurrentStoreGroupId",
		"CloseStoreGroupMembership",
		"CreateStoreGroupHistory",
		"DecrementPriceGroupStoreCount",
		"IncrementPriceGroupStoreCount",
		"GetStorePriceException",
		"GetStorePriceFromGroup",
		"GetHistoricalStorePrice",
		"UpdatePriceGroupLastSeen",
		"DeleteExpiredPriceExceptions",
		"GetPriceGroupById",
		"ListGroupPrices",
		"ListStorePricesViaGroup",
		"ListPriceGroupsByChain",
		"CountPriceGroupsByChain",
		"DeleteOrphanGroupPrices",
		"DeleteOrphanPriceGroups",
	}

	for _, method := range requiredMethods {
		_, found := queriesType.MethodByName(method)
		if !found {
			t.Errorf("Method %s not found on Queries type", method)
		}
	}
}

// TestArchivesQueriesExist verifies that archive query methods exist
func TestArchivesQueriesExist(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	requiredMethods := []string{
		"UpsertArchive",
		"GetArchiveByChecksum",
		"GetArchiveById",
		"ListArchivesByChain",
		"LinkArchiveToRun",
	}

	for _, method := range requiredMethods {
		_, found := queriesType.MethodByName(method)
		if !found {
			t.Errorf("Method %s not found on Queries type", method)
		}
	}
}

// TestPricesQueriesExist verifies that price query methods exist
func TestPricesQueriesExist(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	requiredMethods := []string{
		"CountStorePrices",
		"ListStorePricesWithDetails",
	}

	for _, method := range requiredMethods {
		_, found := queriesType.MethodByName(method)
		if !found {
			t.Errorf("Method %s not found on Queries type", method)
		}
	}
}

// TestRunsQueriesExist verifies that run query methods exist
func TestRunsQueriesExist(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	requiredMethods := []string{
		"GetIngestionRunById",
		"GetRunChainSlug",
		"CreateRerunRun",
		"CreateReprocessingRun",
		"CheckRunExists",
		"DeleteIngestionErrors",
		"DeleteIngestionFiles",
		"DeleteIngestionRun",
		"GetRunStats",
	}

	for _, method := range requiredMethods {
		_, found := queriesType.MethodByName(method)
		if !found {
			t.Errorf("Method %s not found on Queries type", method)
		}
	}
}

// TestFilesQueriesExist verifies that file query methods exist
func TestFilesQueriesExist(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	requiredMethods := []string{
		"CountIngestionFiles",
		"ListIngestionFiles",
		"CreateIngestionFile",
		"UpdateIngestionFileCompleted",
	}

	for _, method := range requiredMethods {
		_, found := queriesType.MethodByName(method)
		if !found {
			t.Errorf("Method %s not found on Queries type", method)
		}
	}
}

// TestErrorsQueriesExist verifies that error query methods exist
func TestErrorsQueriesExist(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	requiredMethods := []string{
		"CountIngestionErrors",
		"ListIngestionErrors",
		"CountErrorsByDateRange",
	}

	for _, method := range requiredMethods {
		_, found := queriesType.MethodByName(method)
		if !found {
			t.Errorf("Method %s not found on Queries type", method)
		}
	}
}

// TestFailedRowsQueriesExist verifies that failed row query methods exist
func TestFailedRowsQueriesExist(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	requiredMethods := []string{
		"CountFailedRows",
		"ListFailedRows",
		"UpdateFailedRowNotes",
		"GetFailedRowsForReprocessing",
		"MarkRowAsReprocessed",
		"CreateFailedRow",
	}

	for _, method := range requiredMethods {
		_, found := queriesType.MethodByName(method)
		if !found {
			t.Errorf("Method %s not found on Queries type", method)
		}
	}
}

// TestErrorSummaryQueriesExist verifies that error summary query methods exist
func TestErrorSummaryQueriesExist(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	requiredMethods := []string{
		"GetErrorSummaryByChain",
	}

	for _, method := range requiredMethods {
		_, found := queriesType.MethodByName(method)
		if !found {
			t.Errorf("Method %s not found on Queries type", method)
		}
	}
}

// TestPipelineQueriesExist verifies that pipeline query methods exist
func TestPipelineQueriesExist(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	requiredMethods := []string{
		"UpdateRunStartedAt",
		"UpdateRunTotalFiles",
		"UpdateRunCompleted",
		"UpdateRunInterrupted",
		"UpdateRunFailed",
		"IncrementRunProcessedFiles",
		"IncrementRunProcessedEntries",
		"GetRunProgressInfo",
	}

	for _, method := range requiredMethods {
		_, found := queriesType.MethodByName(method)
		if !found {
			t.Errorf("Method %s not found on Queries type", method)
		}
	}
}

// TestIngestionQueriesExist verifies that ingestion query methods exist
func TestIngestionQueriesExist(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	requiredMethods := []string{
		"CreateIngestionRun",
		"GetIngestionRun",
		"UpdateIngestionRunStatus",
		"UpdateIngestionRunFailed",
		"ListIngestionRuns",
		"ListIngestionRunsByChain",
	}

	for _, method := range requiredMethods {
		_, found := queriesType.MethodByName(method)
		if !found {
			t.Errorf("Method %s not found on Queries type", method)
		}
	}
}

// TestTaskQueueQueriesExist verifies that task queue query methods exist
func TestTaskQueueQueriesExist(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	requiredMethods := []string{
		"ScheduleTask",
		"GetTask",
		"UpdateTaskStatus",
		"SetTaskProcessing",
		"CancelTask",
		"ListPendingTasks",
		"ListTasksByStatus",
		"CountTasksByStatus",
	}

	for _, method := range requiredMethods {
		_, found := queriesType.MethodByName(method)
		if !found {
			t.Errorf("Method %s not found on Queries type", method)
		}
	}
}

// TestNewQueriesFunction verifies that the New function exists and works
func TestNewQueriesFunction(t *testing.T) {
	// Just verify the function exists and has the right signature
	var _ func(sqlcgen.DBTX) *sqlcgen.Queries = sqlcgen.New
}

// TestWithTxMethod verifies that the WithTx method exists
func TestWithTxMethod(t *testing.T) {
	var queries *sqlcgen.Queries
	queriesType := reflect.TypeOf(queries)

	_, found := queriesType.MethodByName("WithTx")
	if !found {
		t.Error("WithTx method not found on Queries type")
	}
}
