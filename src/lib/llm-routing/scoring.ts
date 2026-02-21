import type { RoutingCandidate } from "./types";

function clamp(min: number, value: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function computeRoutingScore(candidate: RoutingCandidate): number {
	const weight = candidate.endpoint.baseWeight ?? 1;
	const quality = clamp(0.2, candidate.qualityScore, 1.5);
	const runtime = candidate.runtime;

	if (!runtime) {
		return weight * quality;
	}

	if (runtime.circuitState === "open") {
		return 0;
	}

	const latencyMs = runtime.avgLatencyMs ?? 1000;
	const latencyFactor = clamp(0.2, 1200 / Math.max(latencyMs, 150), 1.25);
	const errorRate = runtime.errorRate ?? 0;
	const errorFactor = clamp(0.1, 1 - errorRate, 1);
	const successFactor = clamp(0.3, runtime.successRate ?? 1, 1);
	const halfOpenPenalty = runtime.circuitState === "half_open" ? 0.6 : 1;

	return weight * quality * latencyFactor * errorFactor * successFactor * halfOpenPenalty;
}

export function jitterScore(score: number): number {
	const jitter = 0.95 + Math.random() * 0.1;
	return score * jitter;
}
