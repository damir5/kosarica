import * as z from "zod";
import { getServerConfig } from "@/config/serverConfig";
import { procedure } from "../base";

// Helper function to mask sensitive values
function maskSensitiveValue(key: string, value: string | undefined): string {
	if (!value) return "Not set";

	const sensitiveKeys = ["SECRET", "KEY", "PASSWORD", "TOKEN"];
	const isSensitive = sensitiveKeys.some((k) => key.toUpperCase().includes(k));

	if (isSensitive && value.length > 4) {
		return value.slice(0, 4) + "*".repeat(Math.min(value.length - 4, 20));
	}

	return value;
}

export const getConfigInfo = procedure.input(z.object({})).handler(async () => {
	const config = getServerConfig();

	// Build info from environment (set at build time via vite.config.ts)
	const buildInfo = {
		buildTime: process.env.BUILD_TIME || "N/A",
		gitCommit: process.env.GIT_COMMIT || "N/A",
		environment: process.env.BUILD_ENV || process.env.NODE_ENV || "N/A",
	};

	// Client config (all VITE_ prefixed variables)
	const clientConfigValues: Record<string, string> = {};
	Object.keys(config.clientConfig)
		.sort()
		.forEach((key) => {
			clientConfigValues[key] =
				(config.clientConfig as Record<string, string>)[key] || "Not set";
		});

	// Server config (with sensitive values masked)
	const serverConfig: Record<string, string> = {};
	for (const [key, value] of Object.entries(config)) {
		if (key === "clientConfig") continue;
		if (typeof value === "string") {
			serverConfig[key] = maskSensitiveValue(key, value);
		} else if (value !== undefined) {
			serverConfig[key] = String(value);
		}
	}

	// Server-side client config (for comparison with actual client values)
	const serverSideClientConfig = clientConfigValues;

	return {
		buildInfo,
		clientConfig: clientConfigValues,
		serverConfig,
		serverSideClientConfig,
	};
});
