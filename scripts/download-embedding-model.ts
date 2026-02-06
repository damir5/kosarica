/**
 * Pre-download the BGE-M3 embedding model.
 *
 * Useful for Docker builds or CI to avoid downloading at runtime.
 * Model is cached at ~/.cache/huggingface/hub (~500MB).
 *
 * Usage: pnpm tsx scripts/download-embedding-model.ts
 */

import { getEmbeddingModel } from "@/lib/embeddings/model";

async function main() {
	console.log("Downloading BGE-M3 embedding model...");
	const start = Date.now();
	await getEmbeddingModel();
	const duration = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`Model downloaded and cached successfully (${duration}s)`);
	process.exit(0);
}

main().catch((error) => {
	console.error("Failed to download model:", error);
	process.exit(1);
});
