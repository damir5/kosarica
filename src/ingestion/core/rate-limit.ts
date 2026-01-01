/**
 * Rate Limiting and Exponential Backoff
 *
 * Utilities for rate limiting requests to retailer servers and handling
 * transient failures with exponential backoff retry logic.
 */

/**
 * Configuration for rate limiting and retry behavior.
 */
export interface RateLimitConfig {
  /** Maximum requests per second */
  requestsPerSecond: number
  /** Maximum number of retry attempts */
  maxRetries: number
  /** Initial backoff delay in milliseconds */
  initialBackoffMs: number
  /** Maximum backoff delay in milliseconds */
  maxBackoffMs: number
}

/**
 * Default rate limit configuration.
 * Conservative defaults suitable for most retailers.
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  requestsPerSecond: 2,
  maxRetries: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 30000,
}

/**
 * Sleep utility function.
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Rate limiter that throttles requests to a maximum rate.
 *
 * Uses a simple token bucket algorithm where we track the last request
 * time and ensure minimum intervals between requests.
 */
export class RateLimiter {
  private lastRequest: number = 0
  private config: RateLimitConfig

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_RATE_LIMIT_CONFIG, ...config }
  }

  /**
   * Get the current configuration.
   */
  getConfig(): RateLimitConfig {
    return { ...this.config }
  }

  /**
   * Update the configuration.
   * @param config - Partial configuration to merge
   */
  setConfig(config: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Throttle execution to respect rate limits.
   * Call this before making a request.
   */
  async throttle(): Promise<void> {
    const now = Date.now()
    const minInterval = 1000 / this.config.requestsPerSecond
    const elapsed = now - this.lastRequest

    if (elapsed < minInterval) {
      await sleep(minInterval - elapsed)
    }

    this.lastRequest = Date.now()
  }

  /**
   * Reset the rate limiter state.
   * Useful for testing or after long pauses.
   */
  reset(): void {
    this.lastRequest = 0
  }
}

/**
 * Error thrown when all retry attempts are exhausted.
 */
export class FetchRetryError extends Error {
  readonly url: string
  readonly attempts: number
  readonly lastStatus: number | null
  readonly lastError: Error | null

  constructor(
    url: string,
    attempts: number,
    lastStatus: number | null,
    lastError: Error | null,
  ) {
    const statusInfo = lastStatus !== null ? ` (HTTP ${lastStatus})` : ''
    const errorInfo = lastError ? `: ${lastError.message}` : ''
    super(
      `Failed to fetch ${url} after ${attempts} attempts${statusInfo}${errorInfo}`,
    )
    this.name = 'FetchRetryError'
    this.url = url
    this.attempts = attempts
    this.lastStatus = lastStatus
    this.lastError = lastError
  }
}

/**
 * Calculate backoff delay for a given attempt using exponential backoff with jitter.
 *
 * @param attempt - The current attempt number (0-indexed)
 * @param config - Rate limit configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoff(
  attempt: number,
  config: RateLimitConfig,
): number {
  // Exponential backoff: initialBackoff * 2^attempt
  const exponentialDelay = config.initialBackoffMs * Math.pow(2, attempt)

  // Cap at maximum backoff
  const cappedDelay = Math.min(exponentialDelay, config.maxBackoffMs)

  // Add jitter (0-25% of delay) to prevent thundering herd
  const jitter = Math.random() * 0.25 * cappedDelay

  return Math.floor(cappedDelay + jitter)
}

/**
 * Check if an HTTP status code is retryable.
 *
 * Retryable status codes:
 * - 429: Too Many Requests (rate limited)
 * - 500: Internal Server Error
 * - 502: Bad Gateway
 * - 503: Service Unavailable
 * - 504: Gateway Timeout
 *
 * @param status - HTTP status code
 * @returns true if the status is retryable
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

/**
 * Calculate backoff for HTTP 429 responses.
 * Uses longer backoff for rate limiting responses.
 *
 * @param attempt - The current attempt number (0-indexed)
 * @param config - Rate limit configuration
 * @param retryAfterHeader - Value of Retry-After header, if present
 * @returns Delay in milliseconds
 */
