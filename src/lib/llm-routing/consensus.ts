import { chooseEndpointForCapability, endpointToModelConfig } from "./router";
import type { LlmCapability, RoutedModelConfig } from "./types";

export interface ConsensusConfig {
	minModels: number;
	maxModels: number;
	confidenceThreshold: number;
	strategy: "majority" | "unanimous" | "weighted";
}

export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
	minModels: 2,
	maxModels: 3,
	confidenceThreshold: 0.8,
	strategy: "majority",
};

export function getModelClassForJob(jobType: "categorization" | "matching"): {
	fast: LlmCapability;
	standard: LlmCapability;
	quality: LlmCapability;
} {
	if (jobType === "categorization") {
		return {
			fast: "categorization_fast",
			standard: "categorization_primary",
			quality: "categorization_quality",
		};
	}
	return {
		fast: "matching_fast",
		standard: "matching_primary",
		quality: "matching_quality",
	};
}

export async function selectEndpointsForConsensus(
	capability: LlmCapability,
	targetCount: number = 3,
): Promise<RoutedModelConfig[]> {
	const decision = await chooseEndpointForCapability(capability);
	const candidates = decision.candidates.slice(0, targetCount);

	return candidates.map((candidate) =>
		endpointToModelConfig({
			...decision,
			selected: candidate,
		}),
	);
}

export async function getDiverseEndpoints(
	capability: LlmCapability,
	count: number = 3,
): Promise<RoutedModelConfig[]> {
	const decision = await chooseEndpointForCapability(capability);

	const byProvider = new Map<string, typeof decision.candidates>();
	for (const candidate of decision.candidates) {
		const provider = candidate.endpoint.provider;
		const existing = byProvider.get(provider) || [];
		existing.push(candidate);
		byProvider.set(provider, existing);
	}

	const selected: typeof decision.candidates = [];
	const providerKeys = Array.from(byProvider.keys());
	let idx = 0;

	while (selected.length < count && byProvider.size > 0) {
		for (const provider of providerKeys) {
			if (selected.length >= count) break;

			const candidates = byProvider.get(provider);
			if (!candidates || candidates.length === 0) {
				byProvider.delete(provider);
				continue;
			}

			const candidate = candidates.shift();
			if (candidate) {
				selected.push(candidate);
			}

			if (candidates.length === 0) {
				byProvider.delete(provider);
			}
		}
		idx++;
		if (idx > 100) break;
	}

	return selected.map((candidate) =>
		endpointToModelConfig({
			...decision,
			selected: candidate,
		}),
	);
}

export function shouldUseConsensus(
	confidence: number,
	config: ConsensusConfig = DEFAULT_CONSENSUS_CONFIG,
): boolean {
	return confidence < config.confidenceThreshold;
}

export function aggregateConsensus<T extends { confidence: number }>(
	results: Array<{ model: RoutedModelConfig; result: T | null }>,
	strategy: "majority" | "unanimous" | "weighted" = "majority",
): { result: T | null; consensusReached: boolean; agreementRatio: number } {
	const validResults = results.filter((r) => r.result !== null);
	if (validResults.length === 0) {
		return { result: null, consensusReached: false, agreementRatio: 0 };
	}

	if (validResults.length === 1) {
		return {
			result: validResults[0].result,
			consensusReached: true,
			agreementRatio: 1,
		};
	}

	if (strategy === "weighted") {
		const sorted = [...validResults].sort(
			(a, b) => (b.result?.confidence ?? 0) - (a.result?.confidence ?? 0),
		);
		const topResult = sorted[0];
		const topConfidence = topResult.result?.confidence ?? 0;

		const hasClearWinner = sorted.every((r, idx) => {
			if (idx === 0) return true;
			return topConfidence - (r.result?.confidence ?? 0) > 0.1;
		});

		return {
			result: topResult.result,
			consensusReached: hasClearWinner || topConfidence >= 0.8,
			agreementRatio: hasClearWinner ? 1 : 0.5,
		};
	}

	const avgConfidence =
		validResults.reduce((sum, r) => sum + (r.result?.confidence ?? 0), 0) /
		validResults.length;

	const sorted = [...validResults].sort(
		(a, b) => (b.result?.confidence ?? 0) - (a.result?.confidence ?? 0),
	);

	return {
		result: sorted[0].result,
		consensusReached:
			strategy === "majority" ? avgConfidence >= 0.6 : avgConfidence >= 0.9,
		agreementRatio: avgConfidence,
	};
}

export interface ConsensusPlan {
	primaryModel: RoutedModelConfig;
	consensusModels: RoutedModelConfig[];
	shouldUseConsensus: boolean;
}

export async function createConsensusPlan(
	capability: LlmCapability,
	_confidenceThreshold?: number,
): Promise<ConsensusPlan> {
	const primaryDecision = await chooseEndpointForCapability(capability);
	const primaryModel = endpointToModelConfig(primaryDecision);

	const consensusModels = await getDiverseEndpoints(capability, 3);
	const otherModels = consensusModels.filter((m) => m.id !== primaryModel.id);

	return {
		primaryModel,
		consensusModels: otherModels.slice(0, 2),
		shouldUseConsensus: otherModels.length > 0,
	};
}
