import type { EnsembleModelConfig } from "../config";
import type { ClusteringResult, ListwiseLLMResult } from "./types";

export type ListwiseCascadeDecision =
	| {
			status: "accepted";
			primary: ListwiseLLMResult;
			secondary: ListwiseLLMResult | null;
			reason: string;
	  }
	| {
			status: "escalated";
			primary: ListwiseLLMResult;
			secondary: ListwiseLLMResult;
			reason: string;
	  };

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(1, value));
}

function safeRatio(n: number, d: number): number {
	if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return 0;
	return n / d;
}

function countAssignedItems(result: ClusteringResult): number {
	let count = 0;
	for (const base of result.baseProducts) {
		for (const variant of base.packVariants) {
			count += variant.itemIds.length;
		}
	}
	return count;
}

function hasExtremeFragmentation(params: {
	itemCount: number;
	baseProducts: number;
}): boolean {
	const { itemCount, baseProducts } = params;
	if (itemCount < 6) return false;
	return baseProducts >= Math.max(5, Math.ceil(itemCount * 0.8));
}

function computeQualityFlags(params: {
	itemCount: number;
	result: ClusteringResult;
}): {
	bad: boolean;
	reason: string;
	confidence: number;
} {
	const { itemCount, result } = params;

	const confidence = clamp01(result.confidence);
	const duplicates = result.duplicateItemIds.length;
	const missing = result.missingItemIds.length;
	const unclassified = result.unclassified.length;
	const assigned = countAssignedItems(result);

	const unclassifiedRate = safeRatio(unclassified, itemCount);
	const missingRate = safeRatio(missing, itemCount);
	const assignedRate = safeRatio(assigned, itemCount);
	const baseCount = result.baseProducts.length;

	const reasons: string[] = [];
	if (duplicates > 0) reasons.push(`duplicateItemIds=${duplicates}`);
	if (missingRate > 0.15) reasons.push(`missingRate=${missingRate.toFixed(2)}`);
	if (unclassifiedRate > 0.25)
		reasons.push(`unclassifiedRate=${unclassifiedRate.toFixed(2)}`);
	if (assignedRate < 0.6)
		reasons.push(`assignedRate=${assignedRate.toFixed(2)}`);
	if (hasExtremeFragmentation({ itemCount, baseProducts: baseCount })) {
		reasons.push(`fragmentation baseProducts=${baseCount}`);
	}
	if ((result.reasoning ?? "").trim().length < 16)
		reasons.push("weak_reasoning");

	return {
		bad: reasons.length > 0,
		reason: reasons.length > 0 ? reasons.join(",") : "ok",
		confidence,
	};
}

export function decideListwiseCascade(params: {
	primary: ListwiseLLMResult;
	primaryModel: EnsembleModelConfig;
	secondaryModel: EnsembleModelConfig;
	itemCount: number;
	minPrimaryConfidence?: number;
}): { shouldEscalate: boolean; reason: string } {
	const minPrimaryConfidence = clamp01(params.minPrimaryConfidence ?? 0.9);
	const flags = computeQualityFlags({
		itemCount: params.itemCount,
		result: params.primary.clustering,
	});

	if (flags.bad) {
		return { shouldEscalate: true, reason: `quality_flags:${flags.reason}` };
	}

	if (flags.confidence < minPrimaryConfidence) {
		return {
			shouldEscalate: true,
			reason: `low_confidence:${flags.confidence.toFixed(2)}`,
		};
	}

	return { shouldEscalate: false, reason: "primary_confident" };
}
