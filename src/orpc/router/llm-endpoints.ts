import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
	llmEndpointCapabilities,
	llmEndpointHealthChecks,
	llmEndpointQualityDaily,
	llmEndpointRuntime,
	llmEndpoints,
} from "@/db/schema";
import { getDb } from "@/utils/bindings";
import { superadminProcedure } from "../base";

const providerSchema = z.enum([
	"openai",
	"claude",
	"openrouter",
	"vertex-express",
	"zai",
]);

const capabilitySchema = z.enum([
	"matching_primary",
	"matching_secondary",
	"categorization_primary",
	"categorization_secondary",
]);

export const list = superadminProcedure.handler(async () => {
	const db = getDb();
	const endpoints = await db
		.select({
			endpoint: llmEndpoints,
			runtime: llmEndpointRuntime,
		})
		.from(llmEndpoints)
		.leftJoin(llmEndpointRuntime, eq(llmEndpointRuntime.endpointId, llmEndpoints.id))
		.orderBy(llmEndpoints.name);

	const capabilities = await db.select().from(llmEndpointCapabilities);
	const byEndpointId = new Map<string, string[]>();
	for (const capability of capabilities) {
		const current = byEndpointId.get(capability.endpointId) ?? [];
		current.push(capability.capability);
		byEndpointId.set(capability.endpointId, current);
	}

	return endpoints.map((row) => ({
		...row.endpoint,
		runtime: row.runtime,
		capabilities: byEndpointId.get(row.endpoint.id) ?? [],
	}));
});

export const create = superadminProcedure
	.input(
		z.object({
			name: z.string().min(1),
			provider: providerSchema,
			model: z.string().min(1),
			endpoint: z.string().url(),
			apiKeyEnv: z.string().min(1),
			baseWeight: z.number().positive().default(1),
			timeoutMs: z.number().int().positive().default(20_000),
			maxRetries: z.number().int().min(0).max(5).default(1),
			responseFormat: z
				.enum(["json_object", "json_schema", "text", "none"])
				.optional(),
			jsonSchemaNullable: z.boolean().optional(),
			maxTokens: z.number().int().positive().optional(),
			capabilities: z.array(capabilitySchema).min(1),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const [endpoint] = await db
			.insert(llmEndpoints)
			.values({
				name: input.name,
				provider: input.provider,
				model: input.model,
				endpoint: input.endpoint,
				apiKeyEnv: input.apiKeyEnv,
				baseWeight: input.baseWeight,
				timeoutMs: input.timeoutMs,
				maxRetries: input.maxRetries,
				responseFormat: input.responseFormat ?? null,
				jsonSchemaNullable: input.jsonSchemaNullable ?? false,
				maxTokens: input.maxTokens ?? null,
				enabled: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.returning();

		await db.insert(llmEndpointCapabilities).values(
			input.capabilities.map((capability) => ({
				endpointId: endpoint.id,
				capability,
				createdAt: new Date(),
			})),
		);

		return endpoint;
	});

export const toggle = superadminProcedure
	.input(
		z.object({
			endpointId: z.string(),
			enabled: z.boolean(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const [updated] = await db
			.update(llmEndpoints)
			.set({ enabled: input.enabled, updatedAt: new Date() })
			.where(eq(llmEndpoints.id, input.endpointId))
			.returning();
		if (!updated) {
			throw new Error(`Endpoint not found: ${input.endpointId}`);
		}
		return updated;
	});

export const setCapabilities = superadminProcedure
	.input(
		z.object({
			endpointId: z.string(),
			capabilities: z.array(capabilitySchema),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		await db
			.delete(llmEndpointCapabilities)
			.where(eq(llmEndpointCapabilities.endpointId, input.endpointId));
		if (input.capabilities.length > 0) {
			await db.insert(llmEndpointCapabilities).values(
				input.capabilities.map((capability) => ({
					endpointId: input.endpointId,
					capability,
					createdAt: new Date(),
				})),
			);
		}
		return { success: true };
	});

export const health = superadminProcedure
	.input(
		z.object({
			endpointIds: z.array(z.string()).optional(),
			limit: z.number().int().min(1).max(200).default(50),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const rows = await db
			.select()
			.from(llmEndpointHealthChecks)
			.where(
				input.endpointIds && input.endpointIds.length > 0
					? inArray(llmEndpointHealthChecks.endpointId, input.endpointIds)
					: undefined,
			)
			.orderBy(desc(llmEndpointHealthChecks.checkedAt))
			.limit(input.limit);
		return rows;
	});

export const quality = superadminProcedure
	.input(
		z.object({
			endpointId: z.string().optional(),
			limit: z.number().int().min(1).max(120).default(30),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const rows = await db
			.select()
			.from(llmEndpointQualityDaily)
			.where(
				input.endpointId
					? eq(llmEndpointQualityDaily.endpointId, input.endpointId)
					: undefined,
			)
			.orderBy(desc(llmEndpointQualityDaily.day))
			.limit(input.limit);
		return rows;
	});

export const stats = superadminProcedure.handler(async () => {
	const db = getDb();
	const [summary] = await db
		.select({
			totalEndpoints: sql<number>`count(*)`,
			enabledEndpoints: sql<number>`count(*) FILTER (WHERE enabled = true)`,
		})
		.from(llmEndpoints);

	const [runtimeSummary] = await db
		.select({
			openCircuits: sql<number>`count(*) FILTER (WHERE circuit_state = 'open')`,
			halfOpenCircuits: sql<number>`count(*) FILTER (WHERE circuit_state = 'half_open')`,
		})
		.from(llmEndpointRuntime);

	return {
		totalEndpoints: summary?.totalEndpoints ?? 0,
		enabledEndpoints: summary?.enabledEndpoints ?? 0,
		openCircuits: runtimeSummary?.openCircuits ?? 0,
		halfOpenCircuits: runtimeSummary?.halfOpenCircuits ?? 0,
	};
});
