export type SemanticVerdict =
	| "EXACT_MATCH"
	| "SAME_BASE_DIFFERENT_VARIANT"
	| "MISMATCH"
	| "UNCERTAIN";

export type DecisionState =
	| "AUTO_APPROVED"
	| "AUTO_REJECTED"
	| "PENDING_REVIEW"
	| "SYSTEM_ERROR";

export interface SemanticLLMItem {
	name: string;
	brand: string | null;
	category: string | null;
	normalizedName: string;
	amount: number | null;
	unit: string | null;
	packAmount: number;
	containerType: string | null;
}

export interface SemanticBatchPairInput {
	pairId: string;
	itemA: SemanticLLMItem;
	itemB: SemanticLLMItem;
}

export interface SemanticVote {
	modelId: string;
	provider: "openai" | "claude" | "openrouter" | "vertex-express";
	verdict: SemanticVerdict;
	confidence: number;
	reasoning: string;
	latencyMs: number;
}

export interface CascadeResult {
	votes: SemanticVote[];
	finalVerdict: SemanticVerdict;
	finalConfidence: number;
	consensusScore: number;
	decisionState: DecisionState;
	systemError: string | null;
}

export interface CascadeThresholds {
	escalateThreshold: number;
	autoApproveConfidence: number;
	autoRejectConfidence: number;
	reviewFloor: number;
	minConsensusForAutomation: number;
}

export interface RetailerItemFeatureInput {
	retailerItemId: string;
	name: string;
	brand: string | null;
	category: string | null;
	unit: string | null;
	unitQuantity: string | null;
}

export interface ParsedFeature {
	normalizedName: string;
	normalizedCategory: string | null;
	extractedBrand: string | null;
	extractedAmount: number | null;
	extractedUnit: string | null;
	isCountItem: boolean;
	isMultipack: boolean;
	packAmount: number;
	unitAmount: number | null;
	totalAmount: number | null;
	containerType: string | null;
	blockingKeys: string[];
}
