/**
 * OpenTelemetry instrumentation bootstrap.
 *
 * Loaded via `node --import ./scripts/instrumentation.mjs` BEFORE any
 * application code so that HttpInstrumentation can monkey-patch the
 * built-in `http` module before it is first imported.
 *
 * The SDK is started synchronously (sdk.start()) which registers all
 * instrumentation hooks immediately.
 */

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
	const { NodeSDK } = await import("@opentelemetry/sdk-node");
	const { Resource } = await import("@opentelemetry/resources");
	const { OTLPTraceExporter } = await import(
		"@opentelemetry/exporter-trace-otlp-grpc"
	);
	const { OTLPMetricExporter } = await import(
		"@opentelemetry/exporter-metrics-otlp-grpc"
	);
	const { PeriodicExportingMetricReader } = await import(
		"@opentelemetry/sdk-metrics"
	);
	const { HttpInstrumentation } = await import(
		"@opentelemetry/instrumentation-http"
	);

	const url = endpoint.startsWith("http") ? endpoint : `http://${endpoint}`;
	const serviceName = process.env.OTEL_SERVICE_NAME || "kosarica-nodejs";

	const sdk = new NodeSDK({
		resource: new Resource({
			"service.name": serviceName,
			"service.version":
				process.env.APP_RELEASE || process.env.GIT_COMMIT || "unknown",
			"deployment.environment": process.env.BUILD_ENV || "production",
		}),
		traceExporter: new OTLPTraceExporter({ url }),
		metricReader: new PeriodicExportingMetricReader({
			exporter: new OTLPMetricExporter({ url }),
			exportIntervalMillis: 60_000,
		}),
		instrumentations: [new HttpInstrumentation()],
	});

	sdk.start();
	console.log(`[Telemetry] OpenTelemetry initialized for ${serviceName}`);
	console.log(`[Telemetry] Exporting to: ${url}`);

	// Graceful shutdown flushes pending spans/metrics
	const shutdown = async () => {
		try {
			await sdk.shutdown();
			console.log("[Telemetry] OpenTelemetry shut down");
		} catch (err) {
			console.error("[Telemetry] Shutdown error:", err);
		}
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}
