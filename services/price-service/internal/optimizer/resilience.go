package optimizer

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog"
)

// CircuitBreakerState represents the state of the circuit breaker.
type CircuitBreakerState int

const (
	// CircuitClosed allows requests to pass through.
	CircuitClosed CircuitBreakerState = iota

	// CircuitOpen rejects requests immediately.
	CircuitOpen

	// CircuitHalfOpen allows a test request to check if the service has recovered.
	CircuitHalfOpen
)

// String returns the string representation of the circuit breaker state.
func (s CircuitBreakerState) String() string {
	switch s {
	case CircuitClosed:
		return "closed"
	case CircuitOpen:
		return "open"
	case CircuitHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

// CircuitBreakerConfig holds configuration for the circuit breaker.
type CircuitBreakerConfig struct {
	// MaxFailures is the number of consecutive failures before opening the circuit.
	MaxFailures int `default:"5"`

	// ResetTimeout is how long to wait before attempting a reset (half-open state).
	ResetTimeout time.Duration `default:"30s"`

	// HalfOpenMaxCalls is the number of calls allowed in half-open state.
	HalfOpenMaxCalls int `default:"3"`
}

// DefaultCircuitBreakerConfig returns the default circuit breaker configuration.
func DefaultCircuitBreakerConfig() *CircuitBreakerConfig {
	return &CircuitBreakerConfig{
		MaxFailures:     5,
		ResetTimeout:    30 * time.Second,
		HalfOpenMaxCalls: 3,
	}
}

// CircuitBreaker implements the circuit breaker pattern for cache failures.
type CircuitBreaker struct {
	mu               sync.Mutex
	state            CircuitBreakerState
	failureCount     int
	successCount     int // Used in half-open state
	lastFailureTime  time.Time
	lastStateChange  time.Time
	config           *CircuitBreakerConfig
	metrics          *MetricsRecorder
	logger           *zerolog.Logger
	name             string
	requestID        string // For request tracking
}

// NewCircuitBreaker creates a new circuit breaker.
func NewCircuitBreaker(name string, config *CircuitBreakerConfig, metrics *MetricsRecorder, logger *zerolog.Logger) *CircuitBreaker {
	if config == nil {
		config = DefaultCircuitBreakerConfig()
	}
	if logger == nil {
		nopLogger := zerolog.Nop()
		logger = &nopLogger
	}

	return &CircuitBreaker{
		state:           CircuitClosed,
		config:          config,
		metrics:         metrics,
		logger:          logger,
		name:            name,
		lastStateChange: time.Now(),
	}
}

// Allow returns true if the request should be allowed through the circuit breaker.
func (cb *CircuitBreaker) Allow(ctx context.Context) bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	// Extract request ID from context if available
	requestID := ctx.Value("request_id")
	if requestID != nil {
		cb.requestID = requestID.(string)
	}

	now := time.Now()

	switch cb.state {
	case CircuitClosed:
		return true

	case CircuitOpen:
		// Check if we should transition to half-open
		if now.Sub(cb.lastFailureTime) >= cb.config.ResetTimeout {
			cb.transitionTo(CircuitHalfOpen, now)
			cb.logger.Info().
				Str("circuit_breaker", cb.name).
				Str("request_id", cb.requestID).
				Msg("Circuit breaker transitioning to half-open")
			return true
		}
		return false

	case CircuitHalfOpen:
		// Allow limited calls in half-open state
		return cb.successCount < cb.config.HalfOpenMaxCalls

	default:
		return false
	}
}

// RecordSuccess records a successful operation.
func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	now := time.Now()

	switch cb.state {
	case CircuitClosed:
		// Reset failure count on success
		cb.failureCount = 0

	case CircuitHalfOpen:
		cb.successCount++
		// If we've had enough successes in half-open, close the circuit
		if cb.successCount >= cb.config.HalfOpenMaxCalls {
			cb.transitionTo(CircuitClosed, now)
			cb.logger.Info().
				Str("circuit_breaker", cb.name).
				Str("request_id", cb.requestID).
				Int("success_count", cb.successCount).
				Msg("Circuit breaker closing after successful recovery")
			cb.successCount = 0
			cb.failureCount = 0
		}
	}
}

