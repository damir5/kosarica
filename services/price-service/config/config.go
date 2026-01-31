package config

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/spf13/viper"
)

// Config holds the application configuration
type Config struct {
	Server    ServerConfig    `mapstructure:"server"`
	Database  DatabaseConfig  `mapstructure:"database"`
	RateLimit RateLimitConfig `mapstructure:"rate_limit"`
	Storage   StorageConfig   `mapstructure:"storage"`
	Logging   LoggingConfig   `mapstructure:"logging"`
}

// ServerConfig holds HTTP server configuration
type ServerConfig struct {
	Port         int           `mapstructure:"port"`
	Host         string        `mapstructure:"host"`
	ReadTimeout  time.Duration `mapstructure:"read_timeout"`
	WriteTimeout time.Duration `mapstructure:"write_timeout"`
}

// DatabaseConfig holds database connection configuration
type DatabaseConfig struct {
	URL             string        `mapstructure:"url"`
	MaxConnections  int           `mapstructure:"max_connections"`
	MinConnections  int           `mapstructure:"min_connections"`
	MaxConnLifetime time.Duration `mapstructure:"max_conn_lifetime"`
	MaxConnIdleTime time.Duration `mapstructure:"max_conn_idle_time"`
}

// RateLimitConfig holds rate limiting configuration
type RateLimitConfig struct {
	RequestsPerSecond int `mapstructure:"requests_per_second"`
	MaxRetries        int `mapstructure:"max_retries"`
	InitialBackoffMs  int `mapstructure:"initial_backoff_ms"`
	MaxBackoffMs      int `mapstructure:"max_backoff_ms"`
}

// StorageConfig holds storage configuration
type StorageConfig struct {
	Type  string      `mapstructure:"type"`
	Local LocalConfig `mapstructure:"local"`
	S3    S3Config    `mapstructure:"s3"`
}

// LocalConfig holds local filesystem storage configuration
type LocalConfig struct {
	BasePath string `mapstructure:"base_path"`
}

// S3Config holds S3 storage configuration
type S3Config struct {
	Region         string `mapstructure:"region"`
	Bucket         string `mapstructure:"bucket"`
	Prefix         string `mapstructure:"prefix"`
	Endpoint       string `mapstructure:"endpoint"`
	ForcePathStyle bool   `mapstructure:"force_path_style"`
}

// LoggingConfig holds logging configuration
type LoggingConfig struct {
	Level   string `mapstructure:"level"`
	Format  string `mapstructure:"format"`
	NoColor bool   `mapstructure:"no_color"`
}

var globalConfig *Config

// Load loads the configuration from .env and environment variables
func Load() (*Config, error) {
	v := viper.New()

	// Set defaults
	setDefaults(v)

	// Load .env file
	if err := loadEnvFile(); err != nil {
		// .env is optional, log but don't fail
		log.Warn().Err(err).Msg("Warning: .env file not loaded")
	}

	// Enable environment variable override
	v.AutomaticEnv()
	v.SetEnvPrefix("PRICE_SERVICE")

	// Bind env keys for nested config
	bindEnvVars(v)

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("error unmarshaling config: %w", err)
	}

	globalConfig = &cfg
	return &cfg, nil
}

// loadEnvFile loads .env file by parsing KEY=VALUE lines and setting them as environment variables
func loadEnvFile() error {
	// Try to load .env file from various locations
	envPaths := []string{
		".",
		"../../..", // From services/price-service to workspace root
		"./config",
	}

	for _, path := range envPaths {
		// check both .env and .env.development so committed dev envs are picked up
		for _, name := range []string{".env", ".env.development"} {
			envFile := fmt.Sprintf("%s/%s", path, name)
			if _, err := os.Stat(envFile); err == nil {
				// Parse env file and set environment variables
				if err := loadDotEnvFile(envFile); err == nil {
					return nil
				}
			}
		}
	}
	return fmt.Errorf("no .env file found")
}

// loadDotEnvFile reads a .env file and sets environment variables
func loadDotEnvFile(filename string) error {
	file, err := os.Open(filename)
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		// Skip empty lines and comments
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Parse KEY=VALUE
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			key := strings.TrimSpace(parts[0])
			value := strings.TrimSpace(parts[1])
			// Remove quotes if present
			value = strings.Trim(value, "\"'")
			// Only set the environment variable if it's not already set in the environment.
			// This prevents .env files from overriding values explicitly exported by the
			// caller (for example when tests set PORT=3003 before starting the binary).
			if existing := os.Getenv(key); existing == "" {
				os.Setenv(key, value)
			}
		}
	}
	return scanner.Err()
}

