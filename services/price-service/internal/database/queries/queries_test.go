package queries_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestSqlcQueryFilesExist verifies that all required query files have been created
func TestSqlcQueryFilesExist(t *testing.T) {
	requiredFiles := []string{
		"stores.sql",
		"retailer_items.sql",
		"retailer_item_barcodes.sql",
		"store_item_state.sql",
		"price_groups.sql",
		"archives.sql",
		"prices.sql",
		"runs.sql",
		"files.sql",
		"errors.sql",
		"failed_rows.sql",
		"error_summary.sql",
		"pipeline.sql",
		"ingestion.sql",
		"taskqueue.sql",
	}

	queriesDir := "."
	for _, file := range requiredFiles {
		path := filepath.Join(queriesDir, file)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			t.Errorf("Required query file does not exist: %s", file)
		}
	}
}

// TestStoresQueryFileContents verifies stores.sql contains required queries
func TestStoresQueryFileContents(t *testing.T) {
	content, err := os.ReadFile("stores.sql")
	if err != nil {
		t.Fatalf("Failed to read stores.sql: %v", err)
	}

	requiredQueries := []string{
		"-- name: GetStoreByIdentifier :one",
		"-- name: CreateStore :exec",
		"-- name: CreateStoreIdentifier :exec",
	}

	for _, query := range requiredQueries {
		if !strings.Contains(string(content), query) {
			t.Errorf("stores.sql missing query: %s", query)
		}
	}
}

// TestRetailerItemsQueryFileContents verifies retailer_items.sql contains required queries
func TestRetailerItemsQueryFileContents(t *testing.T) {
	content, err := os.ReadFile("retailer_items.sql")
	if err != nil {
		t.Fatalf("Failed to read retailer_items.sql: %v", err)
	}

	requiredQueries := []string{
		"-- name: GetRetailerItemByExternalId :one",
		"-- name: UpdateRetailerItem :exec",
		"-- name: UpsertRetailerItem :exec",
		"-- name: UpdateRetailerItemsArchiveId :exec",
		"-- name: GetRetailerItemDetails :one",
		"-- name: GetRetailerItemName :one",
	}

	for _, query := range requiredQueries {
		if !strings.Contains(string(content), query) {
			t.Errorf("retailer_items.sql missing query: %s", query)
		}
	}
}

// TestRetailerItemBarcodesQueryFileContents verifies retailer_item_barcodes.sql contains required queries
func TestRetailerItemBarcodesQueryFileContents(t *testing.T) {
	content, err := os.ReadFile("retailer_item_barcodes.sql")
	if err != nil {
		t.Fatalf("Failed to read retailer_item_barcodes.sql: %v", err)
	}

	requiredQueries := []string{
		"-- name: InsertRetailerItemBarcode :exec",
	}

	for _, query := range requiredQueries {
		if !strings.Contains(string(content), query) {
			t.Errorf("retailer_item_barcodes.sql missing query: %s", query)
		}
	}
}

// TestStoreItemStateQueryFileContents verifies store_item_state.sql contains required queries
func TestStoreItemStateQueryFileContents(t *testing.T) {
	content, err := os.ReadFile("store_item_state.sql")
	if err != nil {
		t.Fatalf("Failed to read store_item_state.sql: %v", err)
	}

	requiredQueries := []string{
		"-- name: GetStorePreviousPrice :one",
		"-- name: UpsertStoreItemState :exec",
	}

	for _, query := range requiredQueries {
		if !strings.Contains(string(content), query) {
			t.Errorf("store_item_state.sql missing query: %s", query)
		}
	}
}

// TestPriceGroupsQueryFileContents verifies price_groups.sql contains required queries
func TestPriceGroupsQueryFileContents(t *testing.T) {
	content, err := os.ReadFile("price_groups.sql")
	if err != nil {
		t.Fatalf("Failed to read price_groups.sql: %v", err)
	}

	requiredQueries := []string{
		"-- name: FindPriceGroupByHash :one",
		"-- name: CreatePriceGroup :one",
		"-- name: UpsertGroupPrice :exec",
		"-- name: UpdatePriceGroupItemCount :exec",
		"-- name: GetCurrentStoreGroupId :one",
		"-- name: CloseStoreGroupMembership :exec",
		"-- name: CreateStoreGroupHistory :exec",
		"-- name: DecrementPriceGroupStoreCount :exec",
		"-- name: IncrementPriceGroupStoreCount :exec",
		"-- name: GetStorePriceException :one",
		"-- name: GetStorePriceFromGroup :one",
		"-- name: GetHistoricalStorePrice :one",
		"-- name: UpdatePriceGroupLastSeen :exec",
		"-- name: DeleteExpiredPriceExceptions :execrows",
		"-- name: GetPriceGroupById :one",
		"-- name: ListGroupPrices :many",
		"-- name: ListStorePricesViaGroup :many",
		"-- name: ListPriceGroupsByChain :many",
		"-- name: CountPriceGroupsByChain :one",
		"-- name: DeleteOrphanGroupPrices :exec",
		"-- name: DeleteOrphanPriceGroups :execrows",
	}

	for _, query := range requiredQueries {
		if !strings.Contains(string(content), query) {
			t.Errorf("price_groups.sql missing query: %s", query)
		}
	}
}

