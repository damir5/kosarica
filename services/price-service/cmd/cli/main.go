package main

import (
	"context"
	"fmt"
	"io"
	"os"

	"github.com/kosarica/price-service/config"
	"github.com/kosarica/price-service/internal/database"
	"github.com/rs/zerolog"
	"github.com/spf13/cobra"
)

var (
	cfgFile string
	cfg     *config.Config
	logger  *zerolog.Logger
)

// rootCmd represents the base command when called without any subcommands
var rootCmd = &cobra.Command{
	Use:   "price-service",
	Short: "Price Service CLI - Retail price data ingestion tool",
	Long: `A CLI tool for ingesting, discovering, and parsing retail price data
from various Croatian retail chains. Supports 11 chains including Konzum, Lidl,
Plodine, Interspar, Studenac, Kaufland, Eurospin, DM, KTC, Metro, and Trgocentar.`,
	PersistentPreRunE: persistentPreRun,
}

// Execute adds all child commands to the root command and sets flags appropriately.
func Execute() error {
	return rootCmd.Execute()
}

func init() {
	cobra.OnInitialize(initConfig)

	// Persistent flags
	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is ./config/config.yaml or ./config.yaml)")
}

func initConfig() {
	var err error
	cfg, err = config.Load(cfgFile)
	if err != nil {
		// Config is optional for some commands, don't fail here
		fmt.Fprintf(os.Stderr, "Warning: failed to load config: %v\n", err)
	}
}

// persistentPreRun runs before each command and initializes dependencies
func persistentPreRun(cmd *cobra.Command, args []string) error {
	// Skip initialization for commands that don't need database/config
	if cmd.Name() == "help" || cmd.Name() == "completion" {
		return nil
	}

	// Initialize logger (use console format for CLI)
	logger = initLogger()

	// Check if this command needs database
	cmdNeedsDB := cmd.Name() == "ingest" || cmd.Name() == "run"

	if cmdNeedsDB {
		if cfg == nil {
			return fmt.Errorf("config required for %s command but not loaded", cmd.Name())
		}
		if err := initDatabase(); err != nil {
			return fmt.Errorf("database initialization failed: %w", err)
		}
		logger.Info().Msg("Database connected")
	}

	return nil
}

func initLogger() *zerolog.Logger {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix

	level := zerolog.InfoLevel
	if cfg != nil && cfg.Logging.Level != "" {
		if parsedLevel, err := zerolog.ParseLevel(cfg.Logging.Level); err == nil {
			level = parsedLevel
		}
	}

	// Always use console format for CLI
	var output io.Writer
	if cfg != nil && cfg.Logging.Format == "json" {
		output = os.Stdout
	} else {
		noColor := false
		if cfg != nil {
			noColor = cfg.Logging.NoColor
		}
		output = zerolog.ConsoleWriter{Out: os.Stdout, NoColor: noColor}
	}

	log := zerolog.New(output).Level(level).With().Timestamp().Logger()
	return &log
}

func initDatabase() error {
	dbURL := config.GetDatabaseURL()
	if dbURL == "" {
		return fmt.Errorf("DATABASE_URL not set")
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
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	return nil
}

func main() {
	if err := Execute(); err != nil {
		os.Exit(1)
	}
}