// RecordFailure records a failed operation.
func (cb *CircuitBreaker) RecordFailure(err error) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	now := time.Now()
	cb.failureCount++
	cb.lastFailureTime = now

	cb.logger.Error().
		Err(err).
		Str("circuit_breaker", cb.name).
		Str("request_id", cb.requestID).
		Int("failure_count", cb.failureCount).
		Msg("Circuit breaker recording failure")

	switch cb.state {
	case CircuitClosed:
		// Open the circuit if we've hit the max failures
		if cb.failureCount >= cb.config.MaxFailures {
			cb.transitionTo(CircuitOpen, now)
			cb.logger.Warn().
				Str("circuit_breaker", cb.name).
				Str("request_id", cb.requestID).
				Int("failure_count", cb.failureCount).
				Dur("reset_timeout", cb.config.ResetTimeout).
				Msg("Circuit breaker opening after max failures")
		}

	case CircuitHalfOpen:
		// Any failure in half-open immediately opens the circuit
		cb.transitionTo(CircuitOpen, now)
		cb.logger.Warn().
			Str("circuit_breaker", cb.name).
			Str("request_id", cb.requestID).
			Msg("Circuit breaker re-opening after failure in half-open state")
		cb.successCount = 0
	}
}

// transitionTo transitions the circuit breaker to a new state.
func (cb *CircuitBreaker) transitionTo(newState CircuitBreakerState, now time.Time) {
	cb.state = newState
	cb.lastStateChange = now

	// Record state change metric
	if cb.metrics != nil {
		// Note: We'd need to add a state metric to track this
	}
}

// State returns the current state of the circuit breaker.
func (cb *CircuitBreaker) State() CircuitBreakerState {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return cb.state
}

// FailureCount returns the current failure count.
func (cb *CircuitBreaker) FailureCount() int {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return cb.failureCount
}

// LastFailureTime returns the time of the last failure.
func (cb *CircuitBreaker) LastFailureTime() time.Time {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return cb.lastFailureTime
}

// Reset resets the circuit breaker to closed state.
func (cb *CircuitBreaker) Reset() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	now := time.Now()
	cb.transitionTo(CircuitClosed, now)
	cb.failureCount = 0
	cb.successCount = 0

	cb.logger.Info().
		Str("circuit_breaker", cb.name).
		Msg("Circuit breaker manually reset to closed state")
}

// WarmupGate blocks operations until warmup is complete.
type WarmupGate struct {
	mu       sync.RWMutex
	ready    bool
	warmedCh chan struct{}
	logger   *zerolog.Logger
}

// NewWarmupGate creates a new warmup gate.
func NewWarmupGate(logger *zerolog.Logger) *WarmupGate {
	if logger == nil {
		nopLogger := zerolog.Nop()
		logger = &nopLogger
	}

	return &WarmupGate{
		warmedCh: make(chan struct{}),
		logger:    logger,
	}
}

// Wait blocks until warmup is complete or context is cancelled.
// Returns false if the context was cancelled before warmup completed.
func (wg *WarmupGate) Wait(ctx context.Context) bool {
	wg.mu.RLock()
	ready := wg.ready
	wg.mu.RUnlock()

	if ready {
		return true
	}

	// Extract request ID from context if available
	requestID := ""
	if id := ctx.Value("request_id"); id != nil {
		requestID = id.(string)
	}

	wg.logger.Debug().
		Str("request_id", requestID).
		Msg("Warmup gate: waiting for warmup to complete")

	select {
	case <-wg.warmedCh:
		return true
	case <-ctx.Done():
		wg.logger.Warn().
			Str("request_id", requestID).
			Msg("Warmup gate: context cancelled while waiting for warmup")
		return false
	}
}

// Ready marks the warmup as complete.
func (wg *WarmupGate) Ready() {
	wg.mu.Lock()
	defer wg.mu.Unlock()

	if !wg.ready {
		wg.ready = true
		close(wg.warmedCh)
		wg.logger.Info().Msg("Warmup gate: warmup complete, allowing requests")
	}
}

// IsReady returns whether warmup is complete without blocking.
func (wg *WarmupGate) IsReady() bool {
	wg.mu.RLock()
	defer wg.mu.RUnlock()
	return wg.ready
}

// Reset resets the warmup gate to not-ready state.
func (wg *WarmupGate) Reset() {
	wg.mu.Lock()
	defer wg.mu.Unlock()

	wg.ready = false
	wg.warmedCh = make(chan struct{})

	wg.logger.Info().Msg("Warmup gate: reset to not-ready state")
}
