export interface IngestionErrorClassification {
	status: "completed" | "failed";
	statusType: string;
	statusSeverity: "warning" | "error" | "critical";
	statusReason: string;
	retryAt?: Date;
	metadata?: Record<string, unknown>;
}

export class IngestionClassifiedError extends Error {
	readonly classification: IngestionErrorClassification;

	constructor(classification: IngestionErrorClassification) {
		super(classification.statusReason);
		this.name = "IngestionClassifiedError";
		this.classification = classification;
	}
}

export interface IngestionClassified {
	readonly _tag: "IngestionClassified";
	readonly classification: IngestionErrorClassification;
}

export function ingestionClassified(
	classification: IngestionErrorClassification,
): IngestionClassified {
	return { _tag: "IngestionClassified", classification };
}
