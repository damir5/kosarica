/**
 * OpenTelemetry instrumentation for Kosarica Node.js service
 *
 * This file initializes OpenTelemetry BEFORE any other imports.
 * It should be loaded via Node's --require flag or imported first in server.ts
 *
 * IMPORTANT: This must be loaded before any other application code for proper
 * automatic instrumentation of modules.
 */

import { initTelemetry } from "./telemetry";

// Initialize OpenTelemetry immediately when this module is loaded
// This ensures telemetry is active before any other code runs
// Note: This is async, but we fire-and-forget since telemetry init shouldn't block app startup
let sdk: unknown = null;
const initPromise = initTelemetry().then((initializedSdk) => {
	sdk = initializedSdk;
});

// Export the SDK instance and promise for shutdown later
export { sdk, initPromise };
