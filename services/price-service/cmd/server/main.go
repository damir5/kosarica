// @title Price Service API
// @version 1.0
// @description Internal API for price data management, ingestion monitoring, and basket optimization.
// @BasePath /internal

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
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"

	"github.com/kosarica/price-service/config"
	_ "github.com/kosarica/price-service/docs" // Swagger generated docs
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
	"github.com/kosarica/price-service/internal/handlers"
	"github.com/kosarica/price-service/internal/ingestion"
	"github.com/kosarica/price-service/internal/middleware"
	"github.com/kosarica/price-service/internal/optimizer"
	"github.com/kosarica/price-service/internal/pipeline"
	"github.com/kosarica/price-service/internal/sweepers"
	"github.com/kosarica/price-service/internal/taskqueue"
	"github.com/kosarica/price-service/internal/workers"
)

// startIngestionWorkers creates and starts dedicated ingestion worker pools
// Returns all worker instances for proper shutdown
func startIngestionWorkers(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, logger *zerolog.Logger) []*workers.Worker {
	tq := taskqueue.New(pool)
	workersList := make([]*workers.Worker, 0, 5)

	// Initialize cluster semaphore based on configured heap size
	ingestion.InitClusterSemaphore(cfg.Ingestion.HeapMB)
	clusterSlots := ingestion.GetClusterSlots()

	// Discovery workers (light DB usage - creates run, discovers files)
	discoverWorker := workers.New(tq, workers.WorkerConfig{
		WorkerID:   "discover-worker",
		TaskTypes:  []string{"ingestion_discover"},
		MaxTasks:   1,
		NumWorkers: 2,
		PollDelay:  5 * time.Second,
	})
	discoverWorker.RegisterExtendedHandler("ingestion_discover", handlers.HandleDiscoverTask)
	discoverWorker.Start(ctx)
	workersList = append(workersList, discoverWorker)

	// Fetch+Parse workers (no DB connections held - archives to storage)
	fetchParseWorker := workers.New(tq, workers.WorkerConfig{
		WorkerID:   "fetch-parse-worker",
		TaskTypes:  []string{"ingestion_fetch_parse"},
		MaxTasks:   1,
		NumWorkers: 10, // High parallelism - no DB connection contention
		PollDelay:  3 * time.Second,
	})
	fetchParseWorker.RegisterHandler("ingestion_fetch_parse", handlers.HandleFetchParseTask)
	fetchParseWorker.Start(ctx)
	workersList = append(workersList, fetchParseWorker)

	// Store Prep workers (short DB transactions - upserts stores)
	storePrepWorker := workers.New(tq, workers.WorkerConfig{
		WorkerID:   "store-prep-worker",
		TaskTypes:  []string{"ingestion_store_prep"},
		MaxTasks:   1,
		NumWorkers: 2,
		PollDelay:  5 * time.Second,
	})
	storePrepWorker.RegisterExtendedHandler("ingestion_store_prep", handlers.HandleStorePrepTask)
	storePrepWorker.Start(ctx)
	workersList = append(workersList, storePrepWorker)

	// Cluster workers (heavy memory usage - controlled by semaphore)
	// NumWorkers should match or exceed semaphore slots to avoid starvation
	clusterWorker := workers.New(tq, workers.WorkerConfig{
		WorkerID:   "cluster-worker",
		TaskTypes:  []string{"ingestion_cluster"},
		MaxTasks:   1,
		NumWorkers: int(clusterSlots) + 1, // Semaphore controls actual concurrency
		PollDelay:  5 * time.Second,
	})
	clusterWorker.RegisterExtendedHandler("ingestion_cluster", handlers.HandleClusterTask)
	clusterWorker.Start(ctx)
	workersList = append(workersList, clusterWorker)

	// Finalize workers (light DB usage - updates status)
	finalizeWorker := workers.New(tq, workers.WorkerConfig{
		WorkerID:   "finalize-worker",
		TaskTypes:  []string{"ingestion_finalize"},
		MaxTasks:   1,
		NumWorkers: 2,
		PollDelay:  5 * time.Second,
	})
	finalizeWorker.RegisterHandler("ingestion_finalize", handlers.HandleFinalizeTask)
	finalizeWorker.Start(ctx)
	workersList = append(workersList, finalizeWorker)

	logger.Info().
		Str("component", "workers").
		Int("discover_workers", 2).
		Int("fetch_parse_workers", 10).
		Int("store_prep_workers", 2).
		Int64("cluster_slots", clusterSlots).
		Int("finalize_workers", 2).
		Msg("Ingestion worker pools started")

	return workersList
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Printf("Failed to load config: %v\n", err)
		os.Exit(1)
	}
	logger := initLogger(cfg.Logging)
	// Ensure global logger uses the same output/level as the service logger.
	log.Logger = *logger

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

	// Initialize optimizer components
	optimizerConfig := optimizer.DefaultOptimizerConfig()
	priceCache := optimizer.NewPriceCache(database.Pool(), optimizerConfig)
	metricsRecorder := optimizer.NewMetricsRecorder()
	optimizerHandler := handlers.NewOptimizerHandler(priceCache, optimizerConfig, metricsRecorder)

	// Start cache warmup in background
	go func() {
		if err := priceCache.StartWarmup(ctx); err != nil {
			logger.Error().Err(err).Msg("Failed to warmup price cache")
		}
	}()

	if err := resumeInterruptedRuns(ctx, logger); err != nil {
		logger.Warn().Err(err).Msg("Failed to resume interrupted runs")
	}

	sweeperInterval := 5 * time.Minute
	taskSweeper := sweepers.NewTaskQueueSweeper(database.Pool(), logger, sweeperInterval)
	go taskSweeper.Start(ctx)

	// Start dedicated ingestion workers
	ingestionWorkers := startIngestionWorkers(ctx, database.Pool(), cfg, logger)
	defer func() {
		for _, w := range ingestionWorkers {
			w.Stop()
		}
	}()

	if cfg.Logging.Level == "info" || cfg.Logging.Level == "debug" {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.Use(gin.Recovery())
	setupMiddleware(router, logger)

	router.GET("/health", handlers.HealthCheck)

	// Swagger UI endpoint - serves OpenAPI spec and interactive documentation
	router.GET("/docs/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

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
			ingestion.GET("/runs/:runId/stores", handlers.ListRunStoreStats)
			ingestion.GET("/files/:fileId", handlers.GetFile)
			ingestion.GET("/files/:fileId/chunks", handlers.ListChunks)
			ingestion.GET("/files/:fileId/errors", handlers.ListFileErrors)
			ingestion.GET("/files/:fileId/stores", handlers.ListFileStoreStats)
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

		// Register optimizer routes
		handlers.RegisterOptimizerRoutes(internal, optimizerHandler)
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

func resumeInterruptedRuns(ctx context.Context, logger *zerolog.Logger) error {
	pool := database.Pool()

	rows, err := pool.Query(ctx, `
		SELECT id, chain_slug
		FROM ingestion_runs
		WHERE status = 'running'
		ORDER BY started_at DESC
	`)
	if err != nil {
		return fmt.Errorf("failed to query running runs: %w", err)
	}
	defer rows.Close()

	var runs []struct {
		ID    string
		Chain string
	}

	for rows.Next() {
		var run struct {
			ID    string
			Chain string
		}
		if err := rows.Scan(&run.ID, &run.Chain); err != nil {
			logger.Error().Err(err).Msg("Failed to scan run")
			continue
		}
		runs = append(runs, run)
	}

	// Check for iteration errors
	if err := rows.Err(); err != nil {
		return fmt.Errorf("error iterating rows: %w", err)
	}

	if len(runs) == 0 {
		logger.Info().Msg("No interrupted runs found")
		return nil
	}

	for _, run := range runs {
		// Attempt to resume the run
		resumed, err := pipeline.ResumeRun(ctx, run.ID, run.Chain)

		if err != nil {
			logger.Error().Err(err).Str("run_id", run.ID).Msg("Failed to resume run")
			// Mark as interrupted (fallback)
			markRunInterrupted(ctx, run.ID)
			continue
		}

		if !resumed {
			// No files to process, mark as interrupted
			logger.Info().Str("run_id", run.ID).Msg("No files to resume, marking as interrupted")
			markRunInterrupted(ctx, run.ID)
		} else {
			logger.Info().Str("run_id", run.ID).Msg("Resumed interrupted run")
		}
	}

	logger.Info().Int("count", len(runs)).Msg("Handled interrupted runs")
	return nil
}

// markRunInterrupted marks a run as interrupted when resumption is not possible
func markRunInterrupted(ctx context.Context, runID string) {
	queries := sqlcgen.New(database.Pool())
	now := time.Now()
	_ = queries.UpdateRunInterrupted(ctx, sqlcgen.UpdateRunInterruptedParams{
		CompletedAt: pgtype.Timestamp{Time: now, Valid: true},
		ID:          runID,
	})
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