export function calculateRateLimitBackoff(
  attempt: number,
  config: RateLimitConfig,
  retryAfterHeader?: string | null,
): number {
  // If server provides Retry-After, respect it
  if (retryAfterHeader) {
    const retryAfterSeconds = parseInt(retryAfterHeader, 10)
    if (!isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
      // Add small jitter to server-provided delay
      const jitter = Math.random() * 1000
      return retryAfterSeconds * 1000 + jitter
    }
  }

  // For rate limiting, use a more aggressive backoff (3x multiplier instead of 2x)
  const exponentialDelay = config.initialBackoffMs * Math.pow(3, attempt)
  const cappedDelay = Math.min(exponentialDelay, config.maxBackoffMs)
  const jitter = Math.random() * 0.25 * cappedDelay

  return Math.floor(cappedDelay + jitter)
}

/**
 * Fetch a URL with exponential backoff retry logic.
 *
 * Features:
 * - Respects rate limits using the provided RateLimiter
 * - Retries on transient failures (5xx errors)
 * - Special handling for HTTP 429 with longer backoff
 * - Respects Retry-After header when present
 * - Exponential backoff with jitter
 *
 * @param url - URL to fetch
 * @param rateLimiter - RateLimiter instance for throttling
 * @param config - Rate limit configuration for retry behavior
 * @param fetchOptions - Optional fetch options (headers, etc.)
 * @returns Response object
 * @throws FetchRetryError if all retries are exhausted
 */
export async function fetchWithRetry(
  url: string,
  rateLimiter: RateLimiter,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
  fetchOptions?: RequestInit,
): Promise<Response> {
  let lastStatus: number | null = null
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      // Throttle to respect rate limits
      await rateLimiter.throttle()

      const response = await fetch(url, fetchOptions)

      // Success - return immediately
      if (response.ok) {
        return response
      }

      lastStatus = response.status

      // Non-retryable error - fail immediately
      if (!isRetryableStatus(response.status)) {
        throw new FetchRetryError(url, attempt + 1, response.status, null)
      }

      // If this was our last attempt, throw error
      if (attempt === config.maxRetries) {
        throw new FetchRetryError(url, attempt + 1, response.status, null)
      }

      // Calculate backoff delay
      let backoffMs: number
      if (response.status === 429) {
        // Rate limited - use longer backoff
        const retryAfter = response.headers.get('Retry-After')
        backoffMs = calculateRateLimitBackoff(attempt, config, retryAfter)
      } else {
        // Server error - use standard exponential backoff
        backoffMs = calculateBackoff(attempt, config)
      }

      await sleep(backoffMs)
    } catch (error) {
      // Network error or other fetch failure
      if (error instanceof FetchRetryError) {
        throw error
      }

      lastError = error instanceof Error ? error : new Error(String(error))

      // If this was our last attempt, throw wrapped error
      if (attempt === config.maxRetries) {
        throw new FetchRetryError(url, attempt + 1, lastStatus, lastError)
      }

      // Backoff before retry
      const backoffMs = calculateBackoff(attempt, config)
      await sleep(backoffMs)
    }
  }

  // Should not reach here, but TypeScript needs this
  throw new FetchRetryError(
    url,
    config.maxRetries + 1,
    lastStatus,
    lastError,
  )
}

/**
 * Create a rate limiter with chain-specific configuration.
 *
 * @param chainSlug - Chain identifier for configuration lookup
 * @param configOverrides - Optional configuration overrides
 * @returns Configured RateLimiter instance
 */
export function createRateLimiter(
  config?: Partial<RateLimitConfig>,
): RateLimiter {
  return new RateLimiter(config)
}
