package config

import (
	"fmt"
	"os"
	"time"

	"github.com/spf13/viper"
)

// Config holds the application configuration
type Config struct {
	Server     ServerConfig     `mapstructure:"server"`
	Database   DatabaseConfig   `mapstructure:"database"`
	RateLimit  RateLimitConfig  `mapstructure:"rate_limit"`
	Storage    StorageConfig    `mapstructure:"storage"`
	Logging    LoggingConfig    `mapstructure:"logging"`
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
	RequestsPerSecond int    `mapstructure:"requests_per_second"`
	MaxRetries        int    `mapstructure:"max_retries"`
	InitialBackoffMs  int    `mapstructure:"initial_backoff_ms"`
	MaxBackoffMs      int    `mapstructure:"max_backoff_ms"`
}

// StorageConfig holds storage configuration
type StorageConfig struct {
	Type    string `mapstructure:"type"`
	BasePath string `mapstructure:"base_path"`
}

// LoggingConfig holds logging configuration
type LoggingConfig struct {
	Level  string `mapstructure:"level"`
	Format string `mapstructure:"format"`
	NoColor bool  `mapstructure:"no_color"`
}

var globalConfig *Config

// Load loads the configuration from file and environment variables
func Load(configPath string) (*Config, error) {
	v := viper.New()

	// Set defaults
	setDefaults(v)

	// Read config file
	if configPath != "" {
		v.SetConfigFile(configPath)
	} else {
		v.SetConfigName("config")
		v.SetConfigType("yaml")
		v.AddConfigPath("./config")
		v.AddConfigPath(".")
	}

	// Enable environment variable override
	v.AutomaticEnv()
	v.SetEnvPrefix("PRICE_SERVICE")

	// Read config file (optional)
	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("error reading config file: %w", err)
		}
		// Config file not found, use defaults and env vars
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("error unmarshaling config: %w", err)
	}

	globalConfig = &cfg
	return &cfg, nil
}

// setDefaults sets default configuration values
func setDefaults(v *viper.Viper) {
	// Server defaults
	v.SetDefault("server.port", 3003)
	v.SetDefault("server.host", "0.0.0.0")
	v.SetDefault("server.read_timeout", 30*time.Second)
	v.SetDefault("server.write_timeout", 30*time.Second)

	// Database defaults
	v.SetDefault("database.max_connections", 25)
	v.SetDefault("database.min_connections", 5)
	v.SetDefault("database.max_conn_lifetime", 1*time.Hour)
	v.SetDefault("database.max_conn_idle_time", 30*time.Minute)

	// Rate limit defaults
	v.SetDefault("rate_limit.requests_per_second", 2)
	v.SetDefault("rate_limit.max_retries", 3)
	v.SetDefault("rate_limit.initial_backoff_ms", 100)
	v.SetDefault("rate_limit.max_backoff_ms", 30000)

	// Storage defaults
	v.SetDefault("storage.type", "local")
	v.SetDefault("storage.base_path", "./data/archives")

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
