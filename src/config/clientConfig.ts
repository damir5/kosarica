// Client-side config (VITE_ prefixed variables)
// These are replaced at build time by Vite
export const clientConfig = {
	VITE_APP_NAME: import.meta.env.VITE_APP_NAME || "Kosarica",
	VITE_APP_RELEASE:
		import.meta.env.VITE_APP_RELEASE ||
		process.env.APP_RELEASE ||
		process.env.GIT_COMMIT ||
		"unknown",
	VITE_APP_VERSION:
		import.meta.env.VITE_APP_VERSION || process.env.APP_VERSION || "0.1.0",
	VITE_POSTHOG_ENABLED: import.meta.env.VITE_POSTHOG_ENABLED || "false",
	VITE_POSTHOG_HOST:
		import.meta.env.VITE_POSTHOG_HOST || "https://eu.i.posthog.com",
	VITE_POSTHOG_KEY: import.meta.env.VITE_POSTHOG_KEY || "",
	VITE_POSTHOG_SESSION_REPLAY_SAMPLE_RATE:
		import.meta.env.VITE_POSTHOG_SESSION_REPLAY_SAMPLE_RATE || "0.05",
};
