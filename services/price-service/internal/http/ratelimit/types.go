package ratelimit

import "time"

// Config holds rate limiting configuration
type Config struct {
	RequestsPerSecond int `json:"requestsPerSecond"`
	MaxRetries        int `json:"maxRetries"`
	InitialBackoffMs  int `json:"initialBackoffMs"`
	MaxBackoffMs      int `json:"maxBackoffMs"`
}

// DefaultConfig returns the default rate limit configuration
func DefaultConfig() Config {
	return Config{
		RequestsPerSecond: 2,
		MaxRetries:        3,
		InitialBackoffMs:  100,
		MaxBackoffMs:      30000,
	}
}

// DefaultConfig returns a config with the given overrides
func WithOverrides(overrides PartialConfig) Config {
	cfg := DefaultConfig()
	if overrides.RequestsPerSecond != nil {
		cfg.RequestsPerSecond = *overrides.RequestsPerSecond
	}
	if overrides.MaxRetries != nil {
		cfg.MaxRetries = *overrides.MaxRetries
	}
	if overrides.InitialBackoffMs != nil {
		cfg.InitialBackoffMs = *overrides.InitialBackoffMs
	}
	if overrides.MaxBackoffMs != nil {
		cfg.MaxBackoffMs = *overrides.MaxBackoffMs
	}
	return cfg
}

// PartialConfig allows partial configuration overrides
type PartialConfig struct {
	RequestsPerSecond *int `json:"requestsPerSecond,omitempty"`
	MaxRetries        *int `json:"maxRetries,omitempty"`
	InitialBackoffMs  *int `json:"initialBackoffMs,omitempty"`
	MaxBackoffMs      *int `json:"maxBackoffMs,omitempty"`
}

// RateLimiter provides rate limiting using a token bucket algorithm
type RateLimiter struct {
	config     Config
	lastRequest int64 // Unix nanoseconds of last request
}

// NewRateLimiter creates a new rate limiter with the given config
func NewRateLimiter(config Config) *RateLimiter {
	return &RateLimiter{
		config:     config,
		lastRequest: 0,
	}
}

// NewRateLimiterDefault creates a rate limiter with default config
func NewRateLimiterDefault() *RateLimiter {
	return NewRateLimiter(DefaultConfig())
}

// GetConfig returns the current configuration
func (r *RateLimiter) GetConfig() Config {
	return r.config
}

// SetConfig updates the configuration
func (r *RateLimiter) SetConfig(config Config) {
	r.config = config
}

// Throttle waits to ensure rate limits are respected
// Call this before making a request
func (r *RateLimiter) Throttle() error {
	now := time.Now().UnixNano()
	minInterval := int64(1000_000_000 / r.config.RequestsPerSecond) // nanoseconds

	elapsed := now - r.lastRequest
	if elapsed < minInterval {
		waitTime := minInterval - elapsed
		time.Sleep(time.Duration(waitTime))
	}

	r.lastRequest = time.Now().UnixNano()
	return nil
}

// Reset resets the rate limiter state
// Useful for testing or after long pauses
func (r *RateLimiter) Reset() {
	r.lastRequest = 0
}