// TestArchivesQueryFileContents verifies archives.sql contains required queries
func TestArchivesQueryFileContents(t *testing.T) {
	content, err := os.ReadFile("archives.sql")
	if err != nil {
		t.Fatalf("Failed to read archives.sql: %v", err)
	}

	requiredQueries := []string{
		"-- name: UpsertArchive :exec",
		"-- name: GetArchiveByChecksum :one",
		"-- name: GetArchiveById :one",
		"-- name: ListArchivesByChain :many",
		"-- name: LinkArchiveToRun :exec",
	}

	for _, query := range requiredQueries {
		if !strings.Contains(string(content), query) {
			t.Errorf("archives.sql missing query: %s", query)
		}
	}
}

// TestPricesQueryFileContents verifies prices.sql contains required queries
func TestPricesQueryFileContents(t *testing.T) {
	content, err := os.ReadFile("prices.sql")
	if err != nil {
		t.Fatalf("Failed to read prices.sql: %v", err)
	}

	requiredQueries := []string{
		"-- name: CountStorePrices :one",
		"-- name: ListStorePricesWithDetails :many",
	}

	for _, query := range requiredQueries {
		if !strings.Contains(string(content), query) {
			t.Errorf("prices.sql missing query: %s", query)
		}
	}
}

// TestRunsQueryFileContents verifies runs.sql contains required queries
func TestRunsQueryFileContents(t *testing.T) {
	content, err := os.ReadFile("runs.sql")
	if err != nil {
		t.Fatalf("Failed to read runs.sql: %v", err)
	}

	requiredQueries := []string{
		"-- name: GetIngestionRunById :one",
		"-- name: GetRunChainSlug :one",
		"-- name: CreateRerunRun :exec",
		"-- name: CreateReprocessingRun :exec",
		"-- name: CheckRunExists :one",
		"-- name: DeleteIngestionErrors :exec",
		"-- name: DeleteIngestionFiles :exec",
		"-- name: DeleteIngestionRun :exec",
		"-- name: GetRunStats :one",
	}

	for _, query := range requiredQueries {
		if !strings.Contains(string(content), query) {
			t.Errorf("runs.sql missing query: %s", query)
		}
	}
}

// TestFilesQueryFileContents verifies files.sql contains required queries
func TestFilesQueryFileContents(t *testing.T) {
	content, err := os.ReadFile("files.sql")
	if err != nil {
		t.Fatalf("Failed to read files.sql: %v", err)
	}

	requiredQueries := []string{
		"-- name: CountIngestionFiles :one",
		"-- name: ListIngestionFiles :many",
		"-- name: CreateIngestionFile :exec",
		"-- name: UpdateIngestionFileCompleted :exec",
	}

	for _, query := range requiredQueries {
		if !strings.Contains(string(content), query) {
			t.Errorf("files.sql missing query: %s", query)
		}
	}
}

// TestErrorsQueryFileContents verifies errors.sql contains required queries
func TestErrorsQueryFileContents(t *testing.T) {
	content, err := os.ReadFile("errors.sql")
	if err != nil {
		t.Fatalf("Failed to read errors.sql: %v", err)
	}

	requiredQueries := []string{
		"-- name: CountIngestionErrors :one",
		"-- name: ListIngestionErrors :many",
		"-- name: CountErrorsByDateRange :one",
	}

	for _, query := range requiredQueries {
		if !strings.Contains(string(content), query) {
			t.Errorf("errors.sql missing query: %s", query)
		}
	}
}

// TestFailedRowsQueryFileContents verifies failed_rows.sql contains required queries
func TestFailedRowsQueryFileContents(t *testing.T) {
	content, err := os.ReadFile("failed_rows.sql")
	if err != nil {
		t.Fatalf("Failed to read failed_rows.sql: %v", err)
	}

	requiredQueries := []string{
		"-- name: CountFailedRows :one",
		"-- name: ListFailedRows :many",
		"-- name: UpdateFailedRowNotes :one",
		"-- name: GetFailedRowsForReprocessing :many",
		"-- name: MarkRowAsReprocessed :exec",
		"-- name: CreateFailedRow :exec",
	}

	for _, query := range requiredQueries {
		if !strings.Contains(string(content), query) {
			t.Errorf("failed_rows.sql missing query: %s", query)
		}
	}
}

// TestErrorSummaryQueryFileContents verifies error_summary.sql contains required queries
func TestErrorSummaryQueryFileContents(t *testing.T) {
	content, err := os.ReadFile("error_summary.sql")
	if err != nil {
		t.Fatalf("Failed to read error_summary.sql: %v", err)
	}

	requiredQueries := []string{
		"-- name: GetErrorSummaryByChain :many",
	}

	for _, query := range requiredQueries {
		if !strings.Contains(string(content), query) {
			t.Errorf("error_summary.sql missing query: %s", query)
		}
	}
}

// TestPipelineQueryFileContents verifies pipeline.sql contains required queries
func TestPipelineQueryFileContents(t *testing.T) {
	content, err := os.ReadFile("pipeline.sql")
	if err != nil {
		t.Fatalf("Failed to read pipeline.sql: %v", err)
	}

	requiredQueries := []string{
		"-- name: UpdateRunStartedAt :exec",
		"-- name: UpdateRunTotalFiles :exec",
		"-- name: UpdateRunCompleted :exec",
		"-- name: UpdateRunInterrupted :exec",
		"-- name: UpdateRunFailed :exec",
		"-- name: IncrementRunProcessedFiles :exec",
		"-- name: IncrementRunProcessedEntries :exec",
		"-- name: GetRunProgressInfo :one",
	}

	for _, query := range requiredQueries {
		if !strings.Contains(string(content), query) {
			t.Errorf("pipeline.sql missing query: %s", query)
		}
	}
}
