package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
)

// GetStorePricesRequest represents query parameters for getting store prices
// Note: chainSlug and storeId come from URL path params, not query string
type GetStorePricesRequest struct {
	ChainSlug string `form:"chainSlug" json:"chainSlug"`
	StoreID   string `form:"storeId" json:"storeId"`
	Limit     int    `form:"limit" json:"limit" binding:"min=1,max=500" jsonschema:"minimum=1,maximum=500"`
	Offset    int    `form:"offset" json:"offset" binding:"min=0" jsonschema:"minimum=0"`
}

// StorePrice represents a price entry for a store
type StorePrice struct {
	RetailerItemID    string  `json:"retailerItemId" jsonschema:"required"`
	ItemName          string  `json:"itemName" jsonschema:"required"`
	ItemExternalID    *string `json:"itemExternalId"`
	Brand             *string `json:"brand"`
	Unit              *string `json:"unit"`
	UnitQuantity      *string `json:"unitQuantity"`
	CurrentPrice      *int    `json:"currentPrice"`
	PreviousPrice     *int    `json:"previousPrice"`
	DiscountPrice     *int    `json:"discountPrice"`
	DiscountStart     *string `json:"discountStart"`
	DiscountEnd       *string `json:"discountEnd"`
	InStock           bool    `json:"inStock" jsonschema:"required"`
	UnitPrice         *int    `json:"unitPrice"`
	UnitPriceBaseQty  *string `json:"unitPriceBaseQuantity"`
	UnitPriceBaseUnit *string `json:"unitPriceBaseUnit"`
	LowestPrice30d    *int    `json:"lowestPrice30d"`
	AnchorPrice       *int    `json:"anchorPrice"`
	PriceSignature    *string `json:"priceSignature"`
	LastSeenAt        string  `json:"lastSeenAt" jsonschema:"required"`
}

// GetStorePricesResponse represents the response for store prices
type GetStorePricesResponse struct {
	Prices []StorePrice `json:"prices" jsonschema:"required"`
	Total  int          `json:"total" jsonschema:"required"`
}

