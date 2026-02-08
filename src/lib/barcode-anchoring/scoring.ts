import type { BarcodeCluster } from "./types";

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function priorityScore(cluster: BarcodeCluster): number {
	const chainScore = cluster.chainCount * 20;
	const itemScore = cluster.itemCount * 4;
	const categoryScore = Math.round(clamp(cluster.categoryAgreement, 0, 1) * 20);
	const variancePenalty =
		cluster.priceVariance == null
			? 8
			: Math.round(clamp(1 - cluster.priceVariance, 0, 1) * 20);

	return chainScore + itemScore + categoryScore + variancePenalty;
}

export function autoLinkEligibility(cluster: BarcodeCluster): boolean {
	if (cluster.chainCount < 3) {
		return false;
	}
	if (cluster.categoryAgreement < 1) {
		return false;
	}
	if (cluster.priceVariance == null) {
		return false;
	}
	return cluster.priceVariance < 0.3;
}
