package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/kosarica/price-service/internal/database"
)

// GetStorePricesRequest represents query parameters for getting store prices
type GetStorePricesRequest struct {
	ChainSlug string `form:"chainSlug" binding:"required"`
	StoreID   string `form:"storeId" binding:"required"`
	Limit     int    `form:"limit" binding:"min=1,max=500"`
	Offset    int    `form:"offset" binding:"min=0"`
}

// StorePrice represents a price entry for a store
type StorePrice struct {
	RetailerItemID   string `json:"retailerItemId"`
	ItemName         string `json:"itemName"`
	ItemExternalID   *string `json:"itemExternalId"`
	Brand            *string `json:"brand"`
	Unit             *string `json:"unit"`
	UnitQuantity     *string `json:"unitQuantity"`
	CurrentPrice     *int   `json:"currentPrice"`
	PreviousPrice    *int   `json:"previousPrice"`
	DiscountPrice    *int   `json:"discountPrice"`
	DiscountStart    *string `json:"discountStart"`
	DiscountEnd      *string `json:"discountEnd"`
	InStock          bool   `json:"inStock"`
	UnitPrice        *int   `json:"unitPrice"`
	UnitPriceBaseQty  *string `json:"unitPriceBaseQuantity"`
	UnitPriceBaseUnit *string `json:"unitPriceBaseUnit"`
	LowestPrice30d   *int   `json:"lowestPrice30d"`
	AnchorPrice      *int   `json:"anchorPrice"`
	PriceSignature   *string `json:"priceSignature"`
	LastSeenAt       string `json:"lastSeenAt"`
}

// GetStorePricesResponse represents the response for store prices
type GetStorePricesResponse struct {
	Prices []StorePrice `json:"prices"`
	Total  int          `json:"total"`
}

