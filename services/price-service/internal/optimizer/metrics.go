package optimizer

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// cacheHits tracks the number of cache hits per chain.
	cacheHits = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "optimizer_cache_hits_total",
		Help: "Total number of cache hits by chain",
	}, []string{"chain"})

	// cacheMisses tracks the number of cache misses per chain.
	cacheMisses = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "optimizer_cache_misses_total",
		Help: "Total number of cache misses by chain",
	}, []string{"chain"})

	// cacheLoadDuration tracks the time taken to load cache for each chain.
	cacheLoadDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "optimizer_cache_load_duration_seconds",
		Help:    "Time taken to load cache by chain",
		Buckets: []float64{0.1, 0.5, 1, 2, 5, 10, 30},
	}, []string{"chain"})

	// cacheLoadErrors tracks cache load errors.
	cacheLoadErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "optimizer_cache_load_errors_total",
		Help: "Total number of cache load errors by chain",
	}, []string{"chain"})

	// optimizationDuration tracks the time taken for optimization calculations.
	optimizationDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "optimizer_calculation_duration_seconds",
		Help:    "Time taken for optimization calculation by type",
		Buckets: []float64{0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5},
	}, []string{"type"}) // type: single_store, multi_store_greedy, multi_store_optimal

	// optimizationErrors tracks optimization errors.
	optimizationErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "optimizer_calculation_errors_total",
		Help: "Total number of optimization errors by type",
	}, []string{"type"})

	// basketSize tracks the distribution of basket sizes.
	basketSize = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "optimizer_basket_items_count",
		Help:    "Number of items in optimization requests",
		Buckets: []float64{1, 5, 10, 20, 50, 100},
	})

	// storeCount tracks the number of stores considered in optimization.
	storeCount = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "optimizer_stores_considered_count",
		Help:    "Number of stores considered in optimization",
		Buckets: []float64{1, 5, 10, 20, 50, 100, 500},
	})

	// candidateCount tracks the number of candidates for optimization.
	candidateCount = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "optimizer_candidates_count",
		Help:    "Number of candidate stores for optimization",
		Buckets: []float64{1, 5, 10, 15, 20, 50, 100},
	}, []string{"type"})

	// snapshotMemoryBytes tracks the memory usage of chain snapshots.
	snapshotMemoryBytes = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "optimizer_snapshot_memory_bytes",
		Help: "Estimated memory usage of chain snapshots in bytes",
	}, []string{"chain"})

	// cacheAge tracks the age of cache snapshots.
	cacheAge = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "optimizer_cache_age_seconds",
		Help: "Age of cache snapshot in seconds",
	}, []string{"chain"})

	// coverageRatio tracks the coverage ratio of optimization results.
	coverageRatio = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "optimizer_result_coverage_ratio",
		Help:    "Coverage ratio of optimization results",
		Buckets: []float64{0.5, 0.7, 0.8, 0.9, 0.95, 1.0},
	})

	// nearestStoreDistance tracks the distance to nearest stores.
	nearestStoreDistance = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "optimizer_nearest_store_distance_km",
		Help:    "Distance to nearest store in kilometers",
		Buckets: []float64{0.5, 1, 2, 5, 10, 20, 50},
	})

	// warmupConcurrency tracks the number of concurrent warmup operations.
	warmupConcurrency = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "optimizer_warmup_concurrent_operations",
		Help: "Number of concurrent warmup operations in progress",
	})
)

// MetricsRecorder provides methods to record optimizer metrics.
type MetricsRecorder struct{}

// NewMetricsRecorder creates a new metrics recorder.
func NewMetricsRecorder() *MetricsRecorder {
	return &MetricsRecorder{}
}

// RecordCacheHit records a cache hit for a chain.
func (m *MetricsRecorder) RecordCacheHit(chain string) {
	cacheHits.WithLabelValues(chain).Inc()
}

// RecordCacheMiss records a cache miss for a chain.
func (m *MetricsRecorder) RecordCacheMiss(chain string) {
	cacheMisses.WithLabelValues(chain).Inc()
}

// RecordCacheLoad records a cache load operation.
func (m *MetricsRecorder) RecordCacheLoad(chain string, durationSeconds float64, success bool) {
	cacheLoadDuration.WithLabelValues(chain).Observe(durationSeconds)
	if !success {
		cacheLoadErrors.WithLabelValues(chain).Inc()
	}
}

// RecordOptimizationDuration records the duration of an optimization operation.
func (m *MetricsRecorder) RecordOptimizationDuration(optType string, duration time.Duration) {
	optimizationDuration.WithLabelValues(optType).Observe(duration.Seconds())
}

// RecordOptimization records an optimization operation.
func (m *MetricsRecorder) RecordOptimization(optType string, durationSeconds float64, success bool) {
	optimizationDuration.WithLabelValues(optType).Observe(durationSeconds)
	if !success {
		optimizationErrors.WithLabelValues(optType).Inc()
	}
}

// RecordBasketSize records the size of a basket.
func (m *MetricsRecorder) RecordBasketSize(size int) {
	basketSize.Observe(float64(size))
}

// RecordStoreCount records the number of stores considered.
func (m *MetricsRecorder) RecordStoreCount(count int) {
	storeCount.Observe(float64(count))
}

// RecordCandidateCount records the number of candidates for optimization.
func (m *MetricsRecorder) RecordCandidateCount(optType string, count int) {
	candidateCount.WithLabelValues(optType).Observe(float64(count))
}

// RecordSnapshotMemory records the memory usage of a chain snapshot.
func (m *MetricsRecorder) RecordSnapshotMemory(chain string, bytes int64) {
	snapshotMemoryBytes.WithLabelValues(chain).Set(float64(bytes))
}

// RecordCacheAge records the age of a cache snapshot.
func (m *MetricsRecorder) RecordCacheAge(chain string, ageSeconds float64) {
	cacheAge.WithLabelValues(chain).Set(ageSeconds)
}

// RecordCoverageRatio records the coverage ratio of an optimization result.
func (m *MetricsRecorder) RecordCoverageRatio(ratio float64) {
	coverageRatio.Observe(ratio)
}

// RecordNearestStoreDistance records the distance to the nearest store.
func (m *MetricsRecorder) RecordNearestStoreDistance(distanceKm float64) {
	nearestStoreDistance.Observe(distanceKm)
}

// IncrementWarmupConcurrency increments the warmup concurrency counter.
func (m *MetricsRecorder) IncrementWarmupConcurrency() {
	warmupConcurrency.Inc()
}

// DecrementWarmupConcurrency decrements the warmup concurrency counter.
func (m *MetricsRecorder) DecrementWarmupConcurrency() {
	warmupConcurrency.Dec()
}

// ClearChainMetrics clears all metrics for a specific chain.
// Useful when a chain is removed or cache is cleared.
func (m *MetricsRecorder) ClearChainMetrics(chain string) {
	snapshotMemoryBytes.DeleteLabelValues(chain)
	cacheAge.DeleteLabelValues(chain)
}
