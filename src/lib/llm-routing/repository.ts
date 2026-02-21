import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
	llmDecisionLog,
	llmEndpointCapabilities,
	llmEndpointHealthChecks,
	llmEndpointQualityDaily,
	llmEndpointRuntime,
	llmEndpoints,
	llmRoutingDecisions,
} from "@/db/schema";
import { getDb } from "@/utils/bindings";
import type {
	EndpointResultMetrics,
	LlmCapability,
	RoutingCandidate,
	RoutingDecision,
} from "./types";
import { computeRoutingScore, jitterScore } from "./scoring";

export async function loadRoutingCandidates(
	capability: LlmCapability,
): Promise<RoutingCandidate[]> {
	const db = getDb();
	const rows = await db
		.select({
			endpoint: llmEndpoints,
			capability: llmEndpointCapabilities,
			runtime: llmEndpointRuntime,
		})
		.from(llmEndpointCapabilities)
		.innerJoin(
			llmEndpoints,
			eq(llmEndpointCapabilities.endpointId, llmEndpoints.id),
		)
		.leftJoin(llmEndpointRuntime, eq(llmEndpointRuntime.endpointId, llmEndpoints.id))
		.where(
			and(
				eq(llmEndpointCapabilities.capability, capability),
				eq(llmEndpoints.enabled, true),
			),
		);

	const today = new Date();
	today.setUTCHours(0, 0, 0, 0);

	const qualityRows = await db
		.select({
			endpointId: llmEndpointQualityDaily.endpointId,
			qualityScore: llmEndpointQualityDaily.qualityScore,
		})
		.from(llmEndpointQualityDaily)
		.where(gte(llmEndpointQualityDaily.day, today.toISOString().slice(0, 10)));

	const qualityByEndpoint = new Map(
		qualityRows.map((row) => [row.endpointId, row.qualityScore] as const),
	);

	return rows
		.map((row) => {
			const qualityScore = qualityByEndpoint.get(row.endpoint.id) ?? 1;
			const candidate: RoutingCandidate = {
				endpoint: row.endpoint,
				capability: row.capability,
				runtime: row.runtime,
				qualityScore,
				routingScore: 0,
			};
			const score = computeRoutingScore(candidate);
			return {
				...candidate,
				routingScore: jitterScore(score),
			};
		})
		.filter((candidate) => candidate.routingScore > 0)
		.sort((a, b) => b.routingScore - a.routingScore);
}

export async function persistRoutingDecision(
	capability: LlmCapability,
	decision: RoutingDecision,
): Promise<void> {
	const db = getDb();
	await db.insert(llmRoutingDecisions).values({
		capability,
		selectedEndpointId: decision.selected.endpoint.id,
		reason: decision.reason,
		selectedScore: decision.selected.routingScore,
		candidateCount: decision.candidates.length,
		createdAt: new Date(),
	});
}

export async function persistEndpointCheck(
	endpointId: string,
	metrics: EndpointResultMetrics,
	checkType: "active" | "passive",
): Promise<void> {
	const db = getDb();
	await db.insert(llmEndpointHealthChecks).values({
		endpointId,
		checkType,
		success: metrics.success,
		latencyMs: Math.max(0, Math.round(metrics.latencyMs)),
		statusCode: metrics.statusCode ?? null,
		errorMessage: metrics.errorMessage ?? null,
		checkedAt: new Date(),
	});
}

