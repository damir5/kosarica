package handlers

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/jobs"
	"github.com/kosarica/price-service/internal/matching"
	"github.com/kosarica/price-service/internal/pkg/cuid2"
)

// MatchingHandler handles product matching HTTP endpoints
type MatchingHandler struct {
	db       *pgxpool.Pool
	provider matching.EmbeddingProvider
}

// NewMatchingHandler creates a new matching handler
func NewMatchingHandler(db *pgxpool.Pool, provider matching.EmbeddingProvider) *MatchingHandler {
	return &MatchingHandler{
		db:       db,
		provider: provider,
	}
}

// TriggerBarcodeMatchingRequest represents the request to trigger barcode matching
type TriggerBarcodeMatchingRequest struct {
	BatchSize int `json:"batchSize" binding:"min=1,max=1000"`
}

// BarcodeMatchingResponse represents the response from barcode matching
type BarcodeMatchingResponse struct {
	RunID       string `json:"runId"`
	NewProducts int    `json:"newProducts"`
	NewLinks    int    `json:"newLinks"`
	Suspicious  int    `json:"suspiciousFlags"`
	Skipped     int    `json:"skipped"`
}

// TriggerBarcodeMatching triggers barcode-based product matching
// POST /internal/matching/barcode
func (h *MatchingHandler) TriggerBarcodeMatching(c *gin.Context) {
	var req TriggerBarcodeMatchingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// Use default batch size if not provided or invalid
		req.BatchSize = 100
	}

	runID := cuid2.GeneratePrefixedId("run", cuid2.PrefixedIdOptions{})
	slog.Info("triggering barcode matching", "run_id", runID, "batch_size", req.BatchSize)

	ctx := c.Request.Context()
	result, err := matching.AutoMatchByBarcode(ctx, h.db, req.BatchSize)
	if err != nil {
		slog.Error("barcode matching failed", "run_id", runID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Barcode matching failed: " + err.Error(),
			"runId": runID,
		})
		return
	}

	c.JSON(http.StatusOK, BarcodeMatchingResponse{
		RunID:       runID,
		NewProducts: result.NewProducts,
		NewLinks:    result.NewLinks,
		Suspicious:  result.SuspiciousFlags,
		Skipped:     result.Skipped,
	})
}

// TriggerAIMatchingRequest represents the request to trigger AI matching
type TriggerAIMatchingRequest struct {
	AutoLinkThreshold float32 `json:"autoLinkThreshold" binding:"min=0,max=1"`
	ReviewThreshold   float32 `json:"reviewThreshold" binding:"min=0,max=1"`
	BatchSize         int     `json:"batchSize" binding:"min=1,max=1000"`
}

// AIMatchingResponse represents the response from AI matching
type AIMatchingResponse struct {
	RunID           string `json:"runId"`
	Processed       int    `json:"processed"`
	HighConfidence  int    `json:"highConfidence"`
	QueuedForReview int    `json:"queuedForReview"`
	NoMatch         int    `json:"noMatch"`
	CacheHits       int    `json:"cacheHits"`
}

// TriggerAIMatching triggers AI-based product matching
// POST /internal/matching/ai
func (h *MatchingHandler) TriggerAIMatching(c *gin.Context) {
	if h.provider == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Embedding provider not configured",
		})
		return
	}

	var req TriggerAIMatchingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// Use defaults if not provided
		req.AutoLinkThreshold = 0.95
		req.ReviewThreshold = 0.80
		req.BatchSize = 100
	}

	runID := cuid2.GeneratePrefixedId("run", cuid2.PrefixedIdOptions{})
	slog.Info("triggering AI matching", "run_id", runID,
		"auto_link_threshold", req.AutoLinkThreshold,
		"review_threshold", req.ReviewThreshold)

	cfg := matching.AIMatcherConfig{
		Provider:          h.provider,
		AutoLinkThreshold: req.AutoLinkThreshold,
		ReviewThreshold:   req.ReviewThreshold,
		BatchSize:         req.BatchSize,
		MaxCandidates:     5,
		TrgmPrefilter:     200,
	}

	ctx := c.Request.Context()
	result, err := matching.RunAIMatching(ctx, h.db, cfg, runID)
	if err != nil {
		slog.Error("AI matching failed", "run_id", runID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "AI matching failed: " + err.Error(),
			"runId": runID,
		})
		return
	}

	c.JSON(http.StatusOK, AIMatchingResponse{
		RunID:           runID,
		Processed:       result.Processed,
		HighConfidence:  result.HighConfidence,
		QueuedForReview: result.QueuedForReview,
		NoMatch:         result.NoMatch,
		CacheHits:       result.CacheHits,
	})
}

// WarmupProductEmbeddingsRequest warms up the product embedding cache
// POST /internal/matching/warmup
func (h *MatchingHandler) WarmupProductEmbeddings(c *gin.Context) {
	if h.provider == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Embedding provider not configured",
		})
		return
	}

	slog.Info("warming up product embeddings", "model", h.provider.ModelVersion())

	ctx := c.Request.Context()
	if err := matching.EnsureProductEmbeddings(ctx, h.db, h.provider); err != nil {
		slog.Error("product embedding warmup failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Embedding warmup failed: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Product embeddings warmed up",
		"model":   h.provider.ModelVersion(),
	})
}

