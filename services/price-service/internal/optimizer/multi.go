package optimizer

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"
)

// MultiStoreOptimizer implements multi-store basket optimization.
// It combines a greedy algorithm (always fast) with an optimal algorithm
// (with timeout) to find the best combination of stores.
type MultiStoreOptimizer struct {
	priceSource PriceSource
	config      *OptimizerConfig
	metrics     *MetricsRecorder
}

// NewMultiStoreOptimizer creates a new multi-store optimizer.
func NewMultiStoreOptimizer(priceSource PriceSource, config *OptimizerConfig, metrics *MetricsRecorder) *MultiStoreOptimizer {
	if metrics == nil {
		metrics = NewMetricsRecorder()
	}
	return &MultiStoreOptimizer{
		priceSource: priceSource,
		config:      config,
		metrics:     metrics,
	}
}

// Optimize finds the optimal combination of stores for a basket.
// It attempts the optimal algorithm first with a timeout, falling back
// to greedy if the timeout is exceeded or if the problem is too large.
func (o *MultiStoreOptimizer) Optimize(ctx context.Context, req *OptimizeRequest) (*MultiStoreResult, error) {
	startTime := time.Now()
	algorithmUsed := "greedy"

	defer func() {
		duration := time.Since(startTime).Seconds()
		o.metrics.RecordOptimization("multi_store_"+algorithmUsed, duration, duration >= 1.0)
	}()

	// Validate request
	if err := req.Validate(o.config.MaxBasketItems); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	// Record metrics
	o.metrics.RecordBasketSize(len(req.BasketItems))

	// Select candidate stores
	candidates := o.selectCandidates(ctx, req)
	if len(candidates) == 0 {
		return nil, fmt.Errorf("no candidate stores found for chain %s", req.ChainSlug)
	}

	o.metrics.RecordCandidateCount("multi_store", len(candidates))

	var result *MultiStoreResult
	var err error

	// Try optimal algorithm for small problems
	// Only attempt optimal if: basket <= 10 items AND candidates <= 15 stores
	shouldTryOptimal := len(req.BasketItems) <= 10 && len(candidates) <= 15

	if shouldTryOptimal {
		optCtx, cancel := context.WithTimeout(ctx, time.Duration(o.config.OptimalTimeoutMs)*time.Millisecond)
		defer cancel()

		result, err = o.optimalAlgorithm(optCtx, req, candidates)
		if err == nil {
			algorithmUsed = "optimal"
			return result, nil
		}
		if err == context.DeadlineExceeded {
			// Timeout is expected - fall back to greedy
			algorithmUsed = "greedy_timeout_fallback"
		} else {
			return nil, fmt.Errorf("optimal algorithm failed: %w", err)
		}
	}

	// Use greedy algorithm
	result, err = o.greedyAlgorithm(ctx, req, candidates)
	if err != nil {
		return nil, fmt.Errorf("greedy algorithm failed: %w", err)
	}

	result.AlgorithmUsed = algorithmUsed
	return result, nil
}

