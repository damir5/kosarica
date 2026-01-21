// Package telemetry provides OpenTelemetry support for the price service
package telemetry

import (
	"context"
	"fmt"
	"os"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/metric"
	metricnoop "go.opentelemetry.io/otel/metric/noop"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	tracenoop "go.opentelemetry.io/otel/trace/noop"
)

const (
	// DefaultServiceName is the default service name for telemetry
	DefaultServiceName = "price-service"
)

// Config holds the telemetry configuration
type Config struct {
	Enabled         bool
	Endpoint        string
	ServiceName     string
	ServiceVersion  string
	Environment     string
}

// Init initializes OpenTelemetry with the given configuration
func Init(ctx context.Context, cfg Config) (func(context.Context) error, error) {
	if !cfg.Enabled {
		// Return noop providers if telemetry is disabled
		otel.SetTracerProvider(tracenoop.NewTracerProvider())
		otel.SetMeterProvider(metricnoop.NewMeterProvider())
		otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator())
		return func(context.Context) error { return nil }, nil
	}

	if cfg.ServiceName == "" {
		cfg.ServiceName = DefaultServiceName
	}

	if cfg.ServiceVersion == "" {
		cfg.ServiceVersion = os.Getenv("VERSION")
		if cfg.ServiceVersion == "" {
			cfg.ServiceVersion = "1.0.0"
		}
	}

	if cfg.Environment == "" {
		cfg.Environment = os.Getenv("ENVIRONMENT")
		if cfg.Environment == "" {
			cfg.Environment = "production"
		}
	}

	// Create resource with service information
	res, err := resource.New(
		ctx,
		resource.WithAttributes(
			semconv.ServiceName(cfg.ServiceName),
			semconv.ServiceVersion(cfg.ServiceVersion),
			semconv.DeploymentEnvironment(cfg.Environment),
			attribute.String("service.type", "backend"),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create resource: %w", err)
	}

	// Initialize trace exporter
	traceExporter, err := otlptracegrpc.New(ctx,
		otlptracegrpc.WithEndpoint(cfg.Endpoint),
		otlptracegrpc.WithInsecure(),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create trace exporter: %w", err)
	}

	// Initialize metric exporter
	metricExporter, err := otlpmetricgrpc.New(ctx,
		otlpmetricgrpc.WithEndpoint(cfg.Endpoint),
		otlpmetricgrpc.WithInsecure(),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create metric exporter: %w", err)
	}

	// Create trace provider
	tracerProvider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(traceExporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tracerProvider)

	// Create meter provider
	meterProvider := metric.NewMeterProvider(
		metric.WithReader(metric.NewManualReader()),
		metric.WithResource(res),
	)
	otel.SetMeterProvider(meterProvider)

	// Set propagator for distributed tracing
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	// Return cleanup function
	return func(ctx context.Context) error {
		if err := tracerProvider.Shutdown(ctx); err != nil {
			return fmt.Errorf("failed to shutdown tracer provider: %w", err)
		}
		if err := meterProvider.Shutdown(ctx); err != nil {
			return fmt.Errorf("failed to shutdown meter provider: %w", err)
		}
		if err := traceExporter.Shutdown(ctx); err != nil {
			return fmt.Errorf("failed to shutdown trace exporter: %w", err)
		}
		if err := metricExporter.Shutdown(ctx); err != nil {
			return fmt.Errorf("failed to shutdown metric exporter: %w", err)
		}
		return nil
	}, nil
}

// MustInit initializes OpenTelemetry and panics on error
func MustInit(ctx context.Context, cfg Config) func(context.Context) error {
	cleanup, err := Init(ctx, cfg)
	if err != nil {
		panic(fmt.Sprintf("failed to initialize telemetry: %v", err))
	}
	return cleanup
}

// GetConfigFromEnv returns telemetry configuration from environment variables
func GetConfigFromEnv() Config {
	enabled := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") != ""
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		endpoint = "opentelemetry-collector:4317"
	}

	serviceName := os.Getenv("OTEL_SERVICE_NAME")
	if serviceName == "" {
		serviceName = DefaultServiceName
	}

	return Config{
		Enabled:     enabled,
		Endpoint:    endpoint,
		ServiceName: serviceName,
	}
}