// GetMatchingStatus returns the current status of matching runs
// GET /internal/matching/status
func (h *MatchingHandler) GetMatchingStatus(c *gin.Context) {
	ctx := c.Request.Context()

	// Get queue statistics
	var pendingCount, approvedCount, rejectedCount int
	_ = h.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM product_match_queue WHERE status = 'pending'
	`).Scan(&pendingCount)

	_ = h.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM product_match_queue WHERE status = 'approved'
	`).Scan(&approvedCount)

	_ = h.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM product_match_queue WHERE status = 'rejected'
	`).Scan(&rejectedCount)

	// Get candidate statistics
	var candidateCount int
	_ = h.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM product_match_candidates
	`).Scan(&candidateCount)

	// Get link statistics
	var totalLinks int
	_ = h.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM product_links
	`).Scan(&totalLinks)

	var barcodeLinks int
	_ = h.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM product_links WHERE match_type = 'barcode'
	`).Scan(&barcodeLinks)

	var aiLinks int
	_ = h.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM product_links WHERE match_type = 'ai'
	`).Scan(&aiLinks)

	// Get cleanup stats
	cfg := jobs.DefaultCleanupConfig()
	cleanupStats, _ := jobs.GetCleanupStats(ctx, h.db, cfg)

	c.JSON(http.StatusOK, gin.H{
		"queue": gin.H{
			"pending":  pendingCount,
			"approved": approvedCount,
			"rejected": rejectedCount,
		},
		"candidates": gin.H{
			"total": candidateCount,
		},
		"links": gin.H{
			"total":   totalLinks,
			"barcode": barcodeLinks,
			"ai":      aiLinks,
		},
		"cleanup": cleanupStats,
	})
}

// TriggerCleanupRequest represents the request to trigger cleanup
type TriggerCleanupRequest struct {
	DryRun bool `json:"dryRun"`
}

// TriggerCleanup runs cleanup jobs
// POST /internal/matching/cleanup
func (h *MatchingHandler) TriggerCleanup(c *gin.Context) {
	var req TriggerCleanupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		req.DryRun = false
	}

	ctx := c.Request.Context()

	if req.DryRun {
		cfg := jobs.DefaultCleanupConfig()
		stats, err := jobs.GetCleanupStats(ctx, h.db, cfg)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"dryRun": true,
			"stats":  stats,
		})
		return
	}

	if err := jobs.RunAllCleanupJobs(ctx, h.db); err != nil {
		slog.Error("cleanup jobs failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Cleanup failed: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Cleanup completed",
	})
}

// RegisterMatchingRoutes registers matching routes with the Gin router
func RegisterMatchingRoutes(r *gin.RouterGroup, db *pgxpool.Pool, provider matching.EmbeddingProvider) {
	handler := NewMatchingHandler(db, provider)

	r.POST("/matching/barcode", handler.TriggerBarcodeMatching)
	r.POST("/matching/ai", handler.TriggerAIMatching)
	r.POST("/matching/warmup", handler.WarmupProductEmbeddings)
	r.GET("/matching/status", handler.GetMatchingStatus)
	r.POST("/matching/cleanup", handler.TriggerCleanup)
}

// ============================================================================
// Legacy helper functions (for backward compatibility)
// ============================================================================

// AutoMatchByBarcode is a legacy wrapper that uses the database pool
// TODO: Remove once all callers are updated to use MatchingHandler
func AutoMatchByBarcode(batchSize int) (*matching.BarcodeResult, error) {
	db := database.Pool()
	return matching.AutoMatchByBarcode(context.Background(), db, batchSize)
}

// RunAIMatching is a legacy wrapper that uses the database pool
// TODO: Remove once all callers are updated to use MatchingHandler
func RunAIMatching(cfg matching.AIMatcherConfig, runID string) (*matching.AIMatchResult, error) {
	db := database.Pool()
	return matching.RunAIMatching(context.Background(), db, cfg, runID)
}

// GetMatchingStatsJSON returns matching statistics as JSON
func GetMatchingStatsJSON() (string, error) {
	db := database.Pool()
	ctx := context.Background()

	stats := make(map[string]interface{})

	// Queue stats
	var pendingCount int
	_ = db.QueryRow(ctx, `SELECT COUNT(*) FROM product_match_queue WHERE status = 'pending'`).Scan(&pendingCount)
	stats["pendingQueue"] = pendingCount

	// Candidate stats
	var candidateCount int
	_ = db.QueryRow(ctx, `SELECT COUNT(*) FROM product_match_candidates`).Scan(&candidateCount)
	stats["candidates"] = candidateCount

	// Link stats
	var linkCount int
	_ = db.QueryRow(ctx, `SELECT COUNT(*) FROM product_links`).Scan(&linkCount)
	stats["totalLinks"] = linkCount

	bytes, err := json.Marshal(stats)
	if err != nil {
		return "", err
	}

	return string(bytes), nil
}
