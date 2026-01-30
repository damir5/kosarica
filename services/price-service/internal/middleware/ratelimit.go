package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// RateLimiterConfig holds configuration for rate limiting
type RateLimiterConfig struct {
	RequestsPerSecond float64
	BurstSize         int
	// TrustedProxies is a list of trusted proxy IP addresses or CIDR ranges
	// If empty, X-Forwarded-For header is ignored
	TrustedProxies []string
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
		limiter = rate.NewLimiter(rate.Limit(rl.config.RequestsPerSecond), rl.config.BurstSize)
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
		// Get client IP, validating X-Forwarded-For only from trusted proxies
		ip := c.ClientIP()

		// Only use X-Forwarded-For if we have trusted proxies configured
		// and the request comes from one of them
		if len(cfg.TrustedProxies) > 0 {
			clientIP := c.RemoteIP()
			if isTrustedProxy(clientIP, cfg.TrustedProxies) {
				// Use X-Forwarded-For from trusted proxy
				forwardedFor := c.GetHeader("X-Forwarded-For")
				if forwardedFor != "" {
					// X-Forwarded-For can contain multiple IPs, use the first one (client)
					ips := strings.Split(forwardedFor, ",")
					if len(ips) > 0 {
						ip = strings.TrimSpace(ips[0])
					}
				}
			}
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

// isTrustedProxy checks if the given IP is in the list of trusted proxies
func isTrustedProxy(ip string, trustedProxies []string) bool {
	for _, trusted := range trustedProxies {
		// Simple string match for now - could be enhanced to support CIDR ranges
		if ip == trusted {
			return true
		}
	}
	return false
}

// ServiceRateLimitMiddleware applies rate limiting for service-to-service calls
// Uses a global limiter (not per-IP) since all internal services share the same key
func ServiceRateLimitMiddleware(requestsPerSecond float64, burstSize int) gin.HandlerFunc {
	limiter := rate.NewLimiter(rate.Limit(requestsPerSecond), burstSize)

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
