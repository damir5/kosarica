export interface FeatureMatchItem {
	retailerItemId: string;
	name: string;
	chainSlug: string | null;
	brand: string | null;
	normalizedName: string;
	normalizedCategory: string | null;
	productType: string | null;
	extractedBrand: string | null;
	extractedUnit: string | null;
	totalAmount: number | null;
	packAmount: number;
	containerType: string | null;
}

export interface CandidateScoreBreakdown {
	brand: number;
	quantity: number;
	pack: number;
	container: number;
	nameOverlap: number;
	total: number;
}

export interface FeatureMatchCandidate {
	item: FeatureMatchItem;
	score: number;
	breakdown: CandidateScoreBreakdown;
}

export interface GenerateCandidatesOptions {
	sourceItemId: string;
	limit?: number;
	minScore?: number;
	excludeLinked?: boolean;
}
