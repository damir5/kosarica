import type { EnsembleModelConfig } from "../config";

export interface OfferSpec {
	brand: string | null;
	product: string | null;
	variant: string | null;
	packCount: number | null;
	unitSize: string | null;
	unitAmountMlOrG: number | null;
	container: string | null;
	totalQuantity: number | null;
	totalAmountMlOrG: number | null;
}

export interface GroupItem {
	retailerItemId: string;
	rawName: string;
	normalizedName: string;
	brand: string | null;
	category: string | null;
	unit: string | null;
	unitQuantity: string | null;
	totalAmount: number | null;
	packAmount: number | null;
	containerType: string | null;
	chainSlug: string | null;
	embedding: number[] | null;
}

export interface CandidateGroup {
	groupId: string;
	seedKey: string;
	items: GroupItem[];
	category: string | null;
	brand: string | null;
}

export interface ExtractionResultItem {
	id: string;
	spec: OfferSpec;
	source: "llm" | "fallback";
}

export interface ExtractionResult {
	items: ExtractionResultItem[];
	missingItemIds: string[];
}

export interface ClusteringPromptItem {
	id: string;
	rawName: string;
	spec: OfferSpec;
	medianPriceEur: number | null;
	chainSlug: string | null;
}

export interface PackVariantResult {
	variantKey: string;
	variantLabel: string;
	itemIds: string[];
	unitSize: string | null;
	packCount: number | null;
	container: string | null;
}

export interface BaseProductResult {
	baseId: string;
	canonicalName: string;
	brand: string | null;
	category: string | null;
	packVariants: PackVariantResult[];
}

export interface ClusteringResult {
	baseProducts: BaseProductResult[];
	unclassified: string[];
	confidence: number;
	reasoning: string;
	missingItemIds: string[];
	duplicateItemIds: string[];
}

export interface PriceSignal {
	medianPriceCents: number;
	quoteCount: number;
}

export interface TokenEstimates {
	extractionPrompt: number;
	extractionResponse: number;
	clusteringPrompt: number;
	clusteringResponse: number;
	total: number;
}

export interface TokenUsage {
	promptTokens: number | null;
	completionTokens: number | null;
	totalTokens: number | null;
	costUsd: number | null;
}

export interface CallTokenUsage {
	extraction: TokenUsage;
	clustering: TokenUsage;
	total: TokenUsage;
}

export interface ListwiseLLMResult {
	modelId: string;
	provider: EnsembleModelConfig["provider"];
	groupId: string;
	extraction: ExtractionResult;
	clustering: ClusteringResult;
	extractionLatencyMs: number;
	clusteringLatencyMs: number;
	totalLatencyMs: number;
	tokenEstimates: TokenEstimates;
	tokenUsage: CallTokenUsage;
}

export interface TrialMetrics {
	precisionBase: number;
	recallBase: number;
	f1Base: number;
	precisionVariant: number;
	recallVariant: number;
	f1Variant: number;
	precisionItem: number;
	recallItem: number;
	f1Item: number;
}

export interface GoldSetVariant {
	variantKey: string;
	itemIds: string[];
}

export interface GoldSetBaseProduct {
	baseKey: string;
	itemIds: string[];
	variants: GoldSetVariant[];
}

export interface GoldSet {
	groupId: string;
	baseProducts: GoldSetBaseProduct[];
}

export interface PromptSchema {
	name: string;
	schema: Record<string, unknown>;
}

export interface BuiltPrompt {
	system: string;
	user: string;
	jsonSchema: PromptSchema;
}
