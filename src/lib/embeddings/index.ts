/**
 * Public embedding API.
 *
 * Provides batch and single-query embedding using BGE-M3 (1024 dims).
 */

import { getEmbeddingModel, isModelAvailable } from "./model";

export { preparePassageText, prepareQueryText } from "./text";
export { isModelAvailable };

const DEFAULT_BATCH_SIZE = 32;

function resolveBatchSize(): number {
	const raw = process.env.EMBEDDING_BATCH_SIZE;
	if (!raw) {
		return DEFAULT_BATCH_SIZE;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
}

/**
 * Embed multiple texts in batches.
 * Returns L2-normalized 1024-dim vectors.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return [];

	const batchSize = resolveBatchSize();
	const model = await getEmbeddingModel();
	const results: number[][] = [];

	for (let i = 0; i < texts.length; i += batchSize) {
		const batch = texts.slice(i, i + batchSize);
		const output = await model(batch, {
			pooling: "cls",
			normalize: true,
		});
		// output.tolist() returns number[][] for batch input
		const vectors = output.tolist() as number[][];
		results.push(...vectors);
	}

	return results;
}

/**
 * Embed a single query text.
 * Returns L2-normalized 1024-dim vector.
 */
export async function embedQuery(text: string): Promise<number[]> {
	const model = await getEmbeddingModel();
	const output = await model(text, {
		pooling: "cls",
		normalize: true,
	});
	const vectors = output.tolist() as number[][];
	return vectors[0];
}

/**
 * Check if the embedding model is loaded and ready.
 */
export function isModelLoaded(): boolean {
	return isModelAvailable();
}