// GetStorePrices returns prices for a specific store in a chain
// GET /internal/prices/:chainSlug/:storeId?limit=100&offset=0
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

	pool := database.Pool()
	ctx := c.Request.Context()

	// Get total count
	var total int
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM store_item_state sis
		JOIN retailer_items ri ON sis.retailer_item_id = ri.id
		JOIN stores s ON sis.store_id = s.id
		WHERE s.id = $1 AND s.chain_slug = $2
	`, storeID, chainSlug).Scan(&total)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count prices"})
		return
	}

	// Get prices with pagination
	query := `
		SELECT
			ri.id as retailer_item_id,
			ri.name as item_name,
			ri.external_id as item_external_id,
			ri.brand,
			ri.unit,
			ri.unit_quantity,
			sis.current_price,
			sis.previous_price,
			sis.discount_price,
			TO_CHAR(sis.discount_start, 'YYYY-MM-DD HH24:MI:SS') as discount_start,
			TO_CHAR(sis.discount_end, 'YYYY-MM-DD HH24:MI:SS') as discount_end,
			sis.in_stock,
			sis.unit_price,
			sis.unit_price_base_quantity,
			sis.unit_price_base_unit,
			sis.lowest_price_30d,
			sis.anchor_price,
			sis.price_signature,
			TO_CHAR(sis.last_seen_at, 'YYYY-MM-DD HH24:MI:SS') as last_seen_at
		FROM store_item_state sis
		JOIN retailer_items ri ON sis.retailer_item_id = ri.id
		JOIN stores s ON sis.store_id = s.id
		WHERE s.id = $1 AND s.chain_slug = $2
		ORDER BY ri.name
		LIMIT $3 OFFSET $4
	`

	rows, err := pool.Query(ctx, query, storeID, chainSlug, req.Limit, req.Offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch prices"})
		return
	}
	defer rows.Close()

	prices := []StorePrice{}
	for rows.Next() {
		var price StorePrice
		err := rows.Scan(
			&price.RetailerItemID, &price.ItemName, &price.ItemExternalID,
			&price.Brand, &price.Unit, &price.UnitQuantity,
			&price.CurrentPrice, &price.PreviousPrice, &price.DiscountPrice,
			&price.DiscountStart, &price.DiscountEnd, &price.InStock,
			&price.UnitPrice, &price.UnitPriceBaseQty, &price.UnitPriceBaseUnit,
			&price.LowestPrice30d, &price.AnchorPrice, &price.PriceSignature,
			&price.LastSeenAt,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan price"})
			return
		}
		prices = append(prices, price)
	}

	if rows.Err() != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error iterating prices"})
		return
	}

	c.JSON(http.StatusOK, GetStorePricesResponse{
		Prices: prices,
		Total:  total,
	})
}

// SearchItemsRequest represents query parameters for searching items
type SearchItemsRequest struct {
	Query     string `form:"q" binding:"required,min=3"`
	ChainSlug string `form:"chainSlug"`
	Limit     int    `form:"limit" binding:"min=1,max=100"`
}

// SearchItem represents a search result item
type SearchItem struct {
	ID            string  `json:"id"`
	ChainSlug     string  `json:"chainSlug"`
	ExternalID    *string `json:"externalId"`
	Name          string  `json:"name"`
	Description   *string `json:"description"`
	Brand         *string `json:"brand"`
	Category      *string `json:"category"`
	Subcategory   *string `json:"subcategory"`
	Unit          *string `json:"unit"`
	UnitQuantity  *string `json:"unitQuantity"`
	ImageURL      *string `json:"imageUrl"`
	AvgPrice      *int    `json:"avgPrice"`      // Average price across stores
	StoreCount    int     `json:"storeCount"`    // Number of stores with this item
}

// SearchItemsResponse represents the response for item search
type SearchItemsResponse struct {
	Items  []SearchItem `json:"items"`
	Total  int          `json:"total"`
	Query  string       `json:"query"`
}

// SearchItems searches for items by name
// GET /internal/items/search?q=&chainSlug=&limit=20
// MUST require minimum 3 chars for ILIKE queries to prevent full table scan
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

	pool := database.Pool()
	ctx := c.Request.Context()

	// Build query with dynamic chain filter
	countQuery := `
		SELECT COUNT(DISTINCT ri.id)
		FROM retailer_items ri
		WHERE 1=1
	`
	searchQuery := `
		SELECT DISTINCT
			ri.id,
			ri.chain_slug,
			ri.external_id,
			ri.name,
			ri.description,
			ri.brand,
			ri.category,
			ri.subcategory,
			ri.unit,
			ri.unit_quantity,
			ri.image_url,
			AVG(sis.current_price) as avg_price,
			COUNT(DISTINCT sis.store_id) as store_count
		FROM retailer_items ri
		LEFT JOIN store_item_state sis ON ri.id = sis.retailer_item_id
		WHERE 1=1
	`

	args := []interface{}{}
	argIdx := 1

	if req.ChainSlug != "" {
		countQuery += " AND ri.chain_slug = $" + strconv.Itoa(argIdx)
		searchQuery += " AND ri.chain_slug = $" + strconv.Itoa(argIdx)
		args = append(args, req.ChainSlug)
		argIdx++
	}

	// Add search term with ILIKE
	countQuery += " AND LENGTH($" + strconv.Itoa(argIdx) + ") >= 3 AND ri.name ILIKE $" + strconv.Itoa(argIdx+1)
	searchQuery += " AND LENGTH($" + strconv.Itoa(argIdx) + ") >= 3 AND ri.name ILIKE $" + strconv.Itoa(argIdx+1)
	args = append(args, req.Query, "%"+req.Query+"%")
	argIdx += 2

	searchQuery += " GROUP BY ri.id, ri.chain_slug, ri.external_id, ri.name, ri.description, ri.brand, ri.category, ri.subcategory, ri.unit, ri.unit_quantity, ri.image_url"
	searchQuery += " ORDER BY ri.name"
	searchQuery += " LIMIT $" + strconv.Itoa(argIdx)
	args = append(args, req.Limit)

	// Get total count
	var total int
	err := pool.QueryRow(ctx, countQuery, args[:len(args)-1]...).Scan(&total)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count items"})
		return
	}

	// Search items
	rows, err := pool.Query(ctx, searchQuery, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to search items"})
		return
	}
	defer rows.Close()

	items := []SearchItem{}
	for rows.Next() {
		var item SearchItem
		err := rows.Scan(
			&item.ID, &item.ChainSlug, &item.ExternalID, &item.Name,
			&item.Description, &item.Brand, &item.Category, &item.Subcategory,
			&item.Unit, &item.UnitQuantity, &item.ImageURL,
			&item.AvgPrice, &item.StoreCount,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan item"})
			return
		}
		items = append(items, item)
	}

	if rows.Err() != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error iterating items"})
		return
	}

	c.JSON(http.StatusOK, SearchItemsResponse{
		Items:  items,
		Total:  total,
		Query:  req.Query,
	})
}