// selectCandidates selects candidate stores for multi-store optimization.
// It combines:
// 1. Top N cheapest stores with coverage >= 0.8
// 2. Top M nearest stores
// Returns up to MaxCandidates unique stores.
func (o *MultiStoreOptimizer) selectCandidates(ctx context.Context, req *OptimizeRequest) []*candidateStore {
	// Build a map for store price evaluation
	allStores := o.getAllStoreIDs(ctx, req.ChainSlug)
	if len(allStores) == 0 {
		return nil
	}

	// Evaluate all stores for coverage and price
	storeResults := make([]*storeEvaluation, 0, len(allStores))
	for _, storeID := range allStores {
		eval := o.evaluateStore(ctx, req, storeID)
		storeResults = append(storeResults, eval)
	}

	// Sort by total cost (ascending) for cheapest selection
	sortByCost := func(results []*storeEvaluation) {
		sort.Slice(results, func(i, j int) bool {
			// First sort by coverage bin (higher is better)
			if results[i].coverageBin != results[j].coverageBin {
				return results[i].coverageBin > results[j].coverageBin
			}
			// Then by total cost (lower is better)
			return results[i].totalCost < results[j].totalCost
		})
	}

	sortByCost(storeResults)

	// Select top cheapest stores with coverage >= 0.8 (CoverageBin >= Medium)
	cheapestSet := make(map[string]*storeEvaluation)
	for _, eval := range storeResults {
		if len(cheapestSet) >= o.config.TopCheapestStores {
			break
		}
		if eval.coverageBin >= int(CoverageBinMedium) {
			cheapestSet[eval.storeID] = eval
		}
	}

	// Select top nearest stores (if location provided)
	nearestSet := make(map[string]*storeEvaluation)
	if req.Location != nil {
		nearestStores := o.priceSource.GetNearestStores(
			req.ChainSlug,
			req.Location.Latitude,
			req.Location.Longitude,
			o.config.MaxDistanceKm,
			o.config.TopNearestStores,
		)

		for _, ns := range nearestStores {
			if len(nearestSet) >= o.config.TopNearestStores {
				break
			}
			// Find the store evaluation for this store
			for _, eval := range storeResults {
				if eval.storeID == ns.StoreID {
					nearestSet[eval.storeID] = eval
					eval.distance = ns.Distance
					break
				}
			}
		}
	}

	// Combine sets, removing duplicates
	combinedSet := make(map[string]*storeEvaluation)
	for _, eval := range cheapestSet {
		combinedSet[eval.storeID] = eval
	}
	for _, eval := range nearestSet {
		combinedSet[eval.storeID] = eval
	}

	// Convert to slice and limit
	candidates := make([]*candidateStore, 0, len(combinedSet))
	for _, eval := range combinedSet {
		candidates = append(candidates, &candidateStore{
			storeID:      eval.storeID,
			totalCost:    eval.totalCost,
			coverageBin:  eval.coverageBin,
			itemPrices:   eval.itemPrices,
			missingItems: eval.missingItems,
			distance:     eval.distance,
		})
		if len(candidates) >= o.config.MaxCandidates {
			break
		}
	}

	return candidates
}

// greedyAlgorithm implements a greedy approach to multi-store optimization.
// For each item, it assigns it to the store with the lowest effective price.
// Then it runs a coverage post-pass to assign any remaining items.
func (o *MultiStoreOptimizer) greedyAlgorithm(ctx context.Context, req *OptimizeRequest, candidates []*candidateStore) (*MultiStoreResult, error) {
	// Map to track which store has which items
	storeItems := make(map[string][]*ItemAllocation) // storeID -> items

	// Track assigned items
	assigned := make(map[string]bool) // itemID -> assigned

	// Greedy assignment: for each item, find cheapest store
	for _, basketItem := range req.BasketItems {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		bestStore := ""
		bestPrice := int64(-1) // -1 indicates not found

		for _, candidate := range candidates {
			priceInfo, ok := candidate.itemPrices[basketItem.ItemID]
			if !ok {
				continue // Item not available at this store
			}

			lineTotal := priceInfo.EffectivePrice * int64(basketItem.Quantity)
			if bestPrice < 0 || lineTotal < bestPrice {
				bestPrice = lineTotal
				bestStore = candidate.storeID
			}
		}

		if bestStore != "" {
			// Find the priceInfo from the best store
			var bestPriceInfo *ItemPriceInfo
			for _, candidate := range candidates {
				if candidate.storeID == bestStore {
					bestPriceInfo = candidate.itemPrices[basketItem.ItemID]
					break
				}
			}

			// Assign to best store
			storeItems[bestStore] = append(storeItems[bestStore], &ItemAllocation{
				BasketItem: basketItem,
				PriceInfo:  bestPriceInfo,
				LineTotal:  bestPrice,
			})
			assigned[basketItem.ItemID] = true
		}
	}

	// Coverage post-pass: try to assign remaining items to any store
	unassigned := o.runCoveragePostPass(ctx, req, candidates, storeItems, assigned)

	// Build result
	return o.buildResult(req, candidates, storeItems, unassigned)
}

