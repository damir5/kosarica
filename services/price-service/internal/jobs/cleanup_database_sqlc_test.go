package jobs

import (
	"os"
	"strings"
	"testing"
)

// TestCleanupDatabaseUsesSqlc verifies that cleanup_database.go uses sqlc for database operations
func TestCleanupDatabaseUsesSqlc(t *testing.T) {
	content, err := os.ReadFile("cleanup_database.go")
	if err != nil {
		t.Fatalf("Failed to read cleanup_database.go: %v", err)
	}

	source := string(content)

	// Verify sqlcgen import exists
	if !strings.Contains(source, `"github.com/kosarica/price-service/internal/database/sqlcgen"`) {
		t.Error("cleanup_database.go should import sqlcgen package")
	}

	// Verify DeleteExpiredPriceExceptions is used
	if !strings.Contains(source, "DeleteExpiredPriceExceptions") {
		t.Error("cleanup_database.go should use DeleteExpiredPriceExceptions")
	}

	// Verify DeleteOrphanGroupPrices is used
	if !strings.Contains(source, "DeleteOrphanGroupPrices") {
		t.Error("cleanup_database.go should use DeleteOrphanGroupPrices")
	}

	// Verify DeleteOrphanPriceGroups is used
	if !strings.Contains(source, "DeleteOrphanPriceGroups") {
		t.Error("cleanup_database.go should use DeleteOrphanPriceGroups")
	}
}

// TestCleanupDatabaseNoRawSqlDELETE verifies raw SQL DELETE statements are removed
func TestCleanupDatabaseNoRawSqlDELETE(t *testing.T) {
	content, err := os.ReadFile("cleanup_database.go")
	if err != nil {
		t.Fatalf("Failed to read cleanup_database.go: %v", err)
	}

	source := string(content)

	// Verify raw SQL DELETE is not used
	if strings.Contains(source, "DELETE FROM store_price_exceptions") {
		t.Error("cleanup_database.go should not contain raw SQL DELETE FROM store_price_exceptions")
	}

	if strings.Contains(source, "DELETE FROM group_prices") {
		t.Error("cleanup_database.go should not contain raw SQL DELETE FROM group_prices")
	}

	if strings.Contains(source, "DELETE FROM price_groups") {
		t.Error("cleanup_database.go should not contain raw SQL DELETE FROM price_groups")
	}
}

// TestCleanupDatabaseSqlcQueriesCreation verifies sqlcgen.New is used
func TestCleanupDatabaseSqlcQueriesCreation(t *testing.T) {
	content, err := os.ReadFile("cleanup_database.go")
	if err != nil {
		t.Fatalf("Failed to read cleanup_database.go: %v", err)
	}

	source := string(content)

	if !strings.Contains(source, "sqlcgen.New(pool)") {
		t.Error("cleanup_database.go should create sqlc queries with sqlcgen.New(pool)")
	}
}

// TestCleanupDatabasePgtypeUsage verifies pgtype is used for timestamp conversion
func TestCleanupDatabasePgtypeUsage(t *testing.T) {
	content, err := os.ReadFile("cleanup_database.go")
	if err != nil {
		t.Fatalf("Failed to read cleanup_database.go: %v", err)
	}

	source := string(content)

	// Verify pgtype import exists
	if !strings.Contains(source, `"github.com/jackc/pgx/v5/pgtype"`) {
		t.Error("cleanup_database.go should import pgtype package")
	}

	// Verify pgtype.Timestamp is used for time conversion
	if !strings.Contains(source, "pgtype.Timestamp") {
		t.Error("cleanup_database.go should use pgtype.Timestamp for time conversion")
	}
}

// TestSqlcDeleteMethodsExist verifies the sqlc methods exist in generated code
func TestSqlcDeleteMethodsExist(t *testing.T) {
	content, err := os.ReadFile("../database/sqlcgen/price_groups.sql.go")
	if err != nil {
		t.Fatalf("Failed to read price_groups.sql.go: %v", err)
	}

	source := string(content)

	methods := []string{
		"func (q *Queries) DeleteExpiredPriceExceptions",
		"func (q *Queries) DeleteOrphanGroupPrices",
		"func (q *Queries) DeleteOrphanPriceGroups",
	}

	for _, method := range methods {
		if !strings.Contains(source, method) {
			t.Errorf("%s method should exist in sqlcgen", method)
		}
	}
}