// bindEnvVars binds environment variables to config keys
func bindEnvVars(v *viper.Viper) {
	// Server
	v.BindEnv("server.port", "PORT")
	v.BindEnv("server.host", "HOST")
	v.BindEnv("server.read_timeout", "PRICE_SERVICE_SERVER_READ_TIMEOUT")
	v.BindEnv("server.write_timeout", "PRICE_SERVICE_SERVER_WRITE_TIMEOUT")

	// Database
	v.BindEnv("database.url", "DATABASE_URL")
	v.BindEnv("database.max_connections", "PRICE_SERVICE_DATABASE_MAX_CONNECTIONS")
	v.BindEnv("database.min_connections", "PRICE_SERVICE_DATABASE_MIN_CONNECTIONS")
	v.BindEnv("database.max_conn_lifetime", "PRICE_SERVICE_DATABASE_MAX_CONN_LIFETIME")
	v.BindEnv("database.max_conn_idle_time", "PRICE_SERVICE_DATABASE_MAX_CONN_IDLE_TIME")

	// Rate Limiting
	v.BindEnv("rate_limit.requests_per_second", "PRICE_SERVICE_RATE_LIMIT_REQUESTS_PER_SECOND")
	v.BindEnv("rate_limit.max_retries", "PRICE_SERVICE_RATE_LIMIT_MAX_RETRIES")
	v.BindEnv("rate_limit.initial_backoff_ms", "PRICE_SERVICE_RATE_LIMIT_INITIAL_BACKOFF_MS")
	v.BindEnv("rate_limit.max_backoff_ms", "PRICE_SERVICE_RATE_LIMIT_MAX_BACKOFF_MS")

	// Logging
	v.BindEnv("logging.level", "LOG_LEVEL")
	v.BindEnv("logging.format", "LOG_FORMAT")
	v.BindEnv("logging.no_color", "LOG_NO_COLOR")

	// Storage
	v.BindEnv("storage.type", "STORAGE_TYPE")
	v.BindEnv("storage.local.base_path", "STORAGE_PATH")
	v.BindEnv("storage.s3.region", "STORAGE_S3_REGION")
	v.BindEnv("storage.s3.bucket", "STORAGE_S3_BUCKET")
	v.BindEnv("storage.s3.prefix", "STORAGE_S3_PREFIX")
	v.BindEnv("storage.s3.endpoint", "STORAGE_S3_ENDPOINT")
	v.BindEnv("storage.s3.force_path_style", "STORAGE_S3_FORCE_PATH_STYLE")
}

// setDefaults sets default configuration values
func setDefaults(v *viper.Viper) {
	// Server defaults
	v.SetDefault("server.port", 3000)
	v.SetDefault("server.host", "0.0.0.0")
	v.SetDefault("server.read_timeout", 30*time.Second)
	v.SetDefault("server.write_timeout", 30*time.Second)

	// Database defaults
	v.SetDefault("database.max_connections", 10)
	v.SetDefault("database.min_connections", 2)
	v.SetDefault("database.max_conn_lifetime", 1*time.Hour)
	v.SetDefault("database.max_conn_idle_time", 30*time.Minute)

	// Rate limit defaults
	v.SetDefault("rate_limit.requests_per_second", 2)
	v.SetDefault("rate_limit.max_retries", 3)
	v.SetDefault("rate_limit.initial_backoff_ms", 100)
	v.SetDefault("rate_limit.max_backoff_ms", 30000)

	// Storage defaults
	v.SetDefault("storage.type", "local")
	v.SetDefault("storage.local.base_path", "./data")

	// Logging defaults
	v.SetDefault("logging.level", "info")
	v.SetDefault("logging.format", "json")
	v.SetDefault("logging.no_color", false)
}

// Get returns the global configuration
func Get() *Config {
	return globalConfig
}

// GetDatabaseURL returns the database URL from config or environment
func GetDatabaseURL() string {
	if cfg := Get(); cfg != nil && cfg.Database.URL != "" {
		return cfg.Database.URL
	}
	return os.Getenv("DATABASE_URL")
}