// optimalAlgorithm implements the optimal solution using exhaustive search.
// It tries all combinations of up to 3 stores to find the absolute best solution.
// This is computationally expensive and should only be used for small problems.
func (o *MultiStoreOptimizer) optimalAlgorithm(ctx context.Context, req *OptimizeRequest, candidates []*candidateStore) (*MultiStoreResult, error) {
	// For small problems, we can try all combinations of 1-3 stores
	// This is still exponential but manageable for N=15 candidates

	bestResult := &MultiStoreResult{
		CombinedTotal: -1, // -1 indicates uninitialized
		CoverageRatio: -1, // -1 indicates uninitialized
	}

	// Helper function to check if result is better than best
	isBetter := func(result, best *MultiStoreResult) bool {
		if best.CoverageRatio < 0 {
			return true
		}
		// Coverage-first ranking
		if result.CoverageRatio != best.CoverageRatio {
			return result.CoverageRatio > best.CoverageRatio
		}
		// Same coverage, lower cost is better
		return result.CombinedTotal < best.CombinedTotal
	}

	// Try single stores first (should match single-store optimizer)
	for _, candidate := range candidates {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		result := o.evaluateStoreCombination(ctx, req, candidates, []*candidateStore{candidate})
		if result != nil && isBetter(result, bestResult) {
			bestResult = result
		}
	}

	// Try pairs
	for i := 0; i < len(candidates); i++ {
		for j := i + 1; j < len(candidates); j++ {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}

			result := o.evaluateStoreCombination(ctx, req, candidates, []*candidateStore{
				candidates[i],
				candidates[j],
			})
			if result != nil && isBetter(result, bestResult) {
				bestResult = result
			}
		}
	}

	// Try triplets
	for i := 0; i < len(candidates); i++ {
		for j := i + 1; j < len(candidates); j++ {
			for k := j + 1; k < len(candidates); k++ {
				if ctx.Err() != nil {
					return nil, ctx.Err()
				}

				result := o.evaluateStoreCombination(ctx, req, candidates, []*candidateStore{
					candidates[i],
					candidates[j],
					candidates[k],
				})
				if result != nil && isBetter(result, bestResult) {
					bestResult = result
				}
			}
		}
	}

	if bestResult.CombinedTotal < 0 {
		return nil, fmt.Errorf("no valid store combination found")
	}

	return bestResult, nil
}

// evaluateStoreCombination evaluates a specific combination of stores
// and returns the optimal assignment of items to those stores.
func (o *MultiStoreOptimizer) evaluateStoreCombination(
	ctx context.Context,
	req *OptimizeRequest,
	allCandidates []*candidateStore,
	selectedStores []*candidateStore,
) *MultiStoreResult {
	// For each item, find the cheapest store in the selected set
	storeItems := make(map[string][]*ItemAllocation)
	assigned := make(map[string]bool)
	totalCost := int64(0)

	for _, basketItem := range req.BasketItems {
		bestStore := ""
		bestPrice := int64(-1)

		for _, store := range selectedStores {
			priceInfo, ok := store.itemPrices[basketItem.ItemID]
			if !ok {
				continue
			}

			lineTotal := priceInfo.EffectivePrice * int64(basketItem.Quantity)
			if bestPrice < 0 || lineTotal < bestPrice {
				bestPrice = lineTotal
				bestStore = store.storeID
			}
		}

		if bestStore != "" {
			for _, store := range selectedStores {
				if store.storeID == bestStore {
					priceInfo := store.itemPrices[basketItem.ItemID]
					storeItems[bestStore] = append(storeItems[bestStore], &ItemAllocation{
						BasketItem: basketItem,
						PriceInfo:  priceInfo,
						LineTotal:  bestPrice,
					})
					totalCost += bestPrice
					assigned[basketItem.ItemID] = true
					break
				}
			}
		}
	}

	// Calculate unassigned items
	unassigned := o.getUnassignedItems(req, allCandidates, assigned)

	// Calculate coverage ratio
	coverageRatio := float64(len(assigned)) / float64(len(req.BasketItems))

	// Build result
	result := &MultiStoreResult{
		CombinedTotal:  totalCost,
		CoverageRatio:  coverageRatio,
		UnassignedItems: unassigned,
		AlgorithmUsed:  "optimal",
	}

	// Convert storeItems to StoreAllocation
	result.Stores = make([]*StoreAllocation, 0, len(storeItems))
	for storeID, items := range storeItems {
		storeTotal := int64(0)
		priceInfos := make([]*ItemPriceInfo, 0, len(items))
		for _, item := range items {
			storeTotal += item.LineTotal
			priceInfos = append(priceInfos, item.PriceInfo)
		}

		// Find distance
		distance := 0.0
		for _, store := range selectedStores {
			if store.storeID == storeID {
				distance = store.distance
				break
			}
		}

		result.Stores = append(result.Stores, &StoreAllocation{
			StoreID:    storeID,
			Items:      priceInfos,
			StoreTotal: storeTotal,
			Distance:   distance,
		})
	}

	return result
}

