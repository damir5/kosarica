import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { llmDecisionLog } from "@/db/schema";
import { logCatalogEvent } from "@/lib/catalog-events";
import { getDb } from "@/utils/bindings";
import { superadminProcedure, type AuthenticatedContext } from "../base";

function getContextUserId(context: unknown): string {
	return (context as AuthenticatedContext).user.id;
}

export const listLlmDecisions = superadminProcedure
	.input(
		z.object({
			taskType: z.string().optional(),
			modelId: z.string().optional(),
			verdict: z.string().optional(),
			minConfidence: z.number().min(0).max(1).optional(),
			maxConfidence: z.number().min(0).max(1).optional(),
			dateFrom: z.coerce.date().optional(),
			dateTo: z.coerce.date().optional(),
			limit: z.number().int().min(1).max(200).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const conditions = [];

		if (input.taskType) {
			conditions.push(eq(llmDecisionLog.taskType, input.taskType));
		}
		if (input.modelId) {
			conditions.push(eq(llmDecisionLog.modelId, input.modelId));
		}
		if (input.verdict) {
			conditions.push(eq(llmDecisionLog.verdict, input.verdict));
		}
		if (input.minConfidence != null) {
			conditions.push(gte(llmDecisionLog.confidence, input.minConfidence));
		}
		if (input.maxConfidence != null) {
			conditions.push(lte(llmDecisionLog.confidence, input.maxConfidence));
		}
		if (input.dateFrom) {
			conditions.push(gte(llmDecisionLog.createdAt, input.dateFrom));
		}
		if (input.dateTo) {
			conditions.push(lte(llmDecisionLog.createdAt, input.dateTo));
		}

		const where = conditions.length > 0 ? and(...conditions) : undefined;
		const rows = await db
			.select({
				id: llmDecisionLog.id,
				taskType: llmDecisionLog.taskType,
				modelId: llmDecisionLog.modelId,
				provider: llmDecisionLog.provider,
				latencyMs: llmDecisionLog.latencyMs,
				tokenCount: llmDecisionLog.tokenCount,
				costCents: llmDecisionLog.costCents,
				verdict: llmDecisionLog.verdict,
				confidence: llmDecisionLog.confidence,
				createdAt: llmDecisionLog.createdAt,
				humanOverride: llmDecisionLog.humanOverride,
				reviewedAt: llmDecisionLog.reviewedAt,
			})
			.from(llmDecisionLog)
			.where(where)
			.orderBy(desc(llmDecisionLog.createdAt))
			.limit(input.limit)
			.offset(input.offset);

		const [countRow] = await db
			.select({ count: sql<number>`count(*)` })
			.from(llmDecisionLog)
			.where(where);

		return {
			items: rows,
			total: Number(countRow?.count ?? 0),
			limit: input.limit,
			offset: input.offset,
		};
	});

export const getLlmDecision = superadminProcedure
	.input(z.object({ decisionId: z.string().min(1) }))
	.handler(async ({ input }) => {
		const db = getDb();
		const [row] = await db
			.select()
			.from(llmDecisionLog)
			.where(eq(llmDecisionLog.id, input.decisionId))
			.limit(1);
		if (!row) {
			throw new Error("Decision not found");
		}
		return row;
	});

export const overrideLlmDecision = superadminProcedure
	.input(
		z.object({
			decisionId: z.string().min(1),
			humanOverride: z.string().min(1),
			humanNotes: z.string().optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		const db = getDb();
		const userId = getContextUserId(context);

		const [updated] = await db
			.update(llmDecisionLog)
			.set({
				humanOverride: input.humanOverride,
				humanNotes: input.humanNotes ?? null,
				reviewedBy: userId,
				reviewedAt: new Date(),
			})
			.where(eq(llmDecisionLog.id, input.decisionId))
			.returning({
				id: llmDecisionLog.id,
				taskType: llmDecisionLog.taskType,
				modelId: llmDecisionLog.modelId,
				verdict: llmDecisionLog.verdict,
				confidence: llmDecisionLog.confidence,
			});

		if (!updated) {
			throw new Error("Decision not found");
		}

		await logCatalogEvent({
			eventType: "decision_overridden",
			entityType: "llm_decision",
			entityId: updated.id,
			actorId: userId,
			payload: {
				taskType: updated.taskType,
				modelId: updated.modelId,
				originalVerdict: updated.verdict,
				originalConfidence: updated.confidence,
				humanOverride: input.humanOverride,
				humanNotes: input.humanNotes ?? null,
			},
		});

		return { success: true };
	});

export const getLlmDecisionStats = superadminProcedure
	.input(
		z.object({
			dateFrom: z.coerce.date().optional(),
			dateTo: z.coerce.date().optional(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const conditions = [];
		if (input.dateFrom) {
			conditions.push(gte(llmDecisionLog.createdAt, input.dateFrom));
		}
		if (input.dateTo) {
			conditions.push(lte(llmDecisionLog.createdAt, input.dateTo));
		}
		const where = conditions.length > 0 ? and(...conditions) : undefined;
		const [row] = await db
			.select({
				total: sql<number>`count(*)`,
				avgLatencyMs: sql<number>`coalesce(avg(${llmDecisionLog.latencyMs}), 0)`,
				totalCostCents: sql<number>`coalesce(sum(${llmDecisionLog.costCents}), 0)`,
			})
			.from(llmDecisionLog)
			.where(where);

		return {
			total: Number(row?.total ?? 0),
			avgLatencyMs: Number(row?.avgLatencyMs ?? 0),
			totalCostCents: Number(row?.totalCostCents ?? 0),
		};
	});
