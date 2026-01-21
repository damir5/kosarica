package optimizer

import (
	"context"
	"sort"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// SingleStoreOptimizer implements coverage-first ranking for single store optimization.
type SingleStoreOptimizer struct {
	priceSource PriceSource
	config      *OptimizerConfig
	metrics     *MetricsRecorder
	logger      zerolog.Logger
}

// NewSingleStoreOptimizer creates a new single-store optimizer.
func NewSingleStoreOptimizer(priceSource PriceSource, config *OptimizerConfig) *SingleStoreOptimizer {
	return &SingleStoreOptimizer{
		priceSource: priceSource,
		config:      config,
		metrics:     NewMetricsRecorder(),
		logger:      log.With().Str("component", "single_store_optimizer").Logger(),
	}
}

// Optimize finds the best single stores for a basket using coverage-first ranking.
func (o *SingleStoreOptimizer) Optimize(ctx context.Context, req *OptimizeRequest) ([]*SingleStoreResult, error) {
	startTime := time.Now()
	defer func() {
		o.metrics.RecordOptimizationDuration("single", time.Since(startTime))
	}()

	// Validate request
	if err := req.Validate(o.config.MaxBasketItems); err != nil {
		return nil, err
	}

	o.metrics.RecordBasketSize(len(req.BasketItems))

	// Get candidate stores
	var candidateStores []string
	var distances map[string]float64

	// If location provided, find nearest stores first
	if req.Location != nil {
		maxDist := req.MaxDistance
		if maxDist == 0 {
			maxDist = o.config.MaxDistanceKm // Default limit if not specified
		}

		// Use GetNearestStores with a large limit to get all relevant stores with distances
		// We'll filter by distance ourselves if needed, or rely on GetNearestStores
		nearby := o.priceSource.GetNearestStores(
			req.ChainSlug,
			req.Location.Latitude,
			req.Location.Longitude,
			maxDist,
			1000, // Reasonable upper bound for single chain stores in radius
		)

		candidateStores = make([]string, 0, len(nearby))
		distances = make(map[string]float64, len(nearby))

		for _, s := range nearby {
			candidateStores = append(candidateStores, s.StoreID)
			distances[s.StoreID] = s.Distance
		}
	} else {
		// No location, consider all stores in chain
		candidateStores = o.priceSource.GetStoreIDs(req.ChainSlug)
	}

	if len(candidateStores) == 0 {
		return []*SingleStoreResult{}, nil
	}

	o.metrics.RecordCandidateCount("single", len(candidateStores))

	// Calculate results for each store
	results := make([]*SingleStoreResult, 0, len(candidateStores))
	for _, storeID := range candidateStores {
		// Check context cancellation
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		result := o.calculateStoreResult(req, storeID)

		// Add distance info if available
		if distances != nil {
			if d, ok := distances[storeID]; ok {
				result.Distance = d
			}
		}

		results = append(results, result)
	}

	// Sort by coverage bin (descending), then by sorting total (ascending)
	sortResults(results)

	// Record coverage ratio of best result
	if len(results) > 0 {
		o.metrics.RecordCoverageRatio(results[0].CoverageRatio)
	}

	// Limit results (e.g. top 50)
	limit := 50
	if len(results) > limit {
		results = results[:limit]
	}

	return results, nil
}

// calculateStoreResult computes the optimization result for a single store.
func (o *SingleStoreOptimizer) calculateStoreResult(req *OptimizeRequest, storeID string) *SingleStoreResult {
	result := &SingleStoreResult{
		StoreID:      storeID,
		Items:        make([]*ItemPriceInfo, 0, len(req.BasketItems)),
		MissingItems: make([]*MissingItem, 0),
	}

	foundCount := 0
	sortingTotal := int64(0)
	realTotal := int64(0)

	for _, item := range req.BasketItems {
		price, ok := o.priceSource.GetPrice(req.ChainSlug, storeID, item.ItemID)
		if !ok {
			// Item not available at this store
			penalty := o.calculatePenalty(req.ChainSlug, item.ItemID)
			result.MissingItems = append(result.MissingItems, &MissingItem{
				ItemID:     item.ItemID,
				ItemName:   item.Name,
				Penalty:    penalty,
				IsOptional: false,
			})
			sortingTotal += penalty * int64(item.Quantity)
			continue
		}

		// Item is available
		foundCount++
		effectivePrice := GetEffectivePrice(price)

		itemInfo := &ItemPriceInfo{
			ItemID:         item.ItemID,
			ItemName:       item.Name,
			Quantity:       item.Quantity,
			BasePrice:      price.Price,
			EffectivePrice: effectivePrice,
			HasDiscount:    price.HasDiscount,
			LineTotal:      effectivePrice * int64(item.Quantity),
		}

		if price.HasDiscount {
			itemInfo.DiscountPrice = &price.DiscountPrice
		}

		result.Items = append(result.Items, itemInfo)
		sortingTotal += itemInfo.LineTotal
		realTotal += itemInfo.LineTotal
	}

	// Calculate coverage ratio
	if len(req.BasketItems) > 0 {
		result.CoverageRatio = float64(foundCount) / float64(len(req.BasketItems))
	} else {
		result.CoverageRatio = 0
	}

	result.CoverageBin = CoverageBinFromRatio(result.CoverageRatio)
	result.SortingTotal = sortingTotal
	result.RealTotal = realTotal

	return result
}

// calculatePenalty computes the penalty for a missing item using chain average.
func (o *SingleStoreOptimizer) calculatePenalty(chainSlug, itemID string) int64 {
	avgPrice := o.priceSource.GetAveragePrice(chainSlug, itemID)
	if avgPrice == 0 {
		// Use fallback if no average available
		return o.config.MissingItemFallback
	}
	return int64(float64(avgPrice) * o.config.MissingItemPenaltyMult)
}

// sortResults sorts optimization results by coverage bin (descending),
// then by sorting total (ascending), then by distance (ascending),
// then by store ID (ascending).
func sortResults(results []*SingleStoreResult) {
	sort.Slice(results, func(i, j int) bool {
		a, b := results[i], results[j]

		// 1. Coverage Bin (higher is better)
		if a.CoverageBin != b.CoverageBin {
			return a.CoverageBin > b.CoverageBin
		}

		// 2. Sorting Total (lower is better)
		if a.SortingTotal != b.SortingTotal {
			return a.SortingTotal < b.SortingTotal
		}

		// 3. Distance (lower is better)
		// Only if both have distance. If one is 0 (unknown), prefer known distance?
		// Assuming 0 means unknown/far.
		if a.Distance != b.Distance {
			if a.Distance > 0 && b.Distance > 0 {
				return a.Distance < b.Distance
			}
			// Prefer the one with distance info
			return a.Distance > 0
		}

		// 4. Tie-breaker: store ID (for determinism)
		return a.StoreID < b.StoreID
	})
}