// runCoveragePostPass attempts to assign items that weren't assigned
// in the main greedy pass to any store that has them.
func (o *MultiStoreOptimizer) runCoveragePostPass(
	ctx context.Context,
	req *OptimizeRequest,
	candidates []*candidateStore,
	storeItems map[string][]*ItemAllocation,
	assigned map[string]bool,
) []*MissingItem {
	var unassigned []*MissingItem

	for _, basketItem := range req.BasketItems {
		if assigned[basketItem.ItemID] {
			continue
		}

		// Try to find any store that has this item
		for _, candidate := range candidates {
			priceInfo, ok := candidate.itemPrices[basketItem.ItemID]
			if !ok {
				continue
			}

			// Found a store - assign the item
			lineTotal := priceInfo.EffectivePrice * int64(basketItem.Quantity)
			storeItems[candidate.storeID] = append(storeItems[candidate.storeID], &ItemAllocation{
				BasketItem: basketItem,
				PriceInfo:  priceInfo,
				LineTotal:  lineTotal,
			})
			assigned[basketItem.ItemID] = true
			break
		}

		// Still unassigned after post-pass
		if !assigned[basketItem.ItemID] {
			// Calculate penalty for missing item
			penalty := o.calculatePenalty(ctx, req.ChainSlug, basketItem.ItemID)
			unassigned = append(unassigned, &MissingItem{
				ItemID:     basketItem.ItemID,
				ItemName:   basketItem.Name,
				Penalty:    penalty,
				IsOptional: false,
			})
		}
	}

	return unassigned
}

// buildResult constructs the final MultiStoreResult from the optimization data.
func (o *MultiStoreOptimizer) buildResult(
	req *OptimizeRequest,
	candidates []*candidateStore,
	storeItems map[string][]*ItemAllocation,
	unassigned []*MissingItem,
) (*MultiStoreResult, error) {
	result := &MultiStoreResult{
		Stores:         make([]*StoreAllocation, 0, len(storeItems)),
		UnassignedItems: unassigned,
		AlgorithmUsed:  "greedy",
	}

	combinedTotal := int64(0)
	assignedCount := 0

	for storeID, items := range storeItems {
		storeTotal := int64(0)
		priceInfos := make([]*ItemPriceInfo, 0, len(items))

		for _, item := range items {
			storeTotal += item.LineTotal
			combinedTotal += item.LineTotal
			assignedCount += item.BasketItem.Quantity
			priceInfos = append(priceInfos, item.PriceInfo)
		}

		// Find distance
		distance := 0.0
		for _, candidate := range candidates {
			if candidate.storeID == storeID {
				distance = candidate.distance
				break
			}
		}

		result.Stores = append(result.Stores, &StoreAllocation{
			StoreID:    storeID,
			Items:      priceInfos,
			StoreTotal: storeTotal,
			Distance:   distance,
		})
	}

	result.CombinedTotal = combinedTotal
	result.CoverageRatio = float64(assignedCount) / float64(len(req.BasketItems))

	// Sort stores by visit order (could be optimized by TSP in the future)
	sort.Slice(result.Stores, func(i, j int) bool {
		return result.Stores[i].Distance < result.Stores[j].Distance
	})

	// Set visit order
	for i, store := range result.Stores {
		store.VisitOrder = i + 1
	}

	return result, nil
}

// getUnassignedItems builds the list of items that couldn't be assigned
// to any store in the candidate set.
func (o *MultiStoreOptimizer) getUnassignedItems(
	req *OptimizeRequest,
	candidates []*candidateStore,
	assigned map[string]bool,
) []*MissingItem {
	var unassigned []*MissingItem

	for _, basketItem := range req.BasketItems {
		if !assigned[basketItem.ItemID] {
			// Check if any candidate has this item
			availableAt := false
			for _, candidate := range candidates {
				if _, ok := candidate.itemPrices[basketItem.ItemID]; ok {
					availableAt = true
					break
				}
			}

			penalty := int64(0)
			if !availableAt {
				// Item not available at any candidate - use full penalty
				penalty = o.calculatePenalty(context.Background(), req.ChainSlug, basketItem.ItemID)
			}

			unassigned = append(unassigned, &MissingItem{
				ItemID:     basketItem.ItemID,
				ItemName:   basketItem.Name,
				Penalty:    penalty,
				IsOptional: false,
			})
		}
	}

	return unassigned
}

