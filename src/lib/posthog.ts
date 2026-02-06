import posthog from "posthog-js";
import { clientConfig } from "@/config/clientConfig";

let initialized = false;

function asBoolean(value: string | undefined, fallback = false): boolean {
	if (!value) return fallback;
	return value === "true" || value === "1";
}

function asNumber(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

export function initPostHog(): void {
	if (initialized || typeof window === "undefined") {
		return;
	}

	const enabled = asBoolean(clientConfig.VITE_POSTHOG_ENABLED, false);
	const key = clientConfig.VITE_POSTHOG_KEY;
	if (!enabled || !key) {
		return;
	}

	posthog.init(key, {
		api_host: clientConfig.VITE_POSTHOG_HOST,
		capture_pageview: true,
		capture_pageleave: true,
		session_recording: {
			maskAllText: true,
			maskAllElementAttributes: true,
			minimumDurationMilliseconds: 1500,
			sampleRate: asNumber(
				clientConfig.VITE_POSTHOG_SESSION_REPLAY_SAMPLE_RATE,
				0.05,
			),
		},
		autocapture: true,
		person_profiles: "identified_only",
	});

	posthog.register({
		app_release: clientConfig.VITE_APP_RELEASE,
		app_version: clientConfig.VITE_APP_VERSION,
	});

	initialized = true;
}

export function capturePostHogEvent(
	event: string,
	properties?: Record<string, unknown>,
): void {
	if (!initialized) return;
	posthog.capture(event, properties);
}
