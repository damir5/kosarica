/**
 * Real User Monitoring (RUM) via Web Vitals.
 *
 * Captures Core Web Vitals (LCP, INP, CLS) and supplementary metrics
 * (TTFB, FCP) and sends them to /api/rum via sendBeacon.
 *
 * The server logs these as structured Pino JSON which the OTel Collector
 * picks up and forwards to OpenObserve.
 */

import type { Metric } from "web-vitals";
import { clientConfig } from "@/config/clientConfig";

const RUM_ENDPOINT = "/api/rum";

function sendMetric(metric: Metric): void {
	const payload = JSON.stringify({
		name: metric.name,
		value: metric.value,
		rating: metric.rating,
		delta: metric.delta,
		id: metric.id,
		navigationType: metric.navigationType,
		path: window.location.pathname,
		release: clientConfig.VITE_APP_RELEASE,
		userAgent: navigator.userAgent,
	});

	if ("sendBeacon" in navigator) {
		const blob = new Blob([payload], { type: "application/json" });
		if (navigator.sendBeacon(RUM_ENDPOINT, blob)) return;
	}

	// Fallback to keepalive fetch
	fetch(RUM_ENDPOINT, {
		method: "POST",
		headers: { "content-type": "application/json" },
		keepalive: true,
		body: payload,
	}).catch(() => {
		// RUM is fire-and-forget
	});
}

let initialized = false;

export function initRUM(): void {
	if (typeof window === "undefined" || initialized) return;
	initialized = true;

	// Dynamic import keeps web-vitals out of the critical path
	import("web-vitals").then(({ onCLS, onINP, onLCP, onTTFB, onFCP }) => {
		onCLS(sendMetric);
		onINP(sendMetric);
		onLCP(sendMetric);
		onTTFB(sendMetric);
		onFCP(sendMetric);
	});
}
