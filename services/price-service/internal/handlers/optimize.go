package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/kosarica/price-service/internal/optimizer"
)

// ============================================================================
// Basket Optimization Endpoints
// ============================================================================

// BasketItem represents an item in the optimization basket
type BasketItem struct {
	ItemID   string `json:"itemId" binding:"required"`
	Name     string `json:"name" binding:"required"`
	Quantity int    `json:"quantity" binding:"required,min=1"`
}

// Location represents a geographic location
type Location struct {
	Latitude  float64 `json:"latitude" binding:"required,min=-90,max=90"`
	Longitude float64 `json:"longitude" binding:"required,min=-180,max=180"`
}

// OptimizeRequest represents the basket optimization request
type OptimizeRequest struct {
	ChainSlug  string       `json:"chainSlug" binding:"required"`
	BasketItems []*BasketItem `json:"basketItems" binding:"required,min=1,max=100"`
	Location    *Location    `json:"location,omitempty"`
	MaxDistance float64      `json:"maxDistance,omitempty"`
	MaxStores   int          `json:"maxStores,omitempty"`
}

// MissingItem represents an item not available at a store
type MissingItem struct {
	ItemID     string `json:"itemId"`
	ItemName   string `json:"itemName"`
	Penalty    int64  `json:"penalty"`
	IsOptional bool   `json:"isOptional"`
}

// ItemPriceInfo contains price information for an item
type ItemPriceInfo struct {
	ItemID         string `json:"itemId"`
	ItemName       string `json:"itemName"`
	Quantity       int    `json:"quantity"`
	BasePrice      int64  `json:"basePrice"`
	EffectivePrice int64  `json:"effectivePrice"`
	HasDiscount    bool   `json:"hasDiscount"`
	DiscountPrice  *int64 `json:"discountPrice,omitempty"`
	LineTotal      int64  `json:"lineTotal"`
}

// SingleStoreResult represents the optimization result for a single store
type SingleStoreResult struct {
	StoreID       string        `json:"storeId"`
	CoverageRatio float64       `json:"coverageRatio"`
	CoverageBin   int           `json:"coverageBin"`
	SortingTotal  int64         `json:"sortingTotal"`
	RealTotal     int64         `json:"realTotal"`
	MissingItems  []*MissingItem `json:"missingItems,omitempty"`
	Items         []*ItemPriceInfo `json:"items,omitempty"`
	Distance      float64       `json:"distance"`
}

// StoreAllocation represents a store in a multi-store optimization
type StoreAllocation struct {
	StoreID    string          `json:"storeId"`
	Items      []*ItemPriceInfo `json:"items"`
	StoreTotal int64           `json:"storeTotal"`
	Distance   float64         `json:"distance"`
	VisitOrder int             `json:"visitOrder"`
}

// MultiStoreResult represents the optimization result across multiple stores
type MultiStoreResult struct {
	Stores          []*StoreAllocation `json:"stores"`
	CombinedTotal   int64              `json:"combinedTotal"`
	CoverageRatio   float64            `json:"coverageRatio"`
	UnassignedItems []*MissingItem     `json:"unassignedItems,omitempty"`
	AlgorithmUsed   string             `json:"algorithmUsed"`
}

// Global optimizer instances (initialized by the application)
var (
	singleStoreOptimizer *optimizer.SingleStoreOptimizer
	multiStoreOptimizer  *optimizer.MultiStoreOptimizer
	priceCache           *optimizer.PriceCache
	optimizerConfig      *optimizer.OptimizerConfig
)

// InitOptimizers initializes the optimizer instances
// This should be called during application startup
func InitOptimizers(cache *optimizer.PriceCache, config *optimizer.OptimizerConfig, metrics *optimizer.MetricsRecorder) {
	priceCache = cache
	optimizerConfig = config
	singleStoreOptimizer = optimizer.NewSingleStoreOptimizer(cache, config, metrics)
	multiStoreOptimizer = optimizer.NewMultiStoreOptimizer(cache, config, metrics)
}

// GetPriceCache returns the price cache instance
func GetPriceCache() *optimizer.PriceCache {
	return priceCache
}

// OptimizeSingle handles single-store basket optimization
// POST /internal/basket/optimize/single
func OptimizeSingle(c *gin.Context) {
	var req OptimizeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Convert request to internal format
	basketItems := make([]*optimizer.BasketItem, len(req.BasketItems))
	for i, item := range req.BasketItems {
		basketItems[i] = &optimizer.BasketItem{
			ItemID:   item.ItemID,
			Name:     item.Name,
			Quantity: item.Quantity,
		}
	}

	optimizeReq := &optimizer.OptimizeRequest{
		ChainSlug:   req.ChainSlug,
		BasketItems: basketItems,
		Location:    nil,
		MaxDistance: req.MaxDistance,
		MaxStores:   req.MaxStores,
	}

	if req.Location != nil {
		optimizeReq.Location = &optimizer.Location{
			Latitude:  req.Location.Latitude,
			Longitude: req.Location.Longitude,
		}
	}

	// Check if cache is healthy
	if priceCache == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Cache not initialized"})
		return
	}

	if !priceCache.IsHealthy(c.Request.Context()) {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Cache unavailable or stale"})
		return
	}

	// Run optimization
	results, err := singleStoreOptimizer.Optimize(c.Request.Context(), optimizeReq)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Convert results to response format
	response := make([]*SingleStoreResult, len(results))
	for i, r := range results {
		missingItems := make([]*MissingItem, len(r.MissingItems))
		for j, m := range r.MissingItems {
			missingItems[j] = &MissingItem{
				ItemID:     m.ItemID,
				ItemName:   m.ItemName,
				Penalty:    m.Penalty,
				IsOptional: m.IsOptional,
			}
		}

		items := make([]*ItemPriceInfo, len(r.Items))
		for j, item := range r.Items {
			items[j] = &ItemPriceInfo{
				ItemID:         item.ItemID,
				ItemName:       item.ItemName,
				Quantity:       item.Quantity,
				BasePrice:      item.BasePrice,
				EffectivePrice: item.EffectivePrice,
				HasDiscount:    item.HasDiscount,
				LineTotal:      item.LineTotal,
			}
			if item.DiscountPrice != nil {
				items[j].DiscountPrice = item.DiscountPrice
			}
		}

		response[i] = &SingleStoreResult{
			StoreID:       r.StoreID,
			CoverageRatio: r.CoverageRatio,
			CoverageBin:   int(r.CoverageBin),
			SortingTotal:  r.SortingTotal,
			RealTotal:     r.RealTotal,
			MissingItems:  missingItems,
			Items:         items,
			Distance:      r.Distance,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"results": response,
		"total":   len(response),
	})
}