// GetStorePrices returns prices for a specific store in a chain
// @Summary Get store prices
// @Description Returns paginated prices for a specific store in a chain
// @Tags prices
// @Accept json
// @Produce json
// @Param chainSlug path string true "Chain slug identifier"
// @Param storeId path string true "Store ID"
// @Param limit query int false "Number of items to return" default(100) minimum(1) maximum(500)
// @Param offset query int false "Number of items to skip" default(0) minimum(0)
// @Success 200 {object} GetStorePricesResponse
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /internal/prices/{chainSlug}/{storeId} [get]
func GetStorePrices(c *gin.Context) {
	chainSlug := c.Param("chainSlug")
	storeID := c.Param("storeId")

	if chainSlug == "" || storeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chainSlug and storeId are required"})
		return
	}

	var req GetStorePricesRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Set defaults
	if req.Limit == 0 {
		req.Limit = 100
	}

	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	// Get total count using sqlc
	total, err := queries.CountStorePrices(ctx, sqlcgen.CountStorePricesParams{
		ID:        storeID,
		ChainSlug: chainSlug,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count prices"})
		return
	}

	// Get prices with pagination using sqlc
	priceRows, err := queries.ListStorePricesWithDetails(ctx, sqlcgen.ListStorePricesWithDetailsParams{
		ID:        storeID,
		ChainSlug: chainSlug,
		Limit:     int32(req.Limit),
		Offset:    int32(req.Offset),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch prices"})
		return
	}

	// Convert sqlc rows to response type
	prices := make([]StorePrice, 0, len(priceRows))
	for _, row := range priceRows {
		// CurrentPrice is always present (int32, not nullable)
		currentPrice := int(row.CurrentPrice)
		price := StorePrice{
			RetailerItemID: row.RetailerItemID,
			ItemName:       row.ItemName,
			LastSeenAt:     row.LastSeenAt,
			CurrentPrice:   &currentPrice,
		}

		// Convert pgtype fields to *string/*int
		if row.ItemExternalID.Valid {
			price.ItemExternalID = &row.ItemExternalID.String
		}
		if row.Brand.Valid {
			price.Brand = &row.Brand.String
		}
		if row.Unit.Valid {
			price.Unit = &row.Unit.String
		}
		if row.UnitQuantity.Valid {
			price.UnitQuantity = &row.UnitQuantity.String
		}
		if row.PreviousPrice.Valid {
			v := int(row.PreviousPrice.Int32)
			price.PreviousPrice = &v
		}
		if row.DiscountPrice.Valid {
			v := int(row.DiscountPrice.Int32)
			price.DiscountPrice = &v
		}
		if row.DiscountStart != "" {
			price.DiscountStart = &row.DiscountStart
		}
		if row.DiscountEnd != "" {
			price.DiscountEnd = &row.DiscountEnd
		}
		if row.InStock.Valid {
			price.InStock = row.InStock.Bool
		}
		if row.UnitPrice.Valid {
			v := int(row.UnitPrice.Int32)
			price.UnitPrice = &v
		}
		if row.UnitPriceBaseQuantity.Valid {
			price.UnitPriceBaseQty = &row.UnitPriceBaseQuantity.String
		}
		if row.UnitPriceBaseUnit.Valid {
			price.UnitPriceBaseUnit = &row.UnitPriceBaseUnit.String
		}
		if row.LowestPrice30d.Valid {
			v := int(row.LowestPrice30d.Int32)
			price.LowestPrice30d = &v
		}
		if row.AnchorPrice.Valid {
			v := int(row.AnchorPrice.Int32)
			price.AnchorPrice = &v
		}
		if row.PriceSignature.Valid {
			price.PriceSignature = &row.PriceSignature.String
		}

		prices = append(prices, price)
	}

	c.JSON(http.StatusOK, GetStorePricesResponse{
		Prices: prices,
		Total:  int(total),
	})
}

// SearchItemsRequest represents query parameters for searching items
type SearchItemsRequest struct {
	Query     string `form:"q" json:"q" binding:"required,min=3" jsonschema:"required,minLength=3"`
	ChainSlug string `form:"chainSlug" json:"chainSlug"`
	Limit     int    `form:"limit" json:"limit" binding:"min=1,max=100" jsonschema:"minimum=1,maximum=100"`
}

// SearchItem represents a search result item
type SearchItem struct {
	ID           string  `json:"id" jsonschema:"required"`
	ChainSlug    string  `json:"chainSlug" jsonschema:"required"`
	ExternalID   *string `json:"externalId"`
	Name         string  `json:"name" jsonschema:"required"`
	Description  *string `json:"description"`
	Brand        *string `json:"brand"`
	Category     *string `json:"category"`
	Subcategory  *string `json:"subcategory"`
	Unit         *string `json:"unit"`
	UnitQuantity *string `json:"unitQuantity"`
	ImageURL     *string `json:"imageUrl"`
	AvgPrice     *int    `json:"avgPrice"`                         // Average price across stores
	StoreCount   int     `json:"storeCount" jsonschema:"required"` // Number of stores with this item
}

// SearchItemsResponse represents the response for item search
type SearchItemsResponse struct {
	Items []SearchItem `json:"items" jsonschema:"required"`
	Total int          `json:"total" jsonschema:"required"`
	Query string       `json:"query" jsonschema:"required"`
}

// SearchItems searches for items by name
// @Summary Search items
// @Description Search for items by name with optional chain filter. Requires minimum 3 characters.
// @Tags items
// @Accept json
// @Produce json
// @Param q query string true "Search query (min 3 chars)" minLength(3)
// @Param chainSlug query string false "Filter by chain slug"
// @Param limit query int false "Number of items to return" default(20) minimum(1) maximum(100)
// @Success 200 {object} SearchItemsResponse
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /internal/items/search [get]
func SearchItems(c *gin.Context) {
	var req SearchItemsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate minimum query length (IMPORTANT: prevents full table scan)
	if len(req.Query) < 3 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Query must be at least 3 characters long",
		})
		return
	}

	// Set default limit
	if req.Limit == 0 {
		req.Limit = 20
	}

	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	// Get total count using sqlc (empty string means no chain filter)
	total, err := queries.CountSearchItems(ctx, sqlcgen.CountSearchItemsParams{
		SearchQuery: req.Query,
		ChainFilter: req.ChainSlug, // empty string = no filter
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count items"})
		return
	}

	// Search items using sqlc
	itemRows, err := queries.SearchItemsWithStats(ctx, sqlcgen.SearchItemsWithStatsParams{
		SearchQuery: req.Query,
		ChainFilter: req.ChainSlug, // empty string = no filter
		ResultLimit: int32(req.Limit),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to search items"})
		return
	}

	// Convert sqlc rows to response type
	items := make([]SearchItem, 0, len(itemRows))
	for _, row := range itemRows {
		item := SearchItem{
			ID:         row.ID,
			ChainSlug:  row.ChainSlug,
			Name:       row.Name,
			StoreCount: int(row.StoreCount),
		}

		// Convert pgtype fields to *string/*int
		if row.ExternalID.Valid {
			item.ExternalID = &row.ExternalID.String
		}
		if row.Description.Valid {
			item.Description = &row.Description.String
		}
		if row.Brand.Valid {
			item.Brand = &row.Brand.String
		}
		if row.Category.Valid {
			item.Category = &row.Category.String
		}
		if row.Subcategory.Valid {
			item.Subcategory = &row.Subcategory.String
		}
		if row.Unit.Valid {
			item.Unit = &row.Unit.String
		}
		if row.UnitQuantity.Valid {
			item.UnitQuantity = &row.UnitQuantity.String
		}
		if row.ImageUrl.Valid {
			item.ImageURL = &row.ImageUrl.String
		}
		if row.AvgPrice != 0 {
			avgPrice := int(row.AvgPrice)
			item.AvgPrice = &avgPrice
		}

		items = append(items, item)
	}

	c.JSON(http.StatusOK, SearchItemsResponse{
		Items: items,
		Total: int(total),
		Query: req.Query,
	})
}