export async function updateEndpointRuntime(
	endpointId: string,
	metrics: EndpointResultMetrics,
): Promise<void> {
	const db = getDb();
	const now = new Date();
	const [existing] = await db
		.select()
		.from(llmEndpointRuntime)
		.where(eq(llmEndpointRuntime.endpointId, endpointId))
		.limit(1);

	const prevSuccessRate = existing?.successRate ?? 1;
	const prevErrorRate = existing?.errorRate ?? 0;
	const prevLatency = existing?.avgLatencyMs ?? metrics.latencyMs;
	const alpha = 0.2;
	const successSample = metrics.success ? 1 : 0;
	const errorSample = metrics.success ? 0 : 1;

	const successRate = prevSuccessRate * (1 - alpha) + successSample * alpha;
	const errorRate = prevErrorRate * (1 - alpha) + errorSample * alpha;
	const avgLatencyMs = prevLatency * (1 - alpha) + metrics.latencyMs * alpha;
	const consecutiveFailures = metrics.success
		? 0
		: (existing?.consecutiveFailures ?? 0) + 1;

	const shouldOpen = consecutiveFailures >= 3;
	const circuitState = shouldOpen
		? "open"
		: existing?.circuitState === "open"
			? "half_open"
			: "closed";
	const cooldownUntil = shouldOpen ? new Date(now.getTime() + 5 * 60 * 1000) : null;

	await db
		.insert(llmEndpointRuntime)
		.values({
			endpointId,
			circuitState,
			cooldownUntil,
			consecutiveFailures,
			successRate,
			errorRate,
			avgLatencyMs,
			lastSuccessAt: metrics.success ? now : existing?.lastSuccessAt ?? null,
			lastFailureAt: metrics.success ? existing?.lastFailureAt ?? null : now,
			lastErrorMessage: metrics.success ? null : metrics.errorMessage ?? null,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: llmEndpointRuntime.endpointId,
			set: {
				circuitState,
				cooldownUntil,
				consecutiveFailures,
				successRate,
				errorRate,
				avgLatencyMs,
				lastSuccessAt: metrics.success
					? now
					: existing?.lastSuccessAt ?? null,
				lastFailureAt: metrics.success
					? existing?.lastFailureAt ?? null
					: now,
				lastErrorMessage: metrics.success ? null : metrics.errorMessage ?? null,
				updatedAt: now,
			},
		});
}

export async function updateDailyQualityScores(): Promise<void> {
	const db = getDb();
	const day = new Date();
	day.setUTCHours(0, 0, 0, 0);
	const dayIso = day.toISOString().slice(0, 10);

	const stats = await db
		.select({
			endpointId: llmDecisionLog.endpointId,
			count: sql<number>`count(*)`,
			overrides: sql<number>`count(*) FILTER (WHERE ${llmDecisionLog.humanOverride} IS NOT NULL)`,
			lowConfidence: sql<number>`count(*) FILTER (WHERE ${llmDecisionLog.confidence} IS NOT NULL AND ${llmDecisionLog.confidence} < 0.7)`,
		})
		.from(llmDecisionLog)
		.where(
			and(
				eq(sql`date_trunc('day', ${llmDecisionLog.createdAt})`, sql`${dayIso}::date`),
				sql`${llmDecisionLog.endpointId} IS NOT NULL`,
			),
		)
		.groupBy(llmDecisionLog.endpointId);

	for (const row of stats) {
		if (!row.endpointId) {
			continue;
		}
		const decisionCount = row.count ?? 0;
		const overrideCount = row.overrides ?? 0;
		const lowConfidenceCount = row.lowConfidence ?? 0;
		const overrideRatio = decisionCount > 0 ? overrideCount / decisionCount : 0;
		const lowConfidenceRatio =
			decisionCount > 0 ? lowConfidenceCount / decisionCount : 0;
		const qualityScore = Math.max(0.2, 1 - overrideRatio * 0.7 - lowConfidenceRatio * 0.3);

		await db
			.insert(llmEndpointQualityDaily)
			.values({
				endpointId: row.endpointId,
				day: dayIso,
				decisionCount,
				overrideCount,
				lowConfidenceCount,
				qualityScore,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: [llmEndpointQualityDaily.endpointId, llmEndpointQualityDaily.day],
				set: {
					decisionCount,
					overrideCount,
					lowConfidenceCount,
					qualityScore,
					updatedAt: new Date(),
				},
			});
	}
}

export async function listEnabledEndpoints() {
	const db = getDb();
	return db
		.select()
		.from(llmEndpoints)
		.where(eq(llmEndpoints.enabled, true))
		.orderBy(desc(llmEndpoints.createdAt));
}
