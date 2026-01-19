package http

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/kosarica/price-service/internal/http/ratelimit"
)

// Client is an HTTP client with rate limiting and retry logic
type Client struct {
	httpClient  *http.Client
	rateLimiter *ratelimit.RateLimiter
	config      ratelimit.Config
}

// NewClient creates a new HTTP client with rate limiting
func NewClient(config ratelimit.Config) *Client {
	return &Client{
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		rateLimiter: ratelimit.NewRateLimiter(config),
		config:      config,
	}
}

// NewClientDefault creates a new HTTP client with default rate limiting
func NewClientDefault() *Client {
	return NewClient(ratelimit.DefaultConfig())
}

// Get performs a GET request with rate limiting and retry logic
func (c *Client) Get(url string) (*http.Response, error) {
	return c.Do("GET", url, nil)
}

// Do performs an HTTP request with rate limiting and retry logic
func (c *Client) Do(method, url string, body io.Reader) (*http.Response, error) {
	var lastStatus int
	var lastErr error

	for attempt := 0; attempt <= c.config.MaxRetries; attempt++ {
		// Throttle to respect rate limits
		if err := c.rateLimiter.Throttle(); err != nil {
			return nil, fmt.Errorf("rate limiter error: %w", err)
		}

		// Create request
		req, err := http.NewRequest(method, url, body)
		if err != nil {
			lastErr = err
			if attempt < c.config.MaxRetries {
				ratelimit.Sleep(ratelimit.CalculateBackoff(attempt, c.config).Milliseconds())
				continue
			}
			return nil, &ratelimit.FetchRetryError{
				URL:       url,
				Attempts:  attempt + 1,
				LastStatus: lastStatus,
				LastError: lastErr,
			}
		}

		// Set default headers
		req.Header.Set("User-Agent", "Kosarica-PriceService/1.0")
		req.Header.Set("Accept", "*/*")

		// Execute request
		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err
			if attempt < c.config.MaxRetries {
				ratelimit.Sleep(ratelimit.CalculateBackoff(attempt, c.config).Milliseconds())
				continue
			}
			return nil, &ratelimit.FetchRetryError{
				URL:       url,
				Attempts:  attempt + 1,
				LastStatus: lastStatus,
				LastError: lastErr,
			}
		}

		// Check status
		lastStatus = resp.StatusCode

		// Success - return immediately
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return resp, nil
		}

		// Non-retryable error - fail immediately
		if !ratelimit.IsRetryableStatus(resp.StatusCode) {
			resp.Body.Close()
			return nil, &ratelimit.FetchRetryError{
				URL:       url,
				Attempts:  attempt + 1,
				LastStatus: resp.StatusCode,
				LastError: nil,
			}
		}

		// If this was our last attempt, return error
		if attempt == c.config.MaxRetries {
			resp.Body.Close()
			return nil, &ratelimit.FetchRetryError{
				URL:       url,
				Attempts:  attempt + 1,
				LastStatus: resp.StatusCode,
				LastError: nil,
			}
		}

		// Calculate backoff delay
		var backoff time.Duration
		if resp.StatusCode == 429 {
			// Rate limited - use longer backoff
			retryAfter := resp.Header.Get("Retry-After")
			var retryAfterPtr *string
			if retryAfter != "" {
				retryAfterPtr = &retryAfter
			}
			backoff = ratelimit.CalculateRateLimitBackoff(attempt, c.config, retryAfterPtr)
		} else {
			// Server error - use standard exponential backoff
			backoff = ratelimit.CalculateBackoff(attempt, c.config)
		}

		resp.Body.Close()
		ratelimit.Sleep(backoff.Milliseconds())
	}

	// Should not reach here, but needed for return
	return nil, &ratelimit.FetchRetryError{
		URL:       url,
		Attempts:  c.config.MaxRetries + 1,
		LastStatus: lastStatus,
		LastError: lastErr,
	}
}

// GetBytes performs a GET request and returns the response body as bytes
func (c *Client) GetBytes(url string) ([]byte, error) {
	resp, err := c.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	return data, nil
}

// GetConfig returns the current rate limit config
func (c *Client) GetConfig() ratelimit.Config {
	return c.config
}

// SetConfig updates the rate limit config
func (c *Client) SetConfig(config ratelimit.Config) {
	c.config = config
	c.rateLimiter.SetConfig(config)
}

// ComputeSha256 computes the SHA256 hash of the given data
func ComputeSha256(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}
