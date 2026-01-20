package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// RateLimiterConfig holds configuration for rate limiting
type RateLimiterConfig struct {
	RequestsPerSecond float64
	BurstSize         int
}

// DefaultRateLimiterConfig returns default rate limiting settings
func DefaultRateLimiterConfig() RateLimiterConfig {
	return RateLimiterConfig{
		RequestsPerSecond: 10, // 10 requests per second
		BurstSize:         20, // Allow up to 20 requests in a burst
	}
}

// IPRateLimiter tracks rate limiters per IP address
type IPRateLimiter struct {
	limiters map[string]*rate.Limiter
	mu       sync.RWMutex
	config   RateLimiterConfig
}

// NewIPRateLimiter creates a new IP-based rate limiter
func NewIPRateLimiter(config RateLimiterConfig) *IPRateLimiter {
	return &IPRateLimiter{
		limiters: make(map[string]*rate.Limiter),
		config:   config,
	}
}

// GetLimiter returns the rate limiter for the given IP address
func (rl *IPRateLimiter) GetLimiter(ip string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	limiter, exists := rl.limiters[ip]
	if !exists {
		limiter = rate.NewLimiter(rl.config.RequestsPerSecond, rl.config.BurstSize)
		rl.limiters[ip] = limiter
	}

	return limiter
}

// CleanupOldLimiters removes limiters for IPs that haven't been seen recently
// Should be called periodically (e.g., every 5 minutes)
func (rl *IPRateLimiter) CleanupOldLimiters() {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	// Simple cleanup: remove all limiters to prevent unbounded growth
	// In production, you might want to track last access time and only remove old ones
	rl.limiters = make(map[string]*rate.Limiter)
}

// Global rate limiter instance
var globalRateLimiter = NewIPRateLimiter(DefaultRateLimiterConfig())

// RateLimitMiddleware applies rate limiting based on client IP
func RateLimitMiddleware(config ...RateLimiterConfig) gin.HandlerFunc {
	cfg := DefaultRateLimiterConfig()
	if len(config) > 0 {
		cfg = config[0]
	}

	limiter := NewIPRateLimiter(cfg)

	// Start cleanup goroutine
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			limiter.CleanupOldLimiters()
		}
	}()

	return func(c *gin.Context) {
		// Get client IP from X-Forwarded-For header if present, otherwise from RemoteAddr
		ip := c.GetHeader("X-Forwarded-For")
		if ip == "" {
			ip = c.ClientIP()
		}

		// Get or create limiter for this IP
		ipLimiter := limiter.GetLimiter(ip)

		// Check if request is allowed
		if !ipLimiter.Allow() {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded",
			})
			return
		}

		c.Next()
	}
}

// ServiceRateLimitMiddleware applies rate limiting for service-to-service calls
// Uses a global limiter (not per-IP) since all internal services share the same key
func ServiceRateLimitMiddleware(requestsPerSecond float64, burstSize int) gin.HandlerFunc {
	limiter := rate.NewLimiter(requestsPerSecond, burstSize)

	return func(c *gin.Context) {
		if !limiter.Allow() {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Service rate limit exceeded",
			})
			return
		}
		c.Next()
	}
}