// OptimizeMulti handles multi-store basket optimization
// POST /internal/basket/optimize/multi
func OptimizeMulti(c *gin.Context) {
	var req OptimizeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate multi-store specific constraints
	if req.MaxStores <= 0 {
		req.MaxStores = 5 // Default max stores
	}
	if req.MaxStores > 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "maxStores cannot exceed 10"})
		return
	}

	// Convert request to internal format
	basketItems := make([]*optimizer.BasketItem, len(req.BasketItems))
	for i, item := range req.BasketItems {
		basketItems[i] = &optimizer.BasketItem{
			ItemID:   item.ItemID,
			Name:     item.Name,
			Quantity: item.Quantity,
		}
	}

	optimizeReq := &optimizer.OptimizeRequest{
		ChainSlug:   req.ChainSlug,
		BasketItems: basketItems,
		Location:    nil,
		MaxDistance: req.MaxDistance,
		MaxStores:   req.MaxStores,
	}

	if req.Location != nil {
		optimizeReq.Location = &optimizer.Location{
			Latitude:  req.Location.Latitude,
			Longitude: req.Location.Longitude,
		}
	}

	// Check if cache is healthy
	if priceCache == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Cache not initialized"})
		return
	}

	if !priceCache.IsHealthy(c.Request.Context()) {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Cache unavailable or stale"})
		return
	}

	// Run optimization
	result, err := multiStoreOptimizer.Optimize(c.Request.Context(), optimizeReq)
	if err != nil {
		// Check for timeout
		if err.Error() == "context deadline exceeded" {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Optimization timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Convert result to response format
	stores := make([]*StoreAllocation, len(result.Stores))
	for i, s := range result.Stores {
		items := make([]*ItemPriceInfo, len(s.Items))
		for j, item := range s.Items {
			items[j] = &ItemPriceInfo{
				ItemID:         item.ItemID,
				ItemName:       item.ItemName,
				Quantity:       item.Quantity,
				BasePrice:      item.BasePrice,
				EffectivePrice: item.EffectivePrice,
				HasDiscount:    item.HasDiscount,
				LineTotal:      item.LineTotal,
			}
			if item.DiscountPrice != nil {
				items[j].DiscountPrice = item.DiscountPrice
			}
		}

		stores[i] = &StoreAllocation{
			StoreID:    s.StoreID,
			Items:      items,
			StoreTotal: s.StoreTotal,
			Distance:   s.Distance,
			VisitOrder: s.VisitOrder,
		}
	}

	unassignedItems := make([]*MissingItem, len(result.UnassignedItems))
	for i, u := range result.UnassignedItems {
		unassignedItems[i] = &MissingItem{
			ItemID:     u.ItemID,
			ItemName:   u.ItemName,
			Penalty:    u.Penalty,
			IsOptional: u.IsOptional,
		}
	}

	response := &MultiStoreResult{
		Stores:          stores,
		CombinedTotal:   result.CombinedTotal,
		CoverageRatio:   result.CoverageRatio,
		UnassignedItems: unassignedItems,
		AlgorithmUsed:   result.AlgorithmUsed,
	}

	c.JSON(http.StatusOK, response)
}

// CacheWarmup handles cache warmup requests
// POST /internal/basket/cache/warmup
func CacheWarmup(c *gin.Context) {
	if priceCache == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Cache not initialized"})
		return
	}

	err := priceCache.Warmup(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to warm up cache: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
		"message": "Cache warmed up successfully",
	})
}

// CacheRefresh handles cache refresh requests for a specific chain
// POST /internal/basket/cache/refresh/:chainSlug
func CacheRefresh(c *gin.Context) {
	chainSlug := c.Param("chainSlug")
	if chainSlug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chainSlug is required"})
		return
	}

	if priceCache == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Cache not initialized"})
		return
	}

	err := priceCache.RefreshChain(c.Request.Context(), chainSlug)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refresh cache: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
		"message": "Chain cache refreshed successfully",
		"chainSlug": chainSlug,
	})
}

// CacheHealth handles cache health check requests
// GET /internal/basket/cache/health
func CacheHealth(c *gin.Context) {
	if priceCache == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status": "error",
			"message": "Cache not initialized",
		})
		return
	}

	freshness := priceCache.GetFreshness(c.Request.Context())

	chains := make([]gin.H, 0, len(freshness))
	for chain, info := range freshness {
		chains = append(chains, gin.H{
			"chainSlug": chain,
			"loadedAt":  info.LoadedAt,
			"isStale":   info.IsStale,
			"estimatedMB": info.EstimatedMB,
		})
	}

	isHealthy := priceCache.IsHealthy(c.Request.Context())
	status := "ok"
	if !isHealthy {
		status = "degraded"
	}

	c.JSON(http.StatusOK, gin.H{
		"status": status,
		"chains": chains,
	})
}
