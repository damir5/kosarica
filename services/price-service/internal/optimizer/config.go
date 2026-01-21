package optimizer

import "time"

// Config holds the configuration for the basket optimizer.
// It is loaded from environment variables or a config file.
type Config struct {
	// Cache settings
	CacheLoadTimeout   time.Duration `mapstructure:"cache_load_timeout" env:"CACHE_LOAD_TIMEOUT" default:"30s"`
	CacheTTL           time.Duration `mapstructure:"cache_ttl" env:"CACHE_TTL" default:"1h"`
	CacheRefreshJitter time.Duration `mapstructure:"cache_refresh_jitter" env:"CACHE_REFRESH_JITTER" default:"5m"`

	// Warmup settings
	WarmupConcurrency int `mapstructure:"warmup_concurrency" env:"WARMUP_CONCURRENCY" default:"3"`

	// Candidate selection for multi-store optimization
	TopCheapestStores int `mapstructure:"top_cheapest_stores" env:"TOP_CHEAPEST_STORES" default:"10"`
	TopNearestStores  int `mapstructure:"top_nearest_stores" env:"TOP_NEAREST_STORES" default:"5"`
	MaxCandidates     int `mapstructure:"max_candidates" env:"MAX_CANDIDATES" default:"20"`

	// Geographic filtering
	MaxDistanceKm float64 `mapstructure:"max_distance_km" env:"MAX_DISTANCE_KM" default:"50.0"`

	// Algorithm settings
	OptimalTimeoutMs int `mapstructure:"optimal_timeout_ms" env:"OPTIMAL_TIMEOUT_MS" default:"100"`

	// Validation limits
	MaxBasketItems int `mapstructure:"max_basket_items" env:"MAX_BASKET_ITEMS" default:"100"`
	MinBasketItems int `mapstructure:"min_basket_items" env:"MIN_BASKET_ITEMS" default:"1"`

	// Missing item penalty
	MissingItemPenaltyMult float64 `mapstructure:"missing_item_penalty_mult" env:"MISSING_ITEM_PENALTY_MULT" default:"2.0"`
	MissingItemFallback    int64   `mapstructure:"missing_item_fallback" env:"MISSING_ITEM_FALLBACK" default:"10000"`

	// Coverage bins (must be descending: full, high, medium)
	CoverageBins []float64 `mapstructure:"coverage_bins" env:"COVERAGE_BINS" default:"[1.0,0.9,0.8]"`

	// Feature flags
	EnableMultiStore bool `mapstructure:"enable_multi_store" env:"ENABLE_MULTI_STORE" default:"true"`
}

// Defaults returns the default configuration.
func Defaults() *Config {
	return &Config{
		CacheLoadTimeout:       30 * time.Second,
		CacheTTL:               1 * time.Hour,
		CacheRefreshJitter:     5 * time.Minute,
		WarmupConcurrency:      3,
		TopCheapestStores:      10,
		TopNearestStores:       5,
		MaxCandidates:          20,
		MaxDistanceKm:          50.0,
		OptimalTimeoutMs:       100,
		MaxBasketItems:         100,
		MinBasketItems:         1,
		MissingItemPenaltyMult: 2.0,
		MissingItemFallback:    10000,
		CoverageBins:           []float64{1.0, 0.9, 0.8},
		EnableMultiStore:       true,
	}
}

// ToOptimizerConfig converts Config to OptimizerConfig for use in the optimizer.
func (c *Config) ToOptimizerConfig() *OptimizerConfig {
	return &OptimizerConfig{
		CacheLoadTimeout:       c.CacheLoadTimeout,
		CacheTTL:               c.CacheTTL,
		CacheRefreshJitter:     c.CacheRefreshJitter,
		WarmupConcurrency:      c.WarmupConcurrency,
		TopCheapestStores:      c.TopCheapestStores,
		TopNearestStores:       c.TopNearestStores,
		MaxCandidates:          c.MaxCandidates,
		MaxDistanceKm:          c.MaxDistanceKm,
		OptimalTimeoutMs:       c.OptimalTimeoutMs,
		MaxBasketItems:         c.MaxBasketItems,
		MinBasketItems:         c.MinBasketItems,
		MissingItemPenaltyMult: c.MissingItemPenaltyMult,
		MissingItemFallback:    c.MissingItemFallback,
		CoverageBins:           c.CoverageBins,
	}
}

// Validate validates the configuration and returns an error if invalid.
func (c *Config) Validate() error {
	if c.CacheLoadTimeout <= 0 {
		return ErrInvalidConfig{Field: "cache_load_timeout", Reason: "must be positive"}
	}
	if c.CacheTTL <= 0 {
		return ErrInvalidConfig{Field: "cache_ttl", Reason: "must be positive"}
	}
	if c.WarmupConcurrency < 1 {
		return ErrInvalidConfig{Field: "warmup_concurrency", Reason: "must be at least 1"}
	}
	if c.TopCheapestStores < 1 {
		return ErrInvalidConfig{Field: "top_cheapest_stores", Reason: "must be at least 1"}
	}
	if c.TopNearestStores < 1 {
		return ErrInvalidConfig{Field: "top_nearest_stores", Reason: "must be at least 1"}
	}
	if c.MaxCandidates < c.TopCheapestStores+c.TopNearestStores {
		return ErrInvalidConfig{Field: "max_candidates", Reason: "must be >= top_cheapest_stores + top_nearest_stores"}
	}
	if c.MaxDistanceKm <= 0 {
		return ErrInvalidConfig{Field: "max_distance_km", Reason: "must be positive"}
	}
	if c.OptimalTimeoutMs < 1 {
		return ErrInvalidConfig{Field: "optimal_timeout_ms", Reason: "must be at least 1"}
	}
	if c.MaxBasketItems < c.MinBasketItems {
		return ErrInvalidConfig{Field: "max_basket_items", Reason: "must be >= min_basket_items"}
	}
	if c.MissingItemPenaltyMult < 1.0 {
		return ErrInvalidConfig{Field: "missing_item_penalty_mult", Reason: "must be >= 1.0"}
	}
	if c.MissingItemFallback < 0 {
		return ErrInvalidConfig{Field: "missing_item_fallback", Reason: "must be non-negative"}
	}
	if len(c.CoverageBins) != 3 {
		return ErrInvalidConfig{Field: "coverage_bins", Reason: "must have exactly 3 values"}
	}
	// Verify coverage bins are descending
	for i := 0; i < len(c.CoverageBins)-1; i++ {
		if c.CoverageBins[i] <= c.CoverageBins[i+1] {
			return ErrInvalidConfig{Field: "coverage_bins", Reason: "must be in descending order"}
		}
	}
	return nil
}

// ErrInvalidConfig is returned when the configuration is invalid.
type ErrInvalidConfig struct {
	Field  string
	Reason string
}

func (e ErrInvalidConfig) Error() string {
	return e.Field + ": " + e.Reason
}