// evaluateStore evaluates a single store for the basket.
func (o *MultiStoreOptimizer) evaluateStore(ctx context.Context, req *OptimizeRequest, storeID string) *storeEvaluation {
	eval := &storeEvaluation{
		storeID:      storeID,
		itemPrices:   make(map[string]*ItemPriceInfo),
		missingItems: make(map[string]*MissingItem),
	}

	totalCost := int64(0)
	availableCount := 0

	for _, item := range req.BasketItems {
		price, ok := o.priceSource.GetPrice(req.ChainSlug, storeID, item.ItemID)
		if !ok {
			// Item not available
			penalty := o.calculatePenalty(ctx, req.ChainSlug, item.ItemID)
			eval.missingItems[item.ItemID] = &MissingItem{
				ItemID:     item.ItemID,
				ItemName:   item.Name,
				Penalty:    penalty,
				IsOptional: false,
			}
			totalCost += penalty * int64(item.Quantity)
			continue
		}

		// Item available
		availableCount++
		effectivePrice := GetEffectivePrice(price)
		lineTotal := effectivePrice * int64(item.Quantity)
		totalCost += lineTotal

		eval.itemPrices[item.ItemID] = &ItemPriceInfo{
			ItemID:         item.ItemID,
			ItemName:       item.Name,
			Quantity:       item.Quantity,
			BasePrice:      price.Price,
			EffectivePrice: effectivePrice,
			HasDiscount:    price.HasDiscount,
			LineTotal:      lineTotal,
		}

		if price.HasDiscount {
			eval.itemPrices[item.ItemID].DiscountPrice = &price.DiscountPrice
		}
	}

	eval.totalCost = totalCost
	eval.coverageRatio = float64(availableCount) / float64(len(req.BasketItems))
	eval.coverageBin = int(CoverageBinFromRatio(eval.coverageRatio))

	return eval
}

// calculatePenalty computes the penalty for a missing item using chain average.
func (o *MultiStoreOptimizer) calculatePenalty(ctx context.Context, chainSlug, itemID string) int64 {
	avgPrice := o.priceSource.GetAveragePrice(chainSlug, itemID)
	if avgPrice == 0 {
		return o.config.MissingItemFallback
	}
	return int64(float64(avgPrice) * o.config.MissingItemPenaltyMult)
}

// getAllStoreIDs returns all store IDs for a chain.
func (o *MultiStoreOptimizer) getAllStoreIDs(ctx context.Context, chainSlug string) []string {
	return o.priceSource.GetStoreIDs(chainSlug)
}

// candidateStore represents a store candidate for multi-store optimization.
type candidateStore struct {
	storeID      string
	totalCost    int64
	coverageBin  int
	itemPrices   map[string]*ItemPriceInfo
	missingItems map[string]*MissingItem
	distance     float64
}

// storeEvaluation represents the evaluation result of a single store.
type storeEvaluation struct {
	storeID        string
	totalCost      int64
	coverageRatio  float64
	coverageBin    int
	itemPrices     map[string]*ItemPriceInfo
	missingItems   map[string]*MissingItem
	distance       float64
}

// ItemAllocation represents a basket item allocated to a store.
type ItemAllocation struct {
	BasketItem *BasketItem
	PriceInfo  *ItemPriceInfo
	LineTotal  int64
}

// evaluateAllStores evaluates all stores in parallel with limited concurrency.
func (o *MultiStoreOptimizer) evaluateAllStores(
	ctx context.Context,
	req *OptimizeRequest,
	storeIDs []string,
) []*storeEvaluation {
	// Limit concurrency to avoid overwhelming the CPU
	const maxConcurrency = 10
	semaphore := make(chan struct{}, maxConcurrency)

	results := make([]*storeEvaluation, len(storeIDs))
	var wg sync.WaitGroup

	for i, storeID := range storeIDs {
		wg.Add(1)
		go func(idx int, sid string) {
			defer wg.Done()

			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()

				results[idx] = o.evaluateStore(ctx, req, sid)
			case <-ctx.Done():
				// Context cancelled
			}
		}(i, storeID)
	}

	wg.Wait()

	// Filter out nil results
	var validResults []*storeEvaluation
	for _, r := range results {
		if r != nil {
			validResults = append(validResults, r)
		}
	}

	return validResults
}
