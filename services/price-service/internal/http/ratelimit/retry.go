package ratelimit

import (
	"math"
	"strconv"
	"time"
)

// FetchRetryError represents an error when all retry attempts are exhausted
type FetchRetryError struct {
	URL       string
	Attempts  int
	LastStatus int
	LastError error
}

func (e *FetchRetryError) Error() string {
	msg := "Failed to fetch " + e.URL + " after " + strconv.Itoa(e.Attempts) + " attempts"
	if e.LastStatus != 0 {
		msg += " (HTTP " + strconv.Itoa(e.LastStatus) + ")"
	}
	if e.LastError != nil {
		msg += ": " + e.LastError.Error()
	}
	return msg
}

// IsRetryableStatus checks if an HTTP status code is retryable
// Retryable: 429, 500-504
func IsRetryableStatus(status int) bool {
	return status == 429 || (status >= 500 && status < 600)
}

// CalculateBackoff calculates exponential backoff delay for a given attempt
// Uses exponential backoff with jitter (0-25%)
func CalculateBackoff(attempt int, config Config) time.Duration {
	// Exponential backoff: initialBackoff * 2^attempt
	exponentialDelay := float64(config.InitialBackoffMs) * math.Pow(2.0, float64(attempt))

	// Cap at maximum backoff
	cappedDelay := math.Min(exponentialDelay, float64(config.MaxBackoffMs))

	// Add jitter (0-25% of delay) to prevent thundering herd
	jitter := math_rand() * 0.25 * cappedDelay

	return time.Duration(cappedDelay + jitter)
}

// CalculateRateLimitBackoff calculates backoff for HTTP 429 responses
// Uses longer backoff (3x multiplier instead of 2x) for rate limiting
func CalculateRateLimitBackoff(attempt int, config Config, retryAfterHeader *string) time.Duration {
	// If server provides Retry-After, respect it
	if retryAfterHeader != nil {
		if seconds, err := strconv.Atoi(*retryAfterHeader); err == nil && seconds > 0 {
			// Add small jitter to server-provided delay
			jitter := time.Duration(math_rand() * 1000)
			return time.Duration(seconds)*time.Second + jitter
		}
	}

	// For rate limiting, use a more aggressive backoff (3x multiplier instead of 2x)
	exponentialDelay := float64(config.InitialBackoffMs) * math.Pow(3.0, float64(attempt))
	cappedDelay := math.Min(exponentialDelay, float64(config.MaxBackoffMs))
	jitter := math_rand() * 0.25 * cappedDelay

	return time.Duration(cappedDelay + jitter)
}

// Sleep blocks for the specified duration in milliseconds
func Sleep(ms int) {
	time.Sleep(time.Duration(ms) * time.Millisecond)
}

// math_rand is a helper to get a random float between 0 and 1
func math_rand() float64 {
	// Use the current time nanoseconds as a simple seed
	// In production, you'd want to use math/rand properly seeded
	return float64(time.Now().UnixNano()%1000) / 1000.0
}
