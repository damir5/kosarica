/**
 * Store Enrichment Module
 *
 * Extracted from ingestion/processor for store management operations.
 * Handles geocoding, address verification, and enrichment tasks for stores.
 */

import { eq } from "drizzle-orm";
import type { DatabaseType } from "@/db";
import { storeEnrichmentTasks, stores } from "@/db/schema";
import { geocodeAddress, type GeocodingInput } from "@/lib/geocoding";
import { createLogger } from "@/utils/logger";

const log = createLogger("store-enrichment");

// ============================================================================
// Types
// ============================================================================

export interface EnrichmentContext {
	db: DatabaseType;
}

/**
 * Store enrichment task types
 */
export type EnrichmentTaskType = "geocode" | "verify_address" | "ai_categorize";

// ============================================================================
// Store Enrichment
// ============================================================================

/**
 * Process enrichment task for a store.
 * Handles geocoding, address verification, and AI categorization.
 *
 * @param storeId - Store ID to enrich
 * @param taskType - Type of enrichment task
 * @param taskId - Enrichment task ID
 * @param ctx - Database context
 */
export async function processEnrichStore(
	storeId: string,
	taskType: EnrichmentTaskType,
	taskId: string,
	ctx: EnrichmentContext,
): Promise<void> {
	log.info("Enriching store", { storeId, taskType });

	// Update task status to processing
	await ctx.db
		.update(storeEnrichmentTasks)
		.set({ status: "processing" })
		.where(eq(storeEnrichmentTasks.id, taskId));

	// Get store data
	const [store] = await ctx.db.select().from(stores).where(eq(stores.id, storeId));

	if (!store) {
		await ctx.db
			.update(storeEnrichmentTasks)
			.set({ status: "failed", errorMessage: "Store not found" })
			.where(eq(storeEnrichmentTasks.id, taskId));
		throw new Error(`Store not found: ${storeId}`);
	}

	try {
		switch (taskType) {
			case "geocode": {
				const geocodeInput: GeocodingInput = {
					address: store.address,
					city: store.city,
					postalCode: store.postalCode,
					country: "hr",
				};

				const geocodeResult = await geocodeAddress(geocodeInput);

				if (!geocodeResult.found) {
					await ctx.db
						.update(storeEnrichmentTasks)
						.set({
							status: "completed",
							outputData: JSON.stringify({ found: false }),
							confidence: geocodeResult.confidence,
							updatedAt: new Date(),
						})
						.where(eq(storeEnrichmentTasks.id, taskId));
					log.info("No geocoding results", { storeId });
					return;
				}

				const isHighConfidence = geocodeResult.confidence === "high";

				if (isHighConfidence) {
					await ctx.db
						.update(stores)
						.set({
							latitude: geocodeResult.latitude!,
							longitude: geocodeResult.longitude!,
							updatedAt: new Date(),
						})
						.where(eq(stores.id, storeId));
				}

				await ctx.db
					.update(storeEnrichmentTasks)
					.set({
						status: "completed",
						outputData: JSON.stringify({
							found: true,
							lat: geocodeResult.latitude,
							lon: geocodeResult.longitude,
							displayName: geocodeResult.displayName,
							provider: geocodeResult.provider,
							autoVerified: isHighConfidence,
						}),
						confidence: geocodeResult.confidence,
						...(isHighConfidence && {
							verifiedAt: new Date(),
							verifiedBy: "system",
						}),
						updatedAt: new Date(),
					})
					.where(eq(storeEnrichmentTasks.id, taskId));

				log.info("Geocoded store", {
					storeId,
					latitude: geocodeResult.latitude,
					longitude: geocodeResult.longitude,
					confidence: geocodeResult.confidence,
					autoVerified: isHighConfidence,
				});
				break;
			}

			case "verify_address": {
				await ctx.db
					.update(storeEnrichmentTasks)
					.set({
						status: "completed",
						outputData: JSON.stringify({
							originalAddress: store.address,
							city: store.city,
							postalCode: store.postalCode,
							needsReview: true,
						}),
						confidence: "medium",
						updatedAt: new Date(),
					})
					.where(eq(storeEnrichmentTasks.id, taskId));

				log.info("Address verification pending", { storeId });
				break;
			}

			case "ai_categorize": {
				await ctx.db
					.update(storeEnrichmentTasks)
					.set({
						status: "completed",
						outputData: JSON.stringify({
							message: "AI categorization not yet implemented",
						}),
						confidence: "low",
						updatedAt: new Date(),
					})
					.where(eq(storeEnrichmentTasks.id, taskId));

				log.info("AI categorization not implemented");
				break;
			}

			default:
				throw new Error(`Unknown enrichment task type: ${taskType}`);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		await ctx.db
			.update(storeEnrichmentTasks)
			.set({
				status: "failed",
				errorMessage,
				updatedAt: new Date(),
			})
			.where(eq(storeEnrichmentTasks.id, taskId));
		throw error;
	}
}
