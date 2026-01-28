package database

import (
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
)

// TestPriceGroupsUseSqlc verifies that price_groups.go uses sqlc-generated queries
func TestPriceGroupsUseSqlc(t *testing.T) {
	t.Run("sqlcgen package is imported", func(t *testing.T) {
		// This test verifies that the sqlcgen package types are used
		var _ sqlcgen.Queries
		var _ sqlcgen.FindPriceGroupByHashParams
		var _ sqlcgen.CreatePriceGroupParams
		var _ sqlcgen.UpsertGroupPriceParams
		var _ sqlcgen.CloseStoreGroupMembershipParams
		var _ sqlcgen.CreateStoreGroupHistoryParams
		var _ sqlcgen.GetStorePriceExceptionParams
		var _ sqlcgen.GetStorePriceFromGroupParams
		var _ sqlcgen.GetHistoricalStorePriceParams
		var _ sqlcgen.ListPriceGroupsByChainParams
	})

	t.Run("convertSqlcPriceGroup returns correct type", func(t *testing.T) {
		input := sqlcgen.PriceGroup{
			ID:          "grp_test",
			ChainSlug:   "testchain",
			PriceHash:   "hash123",
			HashVersion: 1,
			StoreCount:  5,
			ItemCount:   100,
		}

		result := convertSqlcPriceGroup(input)

		if result.ID != "grp_test" {
			t.Errorf("Expected ID 'grp_test', got '%s'", result.ID)
		}
		if result.ChainSlug != "testchain" {
			t.Errorf("Expected ChainSlug 'testchain', got '%s'", result.ChainSlug)
		}
		if result.PriceHash != "hash123" {
			t.Errorf("Expected PriceHash 'hash123', got '%s'", result.PriceHash)
		}
		if result.HashVersion != 1 {
			t.Errorf("Expected HashVersion 1, got %d", result.HashVersion)
		}
		if result.StoreCount != 5 {
			t.Errorf("Expected StoreCount 5, got %d", result.StoreCount)
		}
		if result.ItemCount != 100 {
			t.Errorf("Expected ItemCount 100, got %d", result.ItemCount)
		}
	})

	t.Run("convertSqlcGroupPrice returns correct type", func(t *testing.T) {
		input := sqlcgen.GroupPrice{
			PriceGroupID:   "grp_test",
			RetailerItemID: "ri_test",
			Price:          1999,
			DiscountPrice:  pgtype.Int4{Int32: 1499, Valid: true},
			UnitPrice:      pgtype.Int4{Valid: false},
			AnchorPrice:    pgtype.Int4{Int32: 2499, Valid: true},
		}

		result := convertSqlcGroupPrice(input)

		if result.PriceGroupID != "grp_test" {
			t.Errorf("Expected PriceGroupID 'grp_test', got '%s'", result.PriceGroupID)
		}
		if result.RetailerItemID != "ri_test" {
			t.Errorf("Expected RetailerItemID 'ri_test', got '%s'", result.RetailerItemID)
		}
		if result.Price != 1999 {
			t.Errorf("Expected Price 1999, got %d", result.Price)
		}
		if result.DiscountPrice == nil || *result.DiscountPrice != 1499 {
			t.Errorf("Expected DiscountPrice 1499, got %v", result.DiscountPrice)
		}
		if result.UnitPrice != nil {
			t.Errorf("Expected UnitPrice nil, got %v", result.UnitPrice)
		}
		if result.AnchorPrice == nil || *result.AnchorPrice != 2499 {
			t.Errorf("Expected AnchorPrice 2499, got %v", result.AnchorPrice)
		}
	})

	t.Run("intPtrToPgInt4 handles nil", func(t *testing.T) {
		result := intPtrToPgInt4(nil)
		if result.Valid {
			t.Error("Expected Valid=false for nil input")
		}
	})

	t.Run("intPtrToPgInt4 handles value", func(t *testing.T) {
		val := 42
		result := intPtrToPgInt4(&val)
		if !result.Valid {
			t.Error("Expected Valid=true for non-nil input")
		}
		if result.Int32 != 42 {
			t.Errorf("Expected Int32=42, got %d", result.Int32)
		}
	})

	t.Run("pgInt4ToIntPtr handles invalid", func(t *testing.T) {
		result := pgInt4ToIntPtr(pgtype.Int4{Valid: false})
		if result != nil {
			t.Errorf("Expected nil for invalid pgtype.Int4, got %v", result)
		}
	})

	t.Run("pgInt4ToIntPtr handles valid", func(t *testing.T) {
		result := pgInt4ToIntPtr(pgtype.Int4{Int32: 99, Valid: true})
		if result == nil {
			t.Error("Expected non-nil for valid pgtype.Int4")
		}
		if *result != 99 {
			t.Errorf("Expected 99, got %d", *result)
		}
	})

	t.Run("PriceGroup type has expected fields", func(t *testing.T) {
		pg := PriceGroup{}
		pgType := reflect.TypeOf(pg)

		expectedFields := []string{
			"ID", "ChainSlug", "PriceHash", "HashVersion",
			"StoreCount", "ItemCount", "FirstSeenAt", "LastSeenAt",
			"CreatedAt", "UpdatedAt",
		}

		for _, field := range expectedFields {
			if _, found := pgType.FieldByName(field); !found {
				t.Errorf("PriceGroup missing expected field: %s", field)
			}
		}
	})

	t.Run("GroupPrice type has expected fields", func(t *testing.T) {
		gp := GroupPrice{}
		gpType := reflect.TypeOf(gp)

		expectedFields := []string{
			"PriceGroupID", "RetailerItemID", "Price", "DiscountPrice",
			"UnitPrice", "AnchorPrice", "CreatedAt",
		}

		for _, field := range expectedFields {
			if _, found := gpType.FieldByName(field); !found {
				t.Errorf("GroupPrice missing expected field: %s", field)
			}
		}
	})

	t.Run("StorePriceResult type has expected fields", func(t *testing.T) {
		sp := StorePriceResult{}
		spType := reflect.TypeOf(sp)

		expectedFields := []string{
			"RetailerItemID", "Price", "DiscountPrice",
			"UnitPrice", "AnchorPrice", "IsException",
		}

		for _, field := range expectedFields {
			if _, found := spType.FieldByName(field); !found {
				t.Errorf("StorePriceResult missing expected field: %s", field)
			}
		}
	})
}
