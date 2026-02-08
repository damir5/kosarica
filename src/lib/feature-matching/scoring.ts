import type {
	CandidateScoreBreakdown,
	FeatureMatchItem,
} from "./types";

function normalize(value: string | null): string {
	return (value ?? "").trim().toLowerCase();
}

function tokenSet(value: string): Set<string> {
	return new Set(
		value
			.split(/\s+/)
			.map((token) => token.trim())
			.filter((token) => token.length >= 2),
	);
}

function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) {
		return 0;
	}
	let intersection = 0;
	for (const token of a) {
		if (b.has(token)) {
			intersection += 1;
		}
	}
	const union = a.size + b.size - intersection;
	return union > 0 ? intersection / union : 0;
}

function quantityScore(source: number | null, candidate: number | null): number {
	if (source == null || candidate == null || source <= 0 || candidate <= 0) {
		return 0;
	}
	const diff = Math.abs(source - candidate);
	const relative = diff / source;
	return relative <= 0.05 ? 1 : 0;
}

export function scoreCandidate(
	source: FeatureMatchItem,
	candidate: FeatureMatchItem,
): CandidateScoreBreakdown {
	const sourceBrand = normalize(source.extractedBrand ?? source.brand);
	const candidateBrand = normalize(candidate.extractedBrand ?? candidate.brand);
	const brandScore =
		sourceBrand.length > 0 && sourceBrand === candidateBrand ? 0.3 : 0;

	const qtyScore = quantityScore(source.totalAmount, candidate.totalAmount) * 0.25;
	const packScore = source.packAmount === candidate.packAmount ? 0.15 : 0;
	const containerScore =
		normalize(source.containerType).length > 0 &&
		normalize(source.containerType) === normalize(candidate.containerType)
			? 0.1
			: 0;
	const overlap =
		jaccard(tokenSet(source.normalizedName), tokenSet(candidate.normalizedName)) *
		0.2;

	const total = brandScore + qtyScore + packScore + containerScore + overlap;
	return {
		brand: brandScore,
		quantity: qtyScore,
		pack: packScore,
		container: containerScore,
		nameOverlap: overlap,
		total,
	};
}
