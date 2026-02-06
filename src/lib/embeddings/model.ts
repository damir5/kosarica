/**
 * Singleton BGE-M3 embedding model loader.
 *
 * Uses @huggingface/transformers ONNX runtime (CPU-only).
 * Model (~500MB) is downloaded on first call and cached at ~/.cache/huggingface/hub.
 */

import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

const MODEL_ID = "Xenova/bge-m3";

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;
let modelReady = false;

/**
 * Get the BGE-M3 feature extraction pipeline.
 * Lazily loads and caches the model on first call.
 */
export async function getEmbeddingModel(): Promise<FeatureExtractionPipeline> {
	if (pipelinePromise) {
		return pipelinePromise;
	}
	pipelinePromise = loadModel()
		.then((pipeline) => {
			modelReady = true;
			return pipeline;
		})
		.catch((error) => {
			modelReady = false;
			pipelinePromise = null;
			throw error;
		});
	return pipelinePromise;
}

/**
 * Non-blocking check: returns true if the model is already loaded.
 */
export function isModelAvailable(): boolean {
	return modelReady;
}

async function loadModel(): Promise<FeatureExtractionPipeline> {
	try {
		log.info("Loading BGE-M3 embedding model", { modelId: MODEL_ID });
		const { pipeline } = await import("@huggingface/transformers");
		const pipe = await pipeline("feature-extraction", MODEL_ID, {
			dtype: "fp32",
		});
		log.info("BGE-M3 embedding model loaded successfully");
		return pipe;
	} catch (error) {
		log.error("Failed to load BGE-M3 embedding model", { error });
		throw error;
	}
}
