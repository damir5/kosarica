import { callVertexExpressGenerateContent } from "@/lib/llm/vertex-express";
import { readApiKey } from "@/lib/semantic-clustering/config";
import { createLogger } from "@/utils/logger";
import { listEnabledEndpoints, persistEndpointCheck, updateDailyQualityScores, updateEndpointRuntime } from "./repository";
import type { RoutedModelConfig } from "./types";

const log = createLogger("scheduler");

function toOllamaChatEndpoint(endpoint: string): string {
	return endpoint.replace(/\/v1\/chat\/completions\/?$/i, "/api/chat");
}

async function probeEndpoint(config: RoutedModelConfig): Promise<{ success: boolean; statusCode?: number; errorMessage?: string; latencyMs: number }> {
	const startedAt = Date.now();
	try {
		if (config.provider === "vertex-express") {
			await callVertexExpressGenerateContent({
				config,
				systemMsg: "Respond with valid JSON object only.",
				userMsg: '{"ping":true}',
				responseMimeType: "application/json",
			});
			return { success: true, latencyMs: Date.now() - startedAt };
		}

		if (config.provider === "claude") {
			const response = await fetch(config.endpoint, {
				method: "POST",
				headers: {
					"x-api-key": readApiKey(config),
					"anthropic-version": "2023-06-01",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: config.model,
					max_tokens: 1,
					messages: [{ role: "user", content: "ping" }],
				}),
			});
			return {
				success: response.ok,
				statusCode: response.status,
				errorMessage: response.ok ? undefined : await response.text(),
				latencyMs: Date.now() - startedAt,
			};
		}

		if (config.provider === "ollama") {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			const apiKey = readApiKey(config);
			if (apiKey.length > 0) {
				headers.Authorization = `Bearer ${apiKey}`;
			}
			const response = await fetch(toOllamaChatEndpoint(config.endpoint), {
				method: "POST",
				headers,
				body: JSON.stringify({
					model: config.model,
					stream: false,
					options: { temperature: 0 },
					messages: [
						{ role: "system", content: "Reply with compact JSON only." },
						{ role: "user", content: "{\"ping\":true}" },
					],
				}),
			});
			return {
				success: response.ok,
				statusCode: response.status,
				errorMessage: response.ok ? undefined : await response.text(),
				latencyMs: Date.now() - startedAt,
			};
		}

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			const apiKey = readApiKey(config);
			if (apiKey.length > 0) {
				headers.Authorization = `Bearer ${apiKey}`;
			}
			if (config.provider === "openrouter") {
				headers["HTTP-Referer"] = process.env.OPENROUTER_HTTP_REFERER ?? "https://kosarica.local";
				headers["X-Title"] = process.env.OPENROUTER_X_TITLE ?? "Kosarica Health Check";
		}
		const response = await fetch(config.endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: config.model,
				max_tokens: 1,
				temperature: 0,
				messages: [
					{ role: "system", content: "Reply with JSON only." },
					{ role: "user", content: "{\"ping\":true}" },
				],
			}),
		});
		return {
			success: response.ok,
			statusCode: response.status,
			errorMessage: response.ok ? undefined : await response.text(),
			latencyMs: Date.now() - startedAt,
		};
	} catch (error) {
		return {
			success: false,
			errorMessage: error instanceof Error ? error.message : String(error),
			latencyMs: Date.now() - startedAt,
		};
	}
}

export async function runActiveHealthChecks(): Promise<{ checked: number; failures: number }> {
	const endpoints = await listEnabledEndpoints();
	let checked = 0;
	let failures = 0;

	for (const endpoint of endpoints) {
		const config: RoutedModelConfig = {
			id: endpoint.id,
			provider: endpoint.provider as RoutedModelConfig["provider"],
			model: endpoint.model,
			endpoint: endpoint.endpoint,
			apiKeyEnv: endpoint.apiKeyEnv,
			responseFormat: (endpoint.responseFormat ?? undefined) as RoutedModelConfig["responseFormat"],
			jsonSchemaNullable: endpoint.jsonSchemaNullable,
			maxTokens: endpoint.maxTokens ?? undefined,
			weight: endpoint.baseWeight,
			timeoutMs: endpoint.timeoutMs,
			maxRetries: endpoint.maxRetries,
		};
		const result = await probeEndpoint(config);
		checked += 1;
		if (!result.success) {
			failures += 1;
		}
		await persistEndpointCheck(endpoint.id, result, "active");
		await updateEndpointRuntime(endpoint.id, result);
	}

	await updateDailyQualityScores();
	log.info("LLM endpoint health check completed", { checked, failures });
	return { checked, failures };
}
