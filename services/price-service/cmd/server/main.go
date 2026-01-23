package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"

	"github.com/kosarica/price-service/config"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/handlers"
	"github.com/kosarica/price-service/internal/middleware"
	"github.com/kosarica/price-service/internal/sweepers"
)

func main() {
	cfg, err := config.Load("")
	if err != nil {
		fmt.Printf("Failed to load config: %v\n", err)
		os.Exit(1)
	}
	logger := initLogger(cfg.Logging)

	logger.Info().Msg("Starting price service")

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

	if err := handleInterruptedRuns(ctx, logger); err != nil {
		logger.Warn().Err(err).Msg("Failed to handle interrupted runs")
	}

	sweeperInterval := 5 * time.Minute
	taskSweeper := sweepers.NewTaskQueueSweeper(database.Pool(), logger, sweeperInterval)
	go taskSweeper.Start(ctx)

	if cfg.Logging.Level == "info" || cfg.Logging.Level == "debug" {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.Use(gin.Recovery())
	setupMiddleware(router, logger)

	router.GET("/health", handlers.HealthCheck)

	internal := router.Group("/internal")
	internal.Use(middleware.InternalAuthMiddleware())
	internal.Use(middleware.ServiceRateLimitMiddleware(50, 100))
	{
		internal.GET("/health", handlers.HealthCheck)
		internal.GET("/chains", handlers.ListChains)

		admin := internal.Group("/admin")
		{
			admin.POST("/ingest/:chain", handlers.IngestChain)
		}

		ingestion := internal.Group("/ingestion")
		{
			ingestion.GET("/runs", handlers.ListRuns)
			ingestion.GET("/runs/:runId", handlers.GetRun)
			ingestion.GET("/runs/:runId/files", handlers.ListFiles)
			ingestion.GET("/runs/:runId/errors", handlers.ListErrors)
			ingestion.GET("/stats", handlers.GetStats)
			ingestion.POST("/runs/:runId/rerun", handlers.RerunRun)
			ingestion.DELETE("/runs/:runId", handlers.DeleteRun)
		}

		prices := internal.Group("/prices")
		{
			prices.GET("/:chainSlug/:storeId", handlers.GetStorePrices)
		}

		items := internal.Group("/items")
		{
			items.GET("/search", handlers.SearchItems)
		}
	}

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	srv := &http.Server{
		Addr:         addr,
		Handler:      router,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}

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
	taskSweeper.Stop()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error().Err(err).Msg("Server forced to shutdown")
	}

	logger.Info().Msg("Server exited")
}

func handleInterruptedRuns(ctx context.Context, logger *zerolog.Logger) error {
	pool := database.Pool()

	rows, err := pool.Query(ctx, `
		SELECT id, chain_slug, started_at, processed_files, total_files
		FROM ingestion_runs
		WHERE status = 'running'
		ORDER BY started_at DESC
	`)
	if err != nil {
		return fmt.Errorf("failed to query running runs: %w", err)
	}
	defer rows.Close()

	var runs []struct {
		ID             string
		Chain          string
		Started        time.Time
		ProcessedFiles int
		TotalFiles     int
	}

	for rows.Next() {
		var run struct {
			ID             string
			Chain          string
			Started        time.Time
			ProcessedFiles int
			TotalFiles     int
		}
		if err := rows.Scan(&run.ID, &run.Chain, &run.Started, &run.ProcessedFiles, &run.TotalFiles); err != nil {
			logger.Error().Err(err).Msg("Failed to scan run")
			continue
		}
		runs = append(runs, run)
	}

	if len(runs) == 0 {
		logger.Info().Msg("No interrupted runs found")
		return nil
	}

	for _, run := range runs {
		_, err := pool.Exec(ctx, `
			UPDATE ingestion_runs
			SET status = 'interrupted',
			    completed_at = NOW(),
			    metadata = jsonb_build_object(
				    'interrupted_reason', 'Service restarted during processing')
			WHERE id = $1
		`, run.ID)

		if err != nil {
			logger.Error().Err(err).Str("id", run.ID).Msg("Failed to mark run as interrupted")
			continue
		}
		logger.Info().
			Str("id", run.ID).
			Str("chain", run.Chain).
			Int("processed", run.ProcessedFiles).
			Int("total", run.TotalFiles).
			Msg("Marked interrupted run")
	}

	logger.Info().Int("count", len(runs)).Msg("Handled interrupted runs")
	return nil
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

	logger := zerolog.New(output).Level(level).With().Timestamp().Str("service", "price-service").Logger()
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
