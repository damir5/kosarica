package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/kosarica/price-service/config"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/handlers"
	"github.com/kosarica/price-service/internal/middleware"
	"github.com/rs/zerolog"
)

func main() {
	// Load configuration
	cfg, err := config.Load("")
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Initialize logger
	logger := initLogger(cfg.Logging)

	logger.Info().Msg("Starting Price Service...")

	// Connect to database
	dbURL := config.GetDatabaseURL()
	if dbURL == "" {
		logger.Fatal().Msg("DATABASE_URL not set")
	}

	ctx := context.Background()
	if err := database.Connect(
		ctx,
		dbURL,
		cfg.Database.MaxConnections,
		cfg.Database.MinConnections,
		cfg.Database.MaxConnLifetime,
		cfg.Database.MaxConnIdleTime,
	); err != nil {
		logger.Fatal().Err(err).Msg("Failed to connect to database")
	}
	defer database.Close()

	logger.Info().Msg("Database connected")

	// Set up Gin router
	if cfg.Logging.Level == "info" || cfg.Logging.Level == "debug" {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.Use(gin.Recovery())
	setupMiddleware(router, logger)

	// Register routes
	router.GET("/health", handlers.HealthCheck)

	// Ingestion routes (internal admin API)
	// Apply auth middleware to all /internal routes, then rate limiting
	// Note: More specific routes must come before generic ones
	internal := router.Group("/internal")
	internal.Use(middleware.InternalAuthMiddleware())
	internal.Use(middleware.ServiceRateLimitMiddleware(50, 100)) // 50 req/s, burst 100
	{
		// Health check endpoint
		internal.GET("/health", handlers.HealthCheck)

		// List valid chains
		internal.GET("/chains", handlers.ListChains)

		// Admin endpoints
		admin := internal.Group("/admin")
		{
			admin.POST("/ingest/:chain", handlers.IngestChain)
		}

		// Ingestion runs endpoints
		ingestion := internal.Group("/ingestion")
		{
			ingestion.GET("/runs", handlers.ListRuns)           // List all runs with filters
			ingestion.GET("/runs/:runId", handlers.GetRun)      // Get single run
			ingestion.GET("/runs/:runId/files", handlers.ListFiles)
			ingestion.GET("/runs/:runId/errors", handlers.ListErrors)
			ingestion.GET("/stats", handlers.GetStats)
			ingestion.POST("/runs/:runId/rerun", handlers.RerunRun)
			ingestion.DELETE("/runs/:runId", handlers.DeleteRun)
		}

		// Prices endpoints
		prices := internal.Group("/prices")
		{
			prices.GET("/:chainSlug/:storeId", handlers.GetStorePrices)
		}

		// Items search endpoint
		items := internal.Group("/items")
		{
			items.GET("/search", handlers.SearchItems)
		}
	}

	// Start server
	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	srv := &http.Server{
		Addr:         addr,
		Handler:      router,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}

	// Graceful shutdown
	go func() {
		logger.Info().Str("addr", addr).Msg("Server listening")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal().Err(err).Msg("Failed to start server")
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info().Msg("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error().Err(err).Msg("Server forced to shutdown")
	}

	logger.Info().Msg("Server exited")
}

func initLogger(cfg config.LoggingConfig) *zerolog.Logger {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix

	level, err := zerolog.ParseLevel(cfg.Level)
	if err != nil {
		level = zerolog.InfoLevel
	}

	var output io.Writer
	if cfg.Format == "json" {
		output = os.Stdout
	} else {
		output = zerolog.ConsoleWriter{Out: os.Stdout, NoColor: cfg.NoColor}
	}

	logger := zerolog.New(output).Level(level).With().Timestamp().Logger()

	return &logger
}

func setupMiddleware(router *gin.Engine, logger *zerolog.Logger) {
	router.Use(func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		query := c.Request.URL.RawQuery

		c.Next()

		end := time.Now()
		latency := end.Sub(start)

		logger.Info().
			Str("method", c.Request.Method).
			Str("path", path).
			Str("query", query).
			Int("status", c.Writer.Status()).
			Dur("latency", latency).
			Str("ip", c.ClientIP()).
			Msg("HTTP request")
	})
}
