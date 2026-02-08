export interface LogLlmDecisionInput {
	taskType:
		| "extraction"
		| "pair_match"
		| "barcode_assign"
		| "feature_match"
		| "categorize"
		| "heuristic"
		| string;
	input: Record<string, unknown>;
	output?: Record<string, unknown> | null;
	modelId: string;
	provider: string;
	latencyMs?: number | null;
	tokenCount?: number | null;
	costCents?: number | null;
	verdict?: string | null;
	confidence?: number | null;
	reasoning?: string | null;
	humanOverride?: string | null;
	humanNotes?: string | null;
	reviewedBy?: string | null;
	reviewedAt?: Date | null;
}

export interface LogLlmDecisionResult {
	id: string;
	inputHash: string;
}
