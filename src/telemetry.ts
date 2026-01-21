/**
 * OpenTelemetry initialization for Kosarica Node.js service
 *
 * This module sets up OpenTelemetry for distributed tracing and metrics.
 * It's configured to send telemetry to an OpenTelemetry Collector.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

/**
 * Telemetry configuration
 */
export interface TelemetryConfig {
	/** Whether telemetry is enabled */
	enabled: boolean;
	/** OpenTelemetry Collector endpoint */
	endpoint: string;
	/** Service name for telemetry */
	serviceName: string;
	/** Service version */
	serviceVersion?: string;
	/** Deployment environment */
	environment?: string;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
	enabled: process.env.OTEL_EXPORTER_OTLP_ENDPOINT !== '',
	endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'opentelemetry-collector:4317',
	serviceName: process.env.OTEL_SERVICE_NAME || 'kosarica-nodejs',
	serviceVersion: process.env.VERSION || process.env.GIT_COMMIT || '1.0.0',
	environment: process.env.NODE_ENV || process.env.BUILD_ENV || 'production',
} as const satisfies TelemetryConfig;

/**
 * Get telemetry configuration from environment variables
 */
export function getTelemetryConfig(): TelemetryConfig {
	return {
		enabled: process.env.OTEL_EXPORTER_OTLP_ENDPOINT !== '',
		endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'opentelemetry-collector:4317',
		serviceName: process.env.OTEL_SERVICE_NAME || 'kosarica-nodejs',
		serviceVersion: process.env.VERSION || process.env.GIT_COMMIT || '1.0.0',
		environment: process.env.NODE_ENV || process.env.BUILD_ENV || 'production',
	};
}

/**
 * Initialize OpenTelemetry SDK
 *
 * Call this function at the very start of your application before importing other modules.
 *
 * @example
 * ```ts
 * import { initTelemetry } from './telemetry';
 *
 * const sdk = initTelemetry();
 * // Start your application
 * ```
 */
export function initTelemetry(config: Partial<TelemetryConfig> = {}): NodeSDK | null {
	const finalConfig = { ...DEFAULT_CONFIG, ...config };

	// Return null if telemetry is not enabled
	if (!finalConfig.enabled) {
		console.log('[Telemetry] OpenTelemetry disabled (no OTEL_EXPORTER_OTLP_ENDPOINT set)');
		return null;
	}

	// Create resource with service information
	const resource = Resource.default().merge(
		new Resource({
			[SEMRESATTRS_SERVICE_NAME]: finalConfig.serviceName,
			[SEMRESATTRS_SERVICE_VERSION]: finalConfig.serviceVersion,
			'service.type': 'backend',
			'deployment.environment': finalConfig.environment,
		})
	);

	// Create trace exporter
	const traceExporter = new OTLPTraceExporter({
		url: `http://${finalConfig.endpoint}`,
	});

	// Create metric exporter with periodic reader
	const metricExporter = new OTLPMetricExporter({
		url: `http://${finalConfig.endpoint}`,
	});

	const metricReader = new PeriodicExportingMetricReader({
		exporter: metricExporter,
		exportIntervalMillis: 60000, // Export metrics every 60 seconds
	});

	// Create and configure the NodeSDK
	const sdk = new NodeSDK({
		resource,
		traceExporter,
		metricReader,
		instrumentations: [
			new HttpInstrumentation({
				applyCustomAttributesOnSpan: (span: any) => {
					// Add custom attributes to HTTP spans
					span.setAttribute('service.name', finalConfig.serviceName);
				},
			}),
		],
	});

	// Initialize the SDK
	try {
		sdk.start();
		console.log(`[Telemetry] OpenTelemetry initialized for ${finalConfig.serviceName}`);
		console.log(`[Telemetry] Exporting to: ${finalConfig.endpoint}`);
		return sdk;
	} catch (error) {
		console.error('[Telemetry] Failed to initialize OpenTelemetry:', error);
		return null;
	}
}

/**
 * Shutdown OpenTelemetry SDK
 *
 * Call this function when shutting down your application.
 *
 * @param sdk - The NodeSDK instance returned from initTelemetry
 */
export async function shutdownTelemetry(sdk: NodeSDK | null): Promise<void> {
	if (sdk) {
		try {
			await sdk.shutdown();
			console.log('[Telemetry] OpenTelemetry shut down successfully');
		} catch (error) {
			console.error('[Telemetry] Error shutting down OpenTelemetry:', error);
		}
	}
}

/**
 * Get telemetry configuration from environment variables
 * @deprecated Use getTelemetryConfig() instead
 */
export function getConfigFromEnv(): TelemetryConfig {
	return getTelemetryConfig();
}
