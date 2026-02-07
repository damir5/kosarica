import { getEnv } from "@/utils/bindings";

export function getServerConfig() {
	const env = getEnv();

	return {
		BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
		BETTER_AUTH_URL: env.BETTER_AUTH_URL,
		PASSKEY_RP_ID: env.PASSKEY_RP_ID,
		PASSKEY_RP_NAME: env.PASSKEY_RP_NAME,
		LLM_ENSEMBLE_JSON: env.LLM_ENSEMBLE_JSON,
		// Client config (VITE_ prefixed variables available at build time)
		clientConfig: {
			VITE_APP_NAME: process.env.VITE_APP_NAME || "Kosarica",
		},
	};
}
